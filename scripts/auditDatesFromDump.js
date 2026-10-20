/**
 * Audit: compare live DB dates against the old-DB source dates
 * in .import-cache (extractCheckareDump output). Read-only.
 */
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const CACHE = path.join(__dirname, '.import-cache')
const loadJson = (n) => JSON.parse(fs.readFileSync(path.join(CACHE, n), 'utf8'))
const sameDay = (a, b) =>
  a && b && new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10)

async function main() {
  const report = {}

  // 1) Users: createdAt == users.alogin
  const dumpUsers = loadJson('users.json')
  const aloginByEmail = new Map(
    dumpUsers
      .filter((u) => String(u.user_name || '').includes('@'))
      .map((u) => [String(u.user_name).trim().toLowerCase(), u.alogin]),
  )
  const users = await prisma.user.findMany({
    where: { role: { in: ['CUSTOMER', 'PROFESSIONAL'] } },
    select: { email: true, createdAt: true },
  })
  let ok = 0
  let bad = 0
  for (const u of users) {
    const src = aloginByEmail.get(u.email.toLowerCase())
    if (src && sameDay(u.createdAt, src)) ok += 1
    else bad += 1
  }
  report.users = { total: users.length, dateMatchesDump: ok, mismatches: bad }

  // 2) Leads + requests: createdAt == leads.rec_date (via "[tag] Lead #id" title)
  const recDateByLeadId = new Map()
  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(CACHE, 'leads.jsonl')),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    if (!line.trim()) continue
    const l = JSON.parse(line)
    recDateByLeadId.set(Number(l.lead_id), l.rec_date)
  }
  const requests = await prisma.customerRequest.findMany({
    select: { title: true, createdAt: true, submittedAt: true },
  })
  ok = 0
  bad = 0
  for (const r of requests) {
    const m = /Lead #(\d+)/.exec(r.title || '')
    const src = m ? recDateByLeadId.get(Number(m[1])) : null
    if (src && sameDay(r.createdAt, src) && sameDay(r.submittedAt, src)) ok += 1
    else bad += 1
  }
  report.leadRequests = { total: requests.length, dateMatchesDump: ok, mismatches: bad }

  const leads = await prisma.lead.findMany({
    select: { createdAt: true, request: { select: { title: true } } },
  })
  ok = 0
  bad = 0
  for (const l of leads) {
    const m = /Lead #(\d+)/.exec(l.request?.title || '')
    const src = m ? recDateByLeadId.get(Number(m[1])) : null
    if (src && sameDay(l.createdAt, src)) ok += 1
    else bad += 1
  }
  report.leads = { total: leads.length, dateMatchesDump: ok, mismatches: bad }

  // 3) Reviews: createdAt vs reviews.created_at (single row expected)
  const dumpReviews = loadJson('reviews.json')
  const reviews = await prisma.review.findMany({ select: { createdAt: true, legacyProId: true } })
  report.reviews = {
    dump: dumpReviews.length,
    db: reviews.length,
    dbDates: reviews.map((r) => r.createdAt),
    dumpDates: dumpReviews.map((r) => r.created_at),
  }

  // 4) Token transactions: createdAt == pro_points.rec_date (reference legacy-points-{id})
  const points = loadJson('pro_points.json')
  const recByPointsId = new Map(points.map((p) => [Number(p.id), p.rec_date]))
  const txns = await prisma.tokenTransaction.findMany({
    where: { reference: { startsWith: 'legacy-points-' } },
    select: { reference: true, createdAt: true },
  })
  ok = 0
  bad = 0
  for (const t of txns) {
    const src = recByPointsId.get(Number(t.reference.replace('legacy-points-', '')))
    if (src && sameDay(t.createdAt, src)) ok += 1
    else bad += 1
  }
  report.tokenTransactions = { total: txns.length, dateMatchesDump: ok, mismatches: bad }

  // 5) Declined matches: matchedAt == decline_leads.date_log
  const declines = loadJson('decline_leads.json')
  report.declinedMatches = {
    dumpRows: declines.length,
    dumpDates: declines.map((d) => d.date_log),
  }

  // 6) Tables whose old-DB source has NO date column (import-day dates, nothing to match):
  const counts = {
    payments: await prisma.payment.count(),
    messages: await prisma.clientMessage.count(),
    categories: await prisma.category.count(),
    postcodes: await prisma.ukOutcode.count(),
  }
  report.noSourceDateInDump = {
    note: 'orders, client_requ, category, postal_codes have no date column in the old DB',
    counts,
  }

  // Import-day stamp check: which tables still show only today (import day)?
  const importDay = '2026-10-20'
  const custToday = await prisma.user.count({
    where: { role: 'CUSTOMER', createdAt: { gte: new Date(importDay) } },
  })
  report.customersStillStampedImportDay = custToday

  console.log(JSON.stringify(report, null, 2))
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
