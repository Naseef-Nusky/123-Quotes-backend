/**
 * Set User.createdAt ("Joined") from the old DB date (users.alogin,
 * which is stamped when the old row was created) instead of the
 * import-day date. Source: .import-cache/users.json (extractCheckareDump).
 * Safe to re-run. Super admin / non-dump accounts are untouched.
 */
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const CACHE = path.join(__dirname, '.import-cache')

function parseDbDate(v) {
  if (!v) return null
  const d = new Date(String(v).replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d
}

async function main() {
  const dumpUsers = JSON.parse(fs.readFileSync(path.join(CACHE, 'users.json'), 'utf8'))
  const byEmail = new Map()
  for (const u of dumpUsers) {
    const email = String(u.user_name || '').trim().toLowerCase()
    const date = parseDbDate(u.alogin)
    if (email.includes('@') && date) byEmail.set(email, date)
  }
  console.log('dump users with date:', byEmail.size)

  const users = await prisma.user.findMany({
    where: { role: { in: ['CUSTOMER', 'PROFESSIONAL'] } },
    select: { id: true, email: true, createdAt: true },
  })

  let updated = 0
  let skipped = 0
  for (const user of users) {
    const dbDate = byEmail.get(user.email.toLowerCase())
    if (!dbDate) {
      skipped += 1
      continue
    }
    if (user.createdAt?.getTime() !== dbDate.getTime()) {
      await prisma.user.update({ where: { id: user.id }, data: { createdAt: dbDate } })
      updated += 1
    }
  }
  console.log({ total: users.length, updated, skipped })

  const sample = await prisma.user.findMany({
    where: { role: 'CUSTOMER' },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { email: true, createdAt: true },
  })
  console.log('newest customers:', sample)
  const oldest = await prisma.user.findMany({
    where: { role: 'CUSTOMER' },
    orderBy: { createdAt: 'asc' },
    take: 2,
    select: { email: true, createdAt: true },
  })
  console.log('oldest customers:', oldest)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
