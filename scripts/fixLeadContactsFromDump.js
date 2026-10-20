/**
 * Fully refresh lead contact fields from checkare_hunto extract cache.
 * - Parses Lead #id from request title
 * - Maps leads.user_id → users (req OR pro)
 * - Sets contactName / contactEmail / contactPhone
 * - Links customerId when a CUSTOMER profile exists for that email
 *
 *   node scripts/fixLeadContactsFromDump.js
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const CACHE = path.join(__dirname, '.import-cache')

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(CACHE, name), 'utf8'))
}

function splitName(name, email) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length) {
    return { firstName: parts[0], lastName: parts.slice(1).join(' ') || '' }
  }
  const local = String(email || '').split('@')[0] || 'Lead'
  return { firstName: local, lastName: '' }
}

async function main() {
  const users = loadJson('users.json')
  const userByOld = new Map()
  for (const u of users) {
    userByOld.set(Number(u.user_id), u)
  }

  const leadByOld = new Map()
  for (const line of fs.readFileSync(path.join(CACHE, 'leads.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue
    const row = JSON.parse(line)
    leadByOld.set(Number(row.lead_id), row)
  }

  const customers = await prisma.user.findMany({
    where: { role: 'CUSTOMER' },
    include: { customer: true },
  })
  const custByEmail = new Map(
    customers.filter((u) => u.customer).map((u) => [u.email.toLowerCase(), u.customer]),
  )

  const requests = await prisma.customerRequest.findMany({
    select: {
      id: true,
      title: true,
      legacyUserId: true,
      customerId: true,
      contactEmail: true,
      contactPhone: true,
      contactName: true,
    },
  })

  let updated = 0
  let linked = 0
  let withEmail = 0
  let withPhone = 0
  let noSource = 0

  for (const req of requests) {
    let oldLeadId = null
    const m = String(req.title || '').match(/Lead\s*#(\d+)/i)
    if (m) oldLeadId = Number(m[1])

    const dumpLead = oldLeadId != null ? leadByOld.get(oldLeadId) : null
    let oldUid = req.legacyUserId || (dumpLead ? Number(dumpLead.user_id) || 0 : 0)
    if (!oldUid) {
      noSource += 1
      continue
    }

    const src = userByOld.get(oldUid)
    if (!src) {
      noSource += 1
      continue
    }

    const email = String(src.user_name || '')
      .trim()
      .toLowerCase()
    if (!email.includes('@')) {
      noSource += 1
      continue
    }
    const phone = String(src.contact || '').trim() || null
    const { firstName, lastName } = splitName(src.name, email)
    const contactName = `${firstName} ${lastName}`.trim() || email.split('@')[0]

    const customer = custByEmail.get(email)
    const data = {
      legacyUserId: oldUid,
      contactEmail: email,
      contactPhone: phone,
      contactName,
    }
    if (customer && !req.customerId) {
      data.customerId = customer.id
      linked += 1
    }

    // Also refresh customer profile phone/name when empty
    if (customer) {
      await prisma.customerProfile.update({
        where: { id: customer.id },
        data: {
          ...(customer.phone ? {} : phone ? { phone } : {}),
          ...(customer.firstName && customer.firstName !== 'Imported' && customer.firstName !== 'Lead'
            ? {}
            : { firstName }),
          ...(customer.lastName && customer.lastName !== 'User' && customer.lastName !== 'Contact'
            ? {}
            : lastName
              ? { lastName }
              : {}),
        },
      })
    }

    await prisma.customerRequest.update({ where: { id: req.id }, data })
    updated += 1
    withEmail += 1
    if (phone) withPhone += 1
    if (updated % 300 === 0) console.log('  updated', updated)
  }

  console.log({
    requests: requests.length,
    updated,
    newlyLinkedCustomers: linked,
    withEmail,
    withPhone,
    noSourceInDump: noSource,
  })
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
