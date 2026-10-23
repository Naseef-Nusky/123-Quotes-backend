/**
 * Import full service questionnaires (questions + answer options + branches)
 * from a Checkare SQL dump into the current Postgres DB.
 *
 * Safe for existing leads: old questions are soft-deactivated (isActive=false)
 * so RequestAnswer rows keep working; new active questions power the wizard.
 *
 * Usage:
 *   node scripts/importQuestionsFromDump.js "/path/to/checkare_hunto.sql"
 */
require('dotenv').config({ quiet: true })
const fs = require('fs')
const path = require('path')
const prisma = require('../src/config/db')
const { slugify } = require('../src/utils/crypto')

const DUMP =
  process.argv[2] ||
  path.join(process.env.HOME || '', 'Downloads', 'checkare_hunto (1).sql')

const JUNK_LABEL = /^(dcsc|q\d+|a\d+|test|asdf|xxx+)$/i

function extractInsert(sql, table) {
  const lines = []
  let mode = false
  for (const line of sql.split(/\n/)) {
    if (line.startsWith(`INSERT INTO \`${table}\``)) mode = true
    if (mode) {
      if (line.startsWith('CREATE TABLE') && !line.includes(`\`${table}\``)) break
      lines.push(line)
    }
  }
  return lines.join('\n')
}

