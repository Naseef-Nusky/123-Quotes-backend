/**
 * Rebuild service questionnaires + lead answers from the Checkare/Hunto dump cache.
 *
 * Uses scripts/.import-cache/{category.json,cat_ans.json,leads_meta.jsonl}
 * produced by: node scripts/extractCheckareDump.js /path/to/dump.sql
 *
 *   node scripts/reimportServiceQuestionnaires.js
 *   node scripts/reimportServiceQuestionnaires.js --extract "/path/to/dump.sql"
 */
require('dotenv').config({ quiet: true })
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { randomUUID } = require('crypto')
const prisma = require('../src/config/db')
const { slugify } = require('../src/utils/crypto')

const CACHE = path.join(__dirname, '.import-cache')
const JUNK_Q = /^(dcsc|q\d+|a\d+|test|abc|trst)$/i

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(CACHE, name), 'utf8'))
}

function* readJsonl(name) {
  const raw = fs.readFileSync(path.join(CACHE, name), 'utf8')
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    yield JSON.parse(line)
  }
}

function isChoiceRow(row) {
  return ['rb', 'cb'].includes(String(row.child_type || '').toLowerCase())
}

/**
 * Collect questionnaire questions for a dump service row.
 * Handles normal parent links AND the Web Development orphan (parent=103,
 * entry via child_type=104).
 */
function collectQuestions(serviceRow, categories, catAns) {
  const serviceId = Number(serviceRow.cat_id)
  const byId = new Map(categories.map((c) => [Number(c.cat_id), c]))
  const ansByQ = new Map()
  for (const a of catAns) {
    const qid = Number(a.cat_id)
    if (!ansByQ.has(qid)) ansByQ.set(qid, [])
    ansByQ.get(qid).push(a)
  }

  const found = new Map() // oldQId -> category row

  // 1) Direct children of the service
  for (const c of categories) {
    if (String(c.parent) === String(serviceId) && isChoiceRow(c)) {
      found.set(Number(c.cat_id), c)
    }
  }

  // 2) Walk from child_type entry point via answer.next
  const start = Number(serviceRow.child_type)
  if (Number.isFinite(start) && start > 0) {
    const queue = [start]
    const seen = new Set()
    while (queue.length) {
      const qid = queue.shift()
      if (seen.has(qid)) continue
      seen.add(qid)
      const row = byId.get(qid)
      if (row && isChoiceRow(row)) {
        found.set(qid, row)
        // If this question's parent is an orphan folder (not the service, not itself),
        // pull siblings under that parent too (Web Dev parent=103 case).
        const parentId = Number(row.parent)
        if (parentId && parentId !== serviceId && parentId !== qid && parentId !== 1) {
          for (const c of categories) {
            if (String(c.parent) === String(parentId) && isChoiceRow(c)) {
              found.set(Number(c.cat_id), c)
            }
          }
        }
      }
      for (const a of ansByQ.get(qid) || []) {
        const next = Number(a.next)
        if (Number.isFinite(next) && next > 0 && next !== 1) queue.push(next)
      }
    }
  }

  // Drop junk labels
  for (const [id, row] of [...found.entries()]) {
    if (JUNK_Q.test(String(row.cat_name || '').trim())) found.delete(id)
  }

  // Stable order: by cat_id
  const list = [...found.values()].sort((a, b) => Number(a.cat_id) - Number(b.cat_id))

  // Always append global "how likely" question (cat_id=1) last
  const globalQ = byId.get(1)
  if (globalQ) list.push({ ...globalQ, __global: true })

  return list
}

async function matchDbService(dumpName) {
  const name = String(dumpName || '').trim()
  if (!name) return null
  const all = await prisma.service.findMany({
    select: { id: true, name: true, isActive: true },
  })
  const exact = all.filter((s) => s.name.trim().toLowerCase() === name.toLowerCase())
  if (!exact.length) return null
  return exact.find((s) => s.isActive) || exact[0]
}

