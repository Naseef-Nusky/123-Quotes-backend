/**
 * Fast legacy import (resumable).
 * Cache: scripts/.import-cache/
 *
 *   node scripts/importLegacyCheckare.js
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')
const { randomUUID } = require('crypto')

const prisma = new PrismaClient()
const CACHE = path.join(__dirname, '.import-cache')
const IMPORT_TAG = 'legacy-checkare'
const STUB_PASSWORD = 'ImportLegacy123!'

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(CACHE, name), 'utf8'))
}
function* readJsonl(name) {
  for (const line of fs.readFileSync(path.join(CACHE, name), 'utf8').split('\n')) {
    if (line.trim()) yield JSON.parse(line)
  }
}
function slugify(input, fallback = 'item') {
  const s = String(input || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return s || fallback
}
function splitName(name) {
  const parts = String(name || 'Imported User').trim().split(/\s+/)
  return { firstName: parts[0] || 'Imported', lastName: parts.slice(1).join(' ') || 'User' }
}
function postcodeFromPostal(row) {
  if (!row) return 'UK'
  return String(row.code || row.code2 || '').trim().toUpperCase() || 'UK'
}
function outcodeFromPostcode(pc) {
  const m = String(pc || '')
    .toUpperCase()
    .trim()
    .match(/^([A-Z]{1,2}\d{1,2}[A-Z]?)/)
  return m ? m[1] : null
}
async function chunked(items, size, fn) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size), i)
}

async function ensureUsers(proIds, customerIds, userByOldId, passwordHash, realHashes) {
  const oldProToProfile = new Map()
  const oldProToUser = new Map()
  const oldCustToProfile = new Map()

  // Create any missing pro users in one createMany, then attach profiles
  const missingPros = []
  for (const oldId of proIds) {
    const src = userByOldId[oldId]
    const email = src?.user_name
      ? String(src.user_name).trim().toLowerCase()
      : `imported-pro-${oldId}@${IMPORT_TAG}.local`
    missingPros.push({
      oldId,
      email,
      hash: realHashes.get(oldId) || passwordHash,
      ...splitName(src?.name || `Pro ${oldId}`),
      phone: src?.contact ? String(src.contact) : null,
      companyName: src?.name || `Imported Pro ${oldId}`,
    })
  }
  await prisma.user.createMany({
    data: missingPros.map((r) => ({
      email: r.email,
      passwordHash: r.hash,
      role: 'PROFESSIONAL',
      status: 'ACTIVE',
      emailVerified: true,
    })),
    skipDuplicates: true,
  })

  const proUsers = await prisma.user.findMany({
    where: { role: 'PROFESSIONAL' },
    include: { professional: true },
  })
  const proByEmail = new Map(proUsers.map((u) => [u.email.toLowerCase(), u]))

  const profilesToCreate = []
  for (const r of missingPros) {
    const user = proByEmail.get(r.email)
    if (!user) continue
    if (!user.professional) {
      const id = randomUUID()
      profilesToCreate.push({
        id,
        userId: user.id,
        companyName: r.companyName,
        contactName: `${r.firstName} ${r.lastName}`.trim(),
        phone: r.phone,
      })
      oldProToUser.set(r.oldId, user.id)
      oldProToProfile.set(r.oldId, id)
    } else {
      oldProToUser.set(r.oldId, user.id)
      oldProToProfile.set(r.oldId, user.professional.id)
    }
  }
  if (profilesToCreate.length) {
    await prisma.professionalProfile.createMany({ data: profilesToCreate, skipDuplicates: true })
  }
  console.log('Pros mapped', oldProToProfile.size)

  // Customers
  const missingCust = []
  for (const oldId of customerIds) {
    const src = userByOldId[oldId]
    const email = src?.user_name
      ? String(src.user_name).trim().toLowerCase()
      : `imported-customer-${oldId}@${IMPORT_TAG}.local`
    missingCust.push({
      oldId,
      email,
      stubEmail: `imported-customer-${oldId}@${IMPORT_TAG}.local`,
      hash: realHashes.get(oldId) || passwordHash,
      ...splitName(src?.name || `Customer ${oldId}`),
      phone: src?.contact ? String(src.contact) : null,
    })
  }
  await prisma.user.createMany({
    data: missingCust.map((r) => ({
      email: r.email,
      passwordHash: r.hash,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerified: true,
    })),
    skipDuplicates: true,
  })
  // Also ensure stub emails exist for conflict cases
  await prisma.user.createMany({
    data: missingCust.map((r) => ({
      email: r.stubEmail,
      passwordHash: r.hash,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerified: true,
    })),
    skipDuplicates: true,
  })

  const custUsers = await prisma.user.findMany({
    where: { role: 'CUSTOMER' },
    include: { customer: true },
  })
  const custByEmail = new Map(custUsers.map((u) => [u.email.toLowerCase(), u]))

  const custProfiles = []
  for (const r of missingCust) {
    const user = custByEmail.get(r.email) || custByEmail.get(r.stubEmail)
    if (!user) continue
    if (!user.customer) {
      const id = randomUUID()
      custProfiles.push({
        id,
        userId: user.id,
        firstName: r.firstName,
        lastName: r.lastName,
        phone: r.phone,
      })
      oldCustToProfile.set(r.oldId, id)
    } else {
      oldCustToProfile.set(r.oldId, user.customer.id)
    }
  }
  if (custProfiles.length) {
    await prisma.customerProfile.createMany({ data: custProfiles, skipDuplicates: true })
  }
  console.log('Customers mapped', oldCustToProfile.size)

  return { oldProToProfile, oldProToUser, oldCustToProfile }
}

async function main() {
  if (!fs.existsSync(path.join(CACHE, 'users.json'))) {
    throw new Error('Missing import cache.')
  }

  console.log('Loading cache…')
  const users = loadJson('users.json')
  const categories = loadJson('category.json')
  const catAns = loadJson('cat_ans.json')
  const clientRequ = loadJson('client_requ.json')
  const leadsFiles = loadJson('leads_files.json')
  const options = loadJson('options.json')
  const orders = loadJson('orders.json')
  const proMeta = loadJson('pro_meta.json')
  const proPoints = loadJson('pro_points.json')
  const reviews = loadJson('reviews.json')
  const postalMap = loadJson('postal_codes_subset.json')

  const passwordHash = await bcrypt.hash(STUB_PASSWORD, 10)
  const userByOldId = Object.fromEntries(users.map((u) => [Number(u.user_id), u]))
  const realHashes = new Map()
  for (const u of users) {
    if (u.password) realHashes.set(Number(u.user_id), await bcrypt.hash(String(u.password), 10))
  }

  const proIds = new Set()
  const customerIds = new Set()
  for (const u of users) {
    if (String(u.user_type).toLowerCase() === 'pro') proIds.add(Number(u.user_id))
    else customerIds.add(Number(u.user_id))
  }
  for (const r of clientRequ) {
    customerIds.add(Number(r.client_id))
    proIds.add(Number(r.pro_id))
  }
  for (const r of reviews) {
    proIds.add(Number(r.company_id))
    customerIds.add(Number(r.review_user_id))
  }
  for (const r of orders) proIds.add(Number(r.user_id))
  for (const r of proPoints) proIds.add(Number(r.user_id))
  for (const r of proMeta) proIds.add(Number(r.user_id))
  for (const lead of readJsonl('leads.jsonl')) {
    const uid = Number(lead.user_id)
    if (uid) customerIds.add(uid)
  }

  const { oldProToProfile, oldProToUser, oldCustToProfile } = await ensureUsers(
    proIds,
    customerIds,
    userByOldId,
    passwordHash,
    realHashes,
  )

  let guest = await prisma.user.findUnique({
    where: { email_role: { email: `guest@${IMPORT_TAG}.local`, role: 'CUSTOMER' } },
    include: { customer: true },
  })
  if (!guest) {
    guest = await prisma.user.create({
      data: {
        email: `guest@${IMPORT_TAG}.local`,
        passwordHash,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        emailVerified: true,
        customer: { create: { firstName: 'Guest', lastName: 'Imported' } },
      },
      include: { customer: true },
    })
  } else if (!guest.customer) {
    await prisma.customerProfile.create({
      data: { userId: guest.id, firstName: 'Guest', lastName: 'Imported' },
    })
    guest = await prisma.user.findUnique({
      where: { id: guest.id },
      include: { customer: true },
    })
  }
  const guestCustomerId = guest.customer.id

  console.log('Services…')
  let importCategory = await prisma.category.findUnique({ where: { slug: 'imported-checkare' } })
  if (!importCategory) {
    importCategory = await prisma.category.create({
      data: {
        name: 'Imported Services',
        slug: 'imported-checkare',
        description: 'Services imported from legacy Checkare database',
        isActive: true,
      },
    })
  }

  const oldCatToService = new Map()
  const usedSlugs = new Set((await prisma.service.findMany({ select: { slug: true } })).map((s) => s.slug))
  for (const c of categories.filter((x) => String(x.parent) === '0')) {
    let slug = slugify(c.cat_name, `service-${c.cat_id}`)
    if (usedSlugs.has(slug)) slug = `${slug}-${c.cat_id}`
    usedSlugs.add(slug)
    let service = await prisma.service.findUnique({ where: { slug } })
    if (!service) {
      try {
        service = await prisma.service.create({
          data: {
            categoryId: importCategory.id,
            name: String(c.cat_name).slice(0, 200),
            slug,
            shortDesc: String(c.cat_name).slice(0, 160),
            description: `Imported #${c.cat_id}`,
            tokenCost: 1,
            isActive: true,
            sortOrder: Number(c.cat_id) || 0,
          },
        })
      } catch {
        service = await prisma.service.findUnique({ where: { slug } })
        if (!service) {
          slug = `imported-${c.cat_id}-${slug}`.slice(0, 80)
          service = await prisma.service.create({
            data: {
              categoryId: importCategory.id,
              name: String(c.cat_name).slice(0, 200),
              slug,
              tokenCost: 1,
              isActive: true,
              sortOrder: Number(c.cat_id) || 0,
            },
          })
        }
      }
    }
    oldCatToService.set(Number(c.cat_id), service.id)

    const childQs = categories.filter(
      (q) =>
        String(q.parent) === String(c.cat_id) &&
        ['rb', 'cb'].includes(String(q.child_type).toLowerCase()),
    )
    let sort = 0
    for (const q of childQs) {
      sort += 1
      let question = await prisma.question.findFirst({
        where: { serviceId: service.id, label: String(q.cat_name).slice(0, 250) },
      })
      if (!question) {
        question = await prisma.question.create({
          data: {
            serviceId: service.id,
            label: String(q.cat_name).slice(0, 250),
            type: String(q.child_type).toLowerCase() === 'cb' ? 'MULTIPLE_CHOICE' : 'SINGLE_CHOICE',
            isRequired: false,
            sortOrder: sort,
            isActive: true,
          },
        })
      }
      let oi = 0
      for (const a of catAns.filter((x) => Number(x.cat_id) === Number(q.cat_id))) {
        oi += 1
        const value = slugify(a.name, `opt-${a.id}`)
        const found = await prisma.answerOption.findFirst({ where: { questionId: question.id, value } })
        if (!found) {
          await prisma.answerOption.create({
            data: {
              questionId: question.id,
              label: String(a.name).slice(0, 200),
              value,
              sortOrder: oi,
            },
          })
        }
      }
    }
  }
  for (const missingId of [155, 156, 158]) {
    if (oldCatToService.has(missingId)) continue
    const slug = `imported-missing-${missingId}`
    let service = await prisma.service.findUnique({ where: { slug } })
    if (!service) {
      service = await prisma.service.create({
        data: {
          categoryId: importCategory.id,
          name: `Imported Service ${missingId}`,
          slug,
          tokenCost: 1,
          isActive: true,
        },
      })
    }
    oldCatToService.set(missingId, service.id)
  }
  console.log('Services', oldCatToService.size)

  // pro_meta
  const metaByUser = new Map()
  for (const m of proMeta) {
    const uid = Number(m.user_id)
    if (!metaByUser.has(uid)) metaByUser.set(uid, {})
    metaByUser.get(uid)[m.meta_key] = m.meta_value
  }
  for (const [oldId, meta] of metaByUser) {
    const profileId = oldProToProfile.get(oldId)
    if (!profileId) continue
    const postal = meta.postcode ? postalMap[String(meta.postcode)] : null
    try {
      await prisma.professionalProfile.update({
        where: { id: profileId },
        data: {
          ...(meta.cname ? { companyName: String(meta.cname).trim() } : {}),
          ...(meta.website != null ? { website: String(meta.website) } : {}),
          ...(meta.des ? { bio: String(meta.des) } : {}),
          ...(postal ? { postcode: postcodeFromPostal(postal) } : {}),
        },
      })
      if (meta.job_id && oldCatToService.has(Number(meta.job_id))) {
        const serviceId = oldCatToService.get(Number(meta.job_id))
        await prisma.professionalService.upsert({
          where: { professionalId_serviceId: { professionalId: profileId, serviceId } },
          create: { professionalId: profileId, serviceId },
          update: {},
        })
      }
    } catch {
      /* skip */
    }
  }

  for (const opt of options) {
    await prisma.setting.upsert({
      where: { key: String(opt.option_key) },
      create: { key: String(opt.option_key), value: String(opt.option_value ?? '') },
      update: { value: String(opt.option_value ?? '') },
    })
  }

  console.log('Indexing meta/files…')
  const metaByLead = new Map()
  for (const m of readJsonl('leads_meta.jsonl')) {
    const lid = Number(m.lead_id)
    if (!metaByLead.has(lid)) metaByLead.set(lid, [])
    metaByLead.get(lid).push(`${m.meta_key}: ${m.meta_value}`)
  }
  const filesByLead = new Map()
  for (const f of leadsFiles) {
    const lid = Number(f.lead_id)
    if (!filesByLead.has(lid)) filesByLead.set(lid, [])
    filesByLead.get(lid).push(f)
  }

  const existingTitles = new Set(
    (
      await prisma.customerRequest.findMany({
        where: { title: { startsWith: `[${IMPORT_TAG}]` } },
        select: { title: true },
      })
    ).map((r) => r.title),
  )
  console.log('Already imported leads', existingTitles.size)

  const leadRows = [...readJsonl('leads.jsonl')]
  let leadOk = 0
  let leadSkip = 0
  console.log('Importing leads…', leadRows.length)

  await chunked(leadRows, 80, async (batch) => {
    const ops = []
    for (const lead of batch) {
      const oldLeadId = Number(lead.lead_id)
      const title = `[${IMPORT_TAG}] Lead #${oldLeadId}`
      if (existingTitles.has(title)) {
        leadSkip += 1
        continue
      }
      const serviceId = oldCatToService.get(Number(lead.cat_id))
      if (!serviceId) {
        leadSkip += 1
        continue
      }
      const oldUid = Number(lead.user_id) || 0
      const customerId = (oldUid && oldCustToProfile.get(oldUid)) || guestCustomerId
      if (!customerId) {
        leadSkip += 1
        continue
      }
      const postal = postalMap[String(lead.postalcode_id)]
      const postcode = postcodeFromPostal(postal)
      const metaLines = metaByLead.get(oldLeadId) || []
      const description = [lead.description, metaLines.length ? metaLines.join('\n') : null]
        .filter(Boolean)
        .join('\n\n')
      const createdAt = lead.rec_date ? new Date(lead.rec_date) : new Date()
      const requestId = randomUUID()
      const leadId = randomUUID()
      const attachments = (filesByLead.get(oldLeadId) || []).map((file) => {
        const ext = String(file.ext || 'bin').replace(/^\./, '').toLowerCase()
        return {
          id: randomUUID(),
          requestId,
          originalName: `legacy-file-${file.file_id}.${ext}`,
          storedName: `legacy-missing-${file.file_id}.${ext}`,
          mimeType:
            ext === 'pdf'
              ? 'application/pdf'
              : ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)
                ? `image/${ext === 'jpg' ? 'jpeg' : ext}`
                : 'application/octet-stream',
          sizeBytes: 0,
          ext,
        }
      })
      ops.push({
        request: {
          id: requestId,
          customerId,
          serviceId,
          status: 'SUBMITTED',
          title,
          description: description || null,
          postcode,
          city: postal?.district || postal?.ward || null,
          submittedAt: createdAt,
          createdAt,
          updatedAt: createdAt,
        },
        lead: {
          id: leadId,
          requestId,
          serviceId,
          status: 'OPEN',
          summary: String(lead.description || '').slice(0, 300) || null,
          postcode,
          city: postal?.district || null,
          tokenCost: 1,
          createdAt,
          updatedAt: createdAt,
        },
        attachments,
      })
    }
    if (!ops.length) return
    await prisma.customerRequest.createMany({ data: ops.map((o) => o.request) })
    await prisma.lead.createMany({ data: ops.map((o) => o.lead) })
    const atts = ops.flatMap((o) => o.attachments)
    if (atts.length) await prisma.requestAttachment.createMany({ data: atts })
    leadOk += ops.length
    if (leadOk % 400 === 0) console.log(`  leads ${leadOk}`)
  })
  console.log('Leads', { leadOk, leadSkip })

  // Outcodes (unique)
  const outcodes = new Map()
  for (const lead of leadRows) {
    const postal = postalMap[String(lead.postalcode_id)]
    const pc = postcodeFromPostal(postal)
    const oc = outcodeFromPostcode(pc)
    if (oc && !outcodes.has(oc)) {
      outcodes.set(oc, {
        outcode: oc,
        town: postal?.district || null,
        region: postal?.ward || null,
        country: postal?.Country || 'UK',
        latitude: postal?.latitude ? Number(postal.latitude) || null : null,
        longitude: postal?.longitude ? Number(postal.longitude) || null : null,
      })
    }
  }
  await chunked([...outcodes.values()], 100, async (batch) => {
    await prisma.ukOutcode.createMany({ data: batch, skipDuplicates: true })
  })
  console.log('Outcodes', outcodes.size)

  let msgOk = 0
  const existingMsg = await prisma.clientMessage.count()
  if (existingMsg < 50) {
    console.log('Messages…')
    const msgRows = []
    for (const m of clientRequ) {
      const customerId = oldCustToProfile.get(Number(m.client_id))
      const professionalId = oldProToProfile.get(Number(m.pro_id))
      if (!customerId || !professionalId) continue
      msgRows.push({
        id: randomUUID(),
        customerId,
        professionalId,
        senderRole: 'CUSTOMER',
        message: String(m.message || ''),
        status: String(m.status).toLowerCase() === 'active' ? 'ACTIVE' : 'ARCHIVED',
        updatedAt: new Date(),
      })
    }
    await chunked(msgRows, 250, async (batch) => {
      await prisma.clientMessage.createMany({ data: batch })
      msgOk += batch.length
    })
  } else {
    console.log('Messages already present:', existingMsg)
    msgOk = existingMsg
  }

  let revOk = 0
  for (const r of reviews) {
    const professionalId = oldProToProfile.get(Number(r.company_id))
    const customerId = oldCustToProfile.get(Number(r.review_user_id))
    if (!professionalId || !customerId) continue
    try {
      await prisma.review.upsert({
        where: { professionalId_customerId: { professionalId, customerId } },
        create: {
          professionalId,
          customerId,
          title: String(r.review_title || 'Review').slice(0, 250),
          body: String(r.review_text || ''),
          rating: Math.min(5, Math.max(1, Number(r.review_star_value) || 1)),
          status:
            String(r.status).toLowerCase() === 'approved' || String(r.status).toLowerCase() === 'active'
              ? 'APPROVED'
              : 'PENDING',
          createdAt: r.created_at ? new Date(r.created_at) : new Date(),
        },
        update: {
          title: String(r.review_title || 'Review').slice(0, 250),
          body: String(r.review_text || ''),
          rating: Math.min(5, Math.max(1, Number(r.review_star_value) || 1)),
        },
      })
      revOk += 1
    } catch {
      /* skip */
    }
  }

  let payOk = 0
  for (const o of orders) {
    const userId = oldProToUser.get(Number(o.user_id))
    if (!userId) continue
    const ref = `legacy-order-${o.order_id}`
    const exists = await prisma.payment.findFirst({ where: { providerPaymentId: ref } })
    if (exists) continue
    await prisma.payment.create({
      data: {
        userId,
        amountCents: Math.round(Number(o.amount || 0) * 100),
        currency: 'GBP',
        status:
          String(o.p_status).toLowerCase() === 'completed' || String(o.status).toLowerCase() === 'completed'
            ? 'COMPLETED'
            : 'PENDING',
        provider: 'legacy-import',
        providerPaymentId: ref,
        meta: { source: IMPORT_TAG, points: o.points, legacyOrderId: o.order_id },
      },
    })
    payOk += 1
  }

  let txnOk = 0
  for (const t of proPoints) {
    const professionalId = oldProToProfile.get(Number(t.user_id))
    if (!professionalId) continue
    const type = String(t.trans_type).toLowerCase() === 'lead' ? 'UNLOCK' : 'PURCHASE'
    const amount = Number(t.amount) || 0
    const ref = `legacy-points-${t.id}`
    const exists = await prisma.tokenTransaction.findFirst({ where: { reference: ref } })
    if (exists) continue
    await prisma.tokenTransaction.create({
      data: {
        professionalId,
        type,
        amount: type === 'UNLOCK' ? -Math.abs(amount) : Math.abs(amount),
        balanceAfter: 0,
        reference: ref,
        meta: { source: IMPORT_TAG },
        createdAt: t.rec_date ? new Date(t.rec_date) : new Date(),
      },
    })
    if (type === 'PURCHASE' && amount > 0) {
      await prisma.professionalProfile.update({
        where: { id: professionalId },
        data: { tokenBalance: { increment: amount } },
      })
    }
    txnOk += 1
  }

  const summary = {
    importedAt: new Date().toISOString(),
    pros: oldProToProfile.size,
    customers: oldCustToProfile.size,
    services: oldCatToService.size,
    leads: leadOk,
    leadSkip,
    messages: msgOk,
    reviews: revOk,
    payments: payOk,
    tokenTxns: txnOk,
  }
  fs.writeFileSync(path.join(CACHE, 'import-summary.json'), JSON.stringify(summary, null, 2))
  console.log('\nDONE', summary)
  console.log('Stub password:', STUB_PASSWORD)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