function unescapeSql(s) {
  return String(s)
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

function parseCategories(blob) {
  const rows = [
    ...blob.matchAll(
      /\((\d+),\s*'((?:\\'|[^'])*)',\s*'((?:\\'|[^'])*)',\s*'((?:\\'|[^'])*)',\s*'((?:\\'|[^'])*)'\)/g,
    ),
  ]
  return rows.map((r) => ({
    cat_id: Number(r[1]),
    cat_name: unescapeSql(r[2]),
    child_type: r[3],
    parent: r[4],
    status: r[5],
  }))
}

function parseCatAns(blob) {
  const rows = [
    ...blob.matchAll(
      /\((\d+),\s*(\d+),\s*'((?:\\'|[^'])*)',\s*'((?:\\'|[^'])*)',\s*'((?:\\'|[^'])*)',\s*'((?:\\'|[^'])*)'\)/g,
    ),
  ]
  return rows.map((r) => ({
    id: Number(r[1]),
    cat_id: Number(r[2]),
    name: unescapeSql(r[3]),
    type: r[4],
    next: r[5],
    status: r[6],
  }))
}

function normName(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/&/g, 'and')
}

function buildQuestionList(svc, categories, ansByQ, byId) {
  const qs = []
  const seen = new Set()

  // 1) Direct children of the service
  for (const c of categories) {
    if (
      String(c.parent) === String(svc.cat_id) &&
      ['rb', 'cb'].includes(String(c.child_type).toLowerCase())
    ) {
      if (!seen.has(c.cat_id)) {
        seen.add(c.cat_id)
        qs.push(c)
      }
    }
  }

  // 2) Walk from child_type pointer (first question id)
  const ct = String(svc.child_type || '')
  if (ct && /^\d+$/.test(ct) && Number(ct) !== 1) {
    let cur = Number(ct)
    let guard = 0
    while (cur && !seen.has(cur) && guard < 40) {
      guard += 1
      const q = byId.get(cur)
      if (!q || !['rb', 'cb'].includes(String(q.child_type).toLowerCase())) break
      seen.add(cur)
      qs.push(q)
      const nxts = (ansByQ.get(cur) || [])
        .map((a) => String(a.next || '').trim())
        .filter((n) => /^\d+$/.test(n))
      if (!nxts.length) break
      // most common next among options
      const counts = {}
      for (const n of nxts) counts[n] = (counts[n] || 0) + 1
      const next = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0])
      if (!next || next === 1 || next === cur) break
      cur = next
    }
  }

  return qs
}

async function main() {
  if (!fs.existsSync(DUMP)) {
    console.error('Dump not found:', DUMP)
    process.exit(1)
  }
  console.log('Reading dump…', DUMP)
  const sql = fs.readFileSync(DUMP, 'utf8')
  const categories = parseCategories(extractInsert(sql, 'category'))
  const catAns = parseCatAns(extractInsert(sql, 'cat_ans'))
  console.log('parsed categories:', categories.length, 'cat_ans:', catAns.length)

  const byId = new Map(categories.map((c) => [c.cat_id, c]))
  const ansByQ = new Map()
  for (const a of catAns) {
    if (!ansByQ.has(a.cat_id)) ansByQ.set(a.cat_id, [])
    ansByQ.get(a.cat_id).push(a)
  }

  const globalQ = byId.get(1)
  const globalAns = ansByQ.get(1) || []

  const dumpServices = categories.filter(
    (c) => String(c.parent) === '0' && String(c.status).toLowerCase() === 'active',
  )

  const dbServices = await prisma.service.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true },
  })
  const byNorm = new Map()
  for (const s of dbServices) {
    byNorm.set(normName(s.name), s)
    byNorm.set(normName(s.slug.replace(/-/g, ' ')), s)
  }

  let updated = 0
  let skippedNoMatch = 0
  let skippedNoQs = 0
  let skippedJunk = 0
  const report = []

  for (const svc of dumpServices) {
    const db = byNorm.get(normName(svc.cat_name))
    if (!db) {
      skippedNoMatch++
      continue
    }

    let questions = buildQuestionList(svc, categories, ansByQ, byId)
    // Drop junk / empty-option questions
    questions = questions.filter((q) => {
      if (JUNK_LABEL.test(String(q.cat_name || '').trim())) return false
      const opts = (ansByQ.get(q.cat_id) || []).filter((a) => String(a.name || '').trim())
      return opts.length > 0
    })

    // Always append global "how likely" question (from dump) if present
    if (globalQ && globalAns.length && !questions.some((q) => q.cat_id === 1)) {
      questions.push({ ...globalQ, __global: true })
    }

    if (!questions.length) {
      skippedNoQs++
      continue
    }

    // Soft-deactivate existing active questions (keep lead answers intact)
    await prisma.question.updateMany({
      where: { serviceId: db.id, isActive: true },
      data: { isActive: false },
    })

    const oldToNew = new Map() // old cat_id -> new question id
    const created = []

    let sort = 0
    for (const q of questions) {
      sort += 1
      const type =
        String(q.child_type).toLowerCase() === 'cb' ? 'MULTIPLE_CHOICE' : 'SINGLE_CHOICE'
      const ansRows = q.__global || q.cat_id === 1 ? globalAns : ansByQ.get(q.cat_id) || []
      const cleanAns = ansRows.filter((a) => String(a.name || '').trim())
      if (!cleanAns.length) {
        skippedJunk++
        continue
      }

      const question = await prisma.question.create({
        data: {
          serviceId: db.id,
          label: String(q.cat_name).trim().slice(0, 250),
          type,
          isRequired: true,
          sortOrder: sort,
          isActive: true,
          options: {
            create: cleanAns.map((a, i) => ({
              label: String(a.name).trim().slice(0, 200),
              value: slugify(a.name, `opt-${a.id}`).slice(0, 120) || `opt-${a.id}`,
              sortOrder: i + 1,
            })),
          },
        },
        include: { options: { orderBy: { sortOrder: 'asc' } } },
      })
      oldToNew.set(q.cat_id, question.id)
      created.push({ q, question, ansRows: cleanAns })
    }

    // Branches from cat_ans.next
    for (const { question, ansRows } of created) {
      for (let i = 0; i < ansRows.length; i++) {
        const a = ansRows[i]
        const nextOld = Number(a.next)
        if (!nextOld || nextOld === 1) continue // 1 = global end / next common step
        const targetId = oldToNew.get(nextOld)
        if (!targetId || targetId === question.id) continue
        const option = question.options[i]
        if (!option) continue
        await prisma.questionBranch
          .create({
            data: {
              sourceQuestionId: question.id,
              targetQuestionId: targetId,
              optionId: option.id,
              operator: 'EQUALS',
              value: option.value,
            },
          })
          .catch(() => {})
      }
    }

    updated++
    report.push({
      dump: svc.cat_name,
      db: db.name,
      questions: created.length,
      options: created.reduce((n, c) => n + c.question.options.length, 0),
    })
    console.log(
      `✓ ${db.name}: ${created.length} questions, ${created.reduce((n, c) => n + c.question.options.length, 0)} options`,
    )
  }

  // Ensure every active DB service still has at least one active question
  const stillEmpty = await prisma.service.findMany({
    where: {
      isActive: true,
      questions: { none: { isActive: true } },
    },
    select: { id: true, name: true },
  })
  if (stillEmpty.length && globalQ && globalAns.length) {
    console.log(`\nRestoring generic question on ${stillEmpty.length} services with none…`)
    for (const s of stillEmpty) {
      await prisma.question.create({
        data: {
          serviceId: s.id,
          label: String(globalQ.cat_name).trim(),
          type: 'SINGLE_CHOICE',
          isRequired: true,
          sortOrder: 1,
          isActive: true,
          options: {
            create: globalAns.map((a, i) => ({
              label: String(a.name).trim().slice(0, 200),
              value: slugify(a.name, `opt-${a.id}`).slice(0, 120) || `opt-${a.id}`,
              sortOrder: i + 1,
            })),
          },
        },
      })
    }
  }

  // Final summary
  const active = await prisma.service.findMany({
    where: { isActive: true },
    select: {
      name: true,
      questions: {
        where: { isActive: true },
        select: { label: true, options: { select: { id: true } } },
      },
    },
  })
  const GENERIC = /how likely are you to use this service/i
  let withReal = 0
  let onlyGeneric = 0
  for (const s of active) {
    const real = s.questions.filter((q) => !GENERIC.test(q.label || ''))
    if (real.length) withReal++
    else if (s.questions.length) onlyGeneric++
  }

  console.log('\n=== DONE ===')
  console.log({
    dumpServicesActive: dumpServices.length,
    servicesUpdatedFromDump: updated,
    dumpServicesNoDbMatch: skippedNoMatch,
    dumpServicesNoUsableQuestions: skippedNoQs,
    activeDbServices: active.length,
    withRealQuestionnaires: withReal,
    onlyGenericQuestion: onlyGeneric,
  })
  console.log('\nUpdated detail:')
  report.forEach((r) => console.log(`  ${r.db}: ${r.questions}q / ${r.options} opts`))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