async function rebuildServiceQuestionnaire(serviceId, questionRows, catAns) {
  // Remove existing answers → branches → questions for this service
  const oldQs = await prisma.question.findMany({
    where: { serviceId },
    select: { id: true },
  })
  const oldIds = oldQs.map((q) => q.id)
  if (oldIds.length) {
    await prisma.requestAnswer.deleteMany({ where: { questionId: { in: oldIds } } })
    await prisma.questionBranch.deleteMany({
      where: {
        OR: [
          { sourceQuestionId: { in: oldIds } },
          { targetQuestionId: { in: oldIds } },
        ],
      },
    })
    await prisma.question.deleteMany({ where: { id: { in: oldIds } } })
  }

  const perServiceQ = new Map() // old cat_id -> new question id
  const created = [] // { oldId, questionId, options: [{a, optionId}] }

  let sort = 0
  for (const q of questionRows) {
    sort += 1
    const oldQId = Number(q.cat_id)
    const type =
      String(q.child_type).toLowerCase() === 'cb' ? 'MULTIPLE_CHOICE' : 'SINGLE_CHOICE'
    const question = await prisma.question.create({
      data: {
        serviceId,
        label: String(q.cat_name).slice(0, 250),
        type,
        isRequired: true,
        sortOrder: sort,
        isActive: String(q.status) !== 'chk',
      },
    })
    perServiceQ.set(oldQId, question.id)

    const ansRows = q.__global
      ? catAns.filter((x) => Number(x.cat_id) === 1)
      : catAns.filter((x) => Number(x.cat_id) === oldQId)

    const optionPairs = []
    let oi = 0
    for (const a of ansRows) {
      oi += 1
      const option = await prisma.answerOption.create({
        data: {
          questionId: question.id,
          label: String(a.name).slice(0, 200),
          value: slugify(a.name) || `opt-${a.id}`,
          sortOrder: oi,
        },
      })
      optionPairs.push({ a, optionId: option.id, value: option.value })
    }
    created.push({ oldId: oldQId, questionId: question.id, options: optionPairs })
  }

  // Branches from cat_ans.next
  for (const item of created) {
    for (const { a, optionId, value } of item.options) {
      const next = Number(a.next)
      const targetId = perServiceQ.get(next)
      if (!targetId || targetId === item.questionId) continue
      await prisma.questionBranch.create({
        data: {
          sourceQuestionId: item.questionId,
          targetQuestionId: targetId,
          optionId,
          operator: 'EQUALS',
          value,
        },
      }).catch(() => {})
    }
  }

  return perServiceQ
}

