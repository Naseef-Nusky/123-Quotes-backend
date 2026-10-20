/**
 * Backfill CustomerRequest.contactName/Email/Phone from linked CustomerProfile/User.
 *   node scripts/backfillLeadContacts.js
 */
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  const rows = await prisma.customerRequest.findMany({
    where: { customerId: { not: null } },
    include: {
      customer: { include: { user: { select: { email: true } } } },
    },
  })
  console.log('Requests with customer:', rows.length)
  let updated = 0
  for (const r of rows) {
    const email = r.customer?.user?.email || null
    const phone = r.customer?.phone || null
    const name = [r.customer?.firstName, r.customer?.lastName].filter(Boolean).join(' ').trim() || null
    if (!email && !phone && !name) continue
    await prisma.customerRequest.update({
      where: { id: r.id },
      data: {
        contactEmail: email,
        contactPhone: phone,
        contactName: name,
      },
    })
    updated += 1
    if (updated % 200 === 0) console.log('  updated', updated)
  }
  console.log('Done. Backfilled', updated)
  const withEmail = await prisma.customerRequest.count({ where: { contactEmail: { not: null } } })
  console.log('Requests with contactEmail:', withEmail)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
