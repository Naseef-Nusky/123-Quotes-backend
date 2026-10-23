/**
 * Import questionnaire answers for existing leads from Checkare leads_meta.
 *
 * Matches dump leads via request title "[hunto] Lead #<id>", maps old question
 * cat_ids + cat_ans option ids to current Question / option labels on that
 * service, and writes RequestAnswer rows.
 *
 * Usage:
 *   node scripts/importLeadAnswersFromDump.js "/path/to/checkare_hunto.sql"
 */
require('dotenv').config({ quiet: true })
const fs = require('fs')
const { randomUUID } = require('crypto')
const prisma = require('../src/config/db')

const DUMP = process.argv[2]

function unescapeSql(s) {
  return String(s)
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

function normLabel(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

function extractBetween(sqlPath, table) {
  // Stream file; collect INSERT block for table
  const chunks = []
  let mode = false
  const fd = fs.readFileSync(sqlPath, 'utf8')
  for (const line of fd.split(/\n/)) {
    if (line.startsWith(`INSERT INTO \`${table}\``)) mode = true
    if (mode) {
      if (line.startsWith('CREATE TABLE') && !line.includes(`\`${table}\``)) break
      chunks.push(line)
    }
  }
  return chunks.join('\n')
}

function parseCategories(blob) {
  const out = []
  const re =
    /\((\d+),\s*'((?:\\'|[^'])*)',\s*'((?:\\'|[^'])*)',\s*'((?:\\'|[^'])*)',\s*'((?:\\'|[^'])*)'\)/g
  let m
  while ((m = re.exec(blob))) {
    out.push({
      cat_id: Number(m[1]),
      cat_name: unescapeSql(m[2]),
      child_type: m[3],
      parent: m[4],
      status: m[5],
    })
  }
  return out
}

function parseCatAns(blob) {
  const out = []
  const re =
    /\((\d+),\s*(\d+),\s*'((?:\\'|[^'])*)',\s*'((?:\\'|[^'])*)',\s*'((?:\\'|[^'])*)',\s*'((?:\\'|[^'])*)'\)/g
  let m
  while ((m = re.exec(blob))) {
    out.push({
      id: Number(m[1]),
      cat_id: Number(m[2]),
      name: unescapeSql(m[3]),
      type: m[4],
      next: m[5],
      status: m[6],
    })
  }
  return out
}

function parseLeadsMeta(blob) {
  // Only meta_type = 'q'
  const byLead = new Map()
  const re =
    /\((\d+),\s*'q',\s*'([^']*)',\s*'((?:\\'|[^'])*)',\s*(\d+),\s*'([^']*)'\)/g
  let m
  while ((m = re.exec(blob))) {
    const leadId = Number(m[4])
    if (!byLead.has(leadId)) byLead.set(leadId, [])
    byLead.get(leadId).push({
      meta_key: String(m[2]).trim(),
      meta_value: unescapeSql(m[3]),
    })
  }
  return byLead
}

async function main() {
  if (!DUMP || !fs.existsSync(DUMP)) {
    console.error('Usage: node scripts/importLeadAnswersFromDump.js <dump.sql>')
    process.exit(1)
  }

  console.log('Parsing dump…')
  const catBlob = extractBetween(DUMP, 'category')
  const ansBlob = extractBetween(DUMP, 'cat_ans')
  const metaBlob = extractBetween(DUMP, 'leads_meta')
  const categories = parseCategories(catBlob)
  const catAns = parseCatAns(ansBlob)
  const metaByLead = parseLeadsMeta(metaBlob)
  console.log({
    categories: categories.length,
    catAns: catAns.length,
    leadsWithMeta: metaByLead.size,
  })

  const oldQLabel = new Map(categories.map((c) => [c.cat_id, c.cat_name]))
  const oldAnsLabel = new Map(catAns.map((a) => [a.id, a.name]))

  // Map existing hunts leads: oldLeadId -> { requestId, serviceId }
  console.log('Loading imported leads from DB…')
  const requests = await prisma.customerRequest.findMany({
    where: { title: { startsWith: '[hunto] Lead #' } },
    select: {
      id: true,
      title: true,
      serviceId: true,
      answers: { select: { questionId: true } },
    },
  })
  const byOldLead = new Map()
  for (const r of requests) {
    const m = String(r.title || '').match(/Lead #(\d+)/i)
    if (!m) continue
    byOldLead.set(Number(m[1]), {
      requestId: r.id,
      serviceId: r.serviceId,
      existingQIds: new Set(r.answers.map((a) => a.questionId)),
    })
  }
  console.log('DB hunts leads matched by title:', byOldLead.size)

  // Active (+ inactive fallback) questions per service, keyed by normalized label
  const services = await prisma.service.findMany({
    select: {
      id: true,
      questions: {
        select: {
          id: true,
          label: true,
          isActive: true,
          options: { select: { label: true, value: true } },
        },
      },
    },
  })
  const qIndex = new Map() // serviceId -> Map(normLabel -> question)
  for (const s of services) {
    const map = new Map()
    // Prefer active: insert inactive first, then active overwrites
    const ordered = [...s.questions].sort((a, b) => Number(a.isActive) - Number(b.isActive))
    for (const q of ordered) {
      map.set(normLabel(q.label), q)
    }
    qIndex.set(s.id, map)
  }

  const toCreate = []
  let leadsTouched = 0
  let skippedNoLead = 0
  let skippedNoQuestion = 0
  let skippedEmpty = 0
  let skippedDuplicate = 0
  let answersBuilt = 0

  for (const [oldLeadId, metas] of metaByLead) {
    const hit = byOldLead.get(oldLeadId)
    if (!hit) {
      skippedNoLead++
      continue
    }
    const labelMap = qIndex.get(hit.serviceId)
    if (!labelMap) {
      skippedNoQuestion++
      continue
    }

    let addedForLead = 0
    for (const meta of metas) {
      const oldQId = Number(meta.meta_key)
      const qLabel = oldQLabel.get(oldQId)
      if (!qLabel) {
        skippedNoQuestion++
        continue
      }
      const question = labelMap.get(normLabel(qLabel))
      if (!question) {
        skippedNoQuestion++
        continue
      }
      if (hit.existingQIds.has(question.id)) {
        skippedDuplicate++
        continue
      }

      const ids = String(meta.meta_value || '')
        .split(',')
        .map((p) => Number(String(p).trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
      const labels = ids.map((id) => oldAnsLabel.get(id)).filter(Boolean)
      const value = labels.length ? labels.join(', ') : String(meta.meta_value || '').trim()
      if (!value || value === ',') {
        skippedEmpty++
        continue
      }

      toCreate.push({
        id: randomUUID(),
        requestId: hit.requestId,
        questionId: question.id,
        value: value.slice(0, 5000),
      })
      hit.existingQIds.add(question.id)
      addedForLead++
      answersBuilt++
    }
    if (addedForLead) leadsTouched++
  }

  console.log('Creating', toCreate.length, 'answers for', leadsTouched, 'leads…')
  for (let i = 0; i < toCreate.length; i += 500) {
    const batch = toCreate.slice(i, i + 500)
    await prisma.requestAnswer.createMany({ data: batch, skipDuplicates: true })
    if ((i / 500) % 5 === 0) console.log('  …', Math.min(i + batch.length, toCreate.length), '/', toCreate.length)
  }

  // Remap: copy answers that only exist on inactive questions onto active
  // questions with the same label (so CRM/UI always sees them on current Qs).
  console.log('Remapping inactive-question answers onto active twins…')
  let remapped = 0
  for (const s of services) {
    const byLabel = new Map()
    for (const q of s.questions) {
      const k = normLabel(q.label)
      if (!byLabel.has(k)) byLabel.set(k, { active: null, inactive: [] })
      const slot = byLabel.get(k)
      if (q.isActive) slot.active = q
      else slot.inactive.push(q)
    }
    for (const { active, inactive } of byLabel.values()) {
      if (!active || !inactive.length) continue
      const inactiveIds = inactive.map((q) => q.id)
      const rows = await prisma.requestAnswer.findMany({
        where: { questionId: { in: inactiveIds } },
        select: { requestId: true, value: true },
      })
      if (!rows.length) continue
      // existing active answers for these requests
      const existing = await prisma.requestAnswer.findMany({
        where: {
          questionId: active.id,
          requestId: { in: [...new Set(rows.map((r) => r.requestId))] },
        },
        select: { requestId: true },
      })
      const have = new Set(existing.map((e) => e.requestId))
      const create = []
      for (const r of rows) {
        if (have.has(r.requestId)) continue
        create.push({
          id: randomUUID(),
          requestId: r.requestId,
          questionId: active.id,
          value: r.value,
        })
        have.add(r.requestId)
      }
      if (create.length) {
        await prisma.requestAnswer.createMany({ data: create, skipDuplicates: true })
        remapped += create.length
      }
    }
  }
  console.log('remapped onto active questions:', remapped)

  const totals = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int AS leads,
      COUNT(*) FILTER (WHERE ans_c > 0)::int AS with_answers,
      COUNT(*) FILTER (WHERE ans_c = 0)::int AS without_answers
    FROM (
      SELECT l.id, COUNT(ra.id)::int AS ans_c
      FROM "Lead" l
      JOIN "CustomerRequest" cr ON cr.id = l."requestId"
      LEFT JOIN "RequestAnswer" ra ON ra."requestId" = cr.id
      GROUP BY l.id
    ) t`

  // Sample PI lead
  const sample = await prisma.lead.findFirst({
    where: { service: { name: 'Private Investigators' }, request: { answers: { some: {} } } },
    orderBy: { createdAt: 'desc' },
    include: {
      request: {
        include: {
          answers: {
            include: { question: { select: { label: true, isActive: true } } },
          },
        },
      },
    },
  })
  console.log('\n=== DONE ===')
  console.log({
    answersCreatedFromDump: answersBuilt,
    leadsUpdated: leadsTouched,
    skippedNoLeadInDb: skippedNoLead,
    skippedNoQuestionMatch: skippedNoQuestion,
    skippedDuplicate: skippedDuplicate,
    skippedEmpty: skippedEmpty,
    remapped,
    leadAnswerCoverage: totals[0],
  })
  console.log('\nSample PI answers:')
  for (const a of sample?.request?.answers || []) {
    console.log(`  [${a.question?.isActive ? 'active' : 'old'}] ${a.question?.label} = ${a.value}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