function parseAnsIds(raw) {
  return String(raw || '')
    .split(',')
    .map((p) => Number(String(p).trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
}

async function main() {
  const args = process.argv.slice(2)
  const extractIdx = args.indexOf('--extract')
  if (extractIdx !== -1) {
    const dumpPath = args[extractIdx + 1]
    if (!dumpPath) throw new Error('--extract requires a dump path')
    console.log('Extracting from', dumpPath)
    const r = spawnSync(
      process.execPath,
      [path.join(__dirname, 'extractCheckareDump.js'), dumpPath],
      { stdio: 'inherit' },
    )
    if (r.status !== 0) process.exit(r.status || 1)
  }

  const categories = loadJson('category.json')
  const catAns = loadJson('cat_ans.json')
  const oldAnsMap = new Map(
    catAns.map((a) => [Number(a.id), { label: String(a.name), catId: Number(a.cat_id) }]),
  )

  // leads_meta by lead_id
  const metaByLead = new Map()
  for (const m of readJsonl('leads_meta.jsonl')) {
    const lid = Number(m.lead_id)
    if (!metaByLead.has(lid)) metaByLead.set(lid, [])
    metaByLead.get(lid).push(m)
  }

  const dumpServices = categories.filter((c) => String(c.parent) === '0')
  console.log('Dump services:', dumpServices.length)

  let matched = 0
  let rebuilt = 0
  let skippedNoMatch = 0
  let answersWritten = 0
  let leadsFixed = 0
  const report = []

  for (const dumpSvc of dumpServices) {
    const qRows = collectQuestions(dumpSvc, categories, catAns)
    // Always at least global Q if present
    const dbSvc = await matchDbService(dumpSvc.cat_name)
    if (!dbSvc) {
      skippedNoMatch += 1
      continue
    }
    matched += 1

    const realCount = qRows.filter((q) => !q.__global).length
    const perServiceQ = await rebuildServiceQuestionnaire(dbSvc.id, qRows, catAns)
    rebuilt += 1

    // Re-import answers for hunto leads of this service
    const requests = await prisma.customerRequest.findMany({
      where: {
        serviceId: dbSvc.id,
        title: { startsWith: '[hunto] Lead #' },
      },
      select: { id: true, title: true, description: true },
    })

    let svcAnswers = 0
    let svcLeads = 0
    for (const req of requests) {
      const m = String(req.title || '').match(/\[hunto\] Lead #(\d+)/i)
      if (!m) continue
      const oldLeadId = Number(m[1])
      const metas = metaByLead.get(oldLeadId) || []
      // Merge by question — dump sometimes repeats the same meta_key.
      const byQuestion = new Map()
      const unresolved = []
      for (const meta of metas) {
        if (String(meta.meta_type || 'q') !== 'q') continue
        const oldQId = Number(meta.meta_key)
        const questionId = perServiceQ.get(oldQId)
        if (!questionId) {
          unresolved.push(`${meta.meta_key}: ${meta.meta_value}`)
          continue
        }
        const ids = parseAnsIds(meta.meta_value)
        const labels = ids.map((id) => oldAnsMap.get(id)?.label).filter(Boolean)
        const value = labels.length
          ? labels.join(', ')
          : String(meta.meta_value || '').replace(/^,\s*/, '')
        const prev = byQuestion.get(questionId)
        if (prev) {
          const merged = [...new Set([...(prev.value ? prev.value.split(', ') : []), ...labels])]
          byQuestion.set(questionId, {
            id: prev.id,
            requestId: req.id,
            questionId,
            value: merged.filter(Boolean).join(', ') || value,
          })
        } else {
          byQuestion.set(questionId, {
            id: randomUUID(),
            requestId: req.id,
            questionId,
            value,
          })
        }
      }
      const rows = [...byQuestion.values()]

      await prisma.requestAnswer.deleteMany({ where: { requestId: req.id } })
      if (rows.length) {
        await prisma.requestAnswer.createMany({ data: rows })
        svcAnswers += rows.length
      }

      // Clean unresolved leftovers from description if we resolved everything useful
      if (req.description && /(?:^|\n)\d+:\s*,/.test(req.description) && !unresolved.length) {
        const cleaned = String(req.description)
          .split(/\n\n/)
          .filter((block) => !/^\d+:\s*,/.test(block.trim()))
          .join('\n\n')
          .trim()
        if (cleaned !== req.description) {
          await prisma.customerRequest.update({
            where: { id: req.id },
            data: { description: cleaned || null },
          })
        }
      }

      // Refresh lead summary from answers
      const summary = rows
        .map((r) => r.value)
        .filter(Boolean)
        .join(' / ')
        .slice(0, 500)
      await prisma.lead.updateMany({
        where: { requestId: req.id },
        data: { summary: summary || null },
      })
      svcLeads += 1
    }
    answersWritten += svcAnswers
    leadsFixed += svcLeads

    report.push({
      dump: dumpSvc.cat_name,
      dumpId: dumpSvc.cat_id,
      db: dbSvc.name,
      realQuestions: realCount,
      totalQuestions: qRows.length,
      leadsReanswered: svcLeads,
      answers: svcAnswers,
    })
    console.log(
      `✓ ${dumpSvc.cat_name} → ${realCount} real + global | leads fixed ${svcLeads} | answers ${svcAnswers}`,
    )
  }

  // Final health for services that have leads
  const leadServices = await prisma.lead.groupBy({ by: ['serviceId'], _count: true })
  const health = []
  for (const row of leadServices) {
    const svc = await prisma.service.findUnique({
      where: { id: row.serviceId },
      select: {
        name: true,
        isActive: true,
        questions: {
          where: { isActive: true },
          select: { label: true, options: { select: { id: true } } },
        },
      },
    })
    const real = (svc?.questions || []).filter(
      (q) => !/how likely are you to use this service/i.test(q.label || ''),
    )
    health.push({
      name: svc?.name,
      leads: row._count,
      questions: svc?.questions?.length || 0,
      real: real.length,
      active: svc?.isActive,
    })
  }
  health.sort((a, b) => b.leads - a.leads)

  const summary = {
    matchedServices: matched,
    rebuilt: rebuilt,
    skippedNoMatch,
    leadsFixed,
    answersWritten,
    leadServiceHealth: health,
  }
  fs.writeFileSync(
    path.join(CACHE, 'questionnaire-reimport-summary.json'),
    JSON.stringify({ at: new Date().toISOString(), summary, report }, null, 2),
  )
  console.log('\n=== DONE ===')
  console.log(JSON.stringify(summary, null, 2))
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
