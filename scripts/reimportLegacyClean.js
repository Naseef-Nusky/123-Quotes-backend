/**
 * Clean re-import from checkare dump cache.
 * - Real users: user_name → User.email (correct)
 * - Missing users: NO fake accounts / stub emails
 * - Orphan leads (no matching users row) → skipped (proper FK only)
 *
 *   node scripts/reimportLegacyClean.js
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')
const { randomUUID } = require('crypto')

const prisma = new PrismaClient()
const CACHE = path.join(__dirname, '.import-cache')
const TAG = 'legacy-checkare'
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
async function chunked(items, size, fn) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size), i)
}

async function cleanupPreviousImport() {
  console.log('Cleaning previous legacy import…')

  // Delete requests/leads tagged from import
  const tagged = await prisma.customerRequest.findMany({
    where: { title: { startsWith: `[${TAG}]` } },
    select: { id: true },
  })
  console.log('  tagged requests', tagged.length)
  await chunked(tagged.map((t) => t.id), 100, async (ids) => {
    await prisma.customerRequest.deleteMany({ where: { id: { in: ids } } })
  })

  // Clear imported messages/reviews/payments/token txns first (FK restrict)
  await prisma.clientMessage.deleteMany({})
  await prisma.review.deleteMany({})
  await prisma.payment.deleteMany({ where: { provider: 'legacy-import' } })
  await prisma.tokenTransaction.deleteMany({
    where: { reference: { startsWith: 'legacy-points-' } },
  })

  // Delete stub users (@legacy-checkare.local) — cascades profiles/requests
  const stubs = await prisma.user.findMany({
    where: { email: { endsWith: '@legacy-checkare.local' } },
    select: { id: true },
  })
  console.log('  stub users', stubs.length)
  // Any remaining payments for these users
  await chunked(
    stubs.map((s) => s.id),
    50,
    async (ids) => {
      await prisma.payment.deleteMany({ where: { userId: { in: ids } } })
      await prisma.notification.deleteMany({ where: { userId: { in: ids } } })
      await prisma.activityLog.deleteMany({ where: { userId: { in: ids } } })
      await prisma.user.deleteMany({ where: { id: { in: ids } } })
    },
  )

  console.log('Cleanup done')
}

async function main() {
  if (!fs.existsSync(path.join(CACHE, 'users.json'))) {
    throw new Error('Missing cache. Extract dump first.')
  }

  await cleanupPreviousImport()

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
  const oldProToProfile = new Map()
  const oldProToUser = new Map()
  const oldCustToProfile = new Map()

  console.log('Importing REAL users from users.user_name → email…', users.length)
  for (const u of users) {
    const oldId = Number(u.user_id)
    const email = String(u.user_name || '').trim().toLowerCase()
    if (!email || !email.includes('@')) {
      console.warn('  skip user without email user_name:', oldId, u.user_name)
      continue
    }
    const isPro = String(u.user_type).toLowerCase() === 'pro'
    const role = isPro ? 'PROFESSIONAL' : 'CUSTOMER'
    const { firstName, lastName } = splitName(u.name)
    const phone = u.contact ? String(u.contact) : null
    const hash = u.password ? await bcrypt.hash(String(u.password), 10) : passwordHash

    let user = await prisma.user.findUnique({
      where: { email_role: { email, role } },
      include: { customer: true, professional: true },
    })

    if (!user) {
      if (isPro) {
        user = await prisma.user.create({
          data: {
            email, // from user_name
            passwordHash: hash,
            role: 'PROFESSIONAL',
            status: 'ACTIVE',
            emailVerified: true,
            lastLoginAt: u.alogin ? new Date(u.alogin) : null,
            professional: {
              create: {
                companyName: String(u.name || email).trim(),
                contactName: `${firstName} ${lastName}`.trim(),
                phone,
              },
            },
          },
          include: { professional: true, customer: true },
        })
      } else {
        user = await prisma.user.create({
          data: {
            email, // from user_name
            passwordHash: hash,
            role: 'CUSTOMER',
            status: 'ACTIVE',
            emailVerified: true,
            lastLoginAt: u.alogin ? new Date(u.alogin) : null,
            customer: {
              create: { firstName, lastName, phone },
            },
          },
          include: { professional: true, customer: true },
        })
      }
    } else {
      // ensure profile + refresh email already correct
      if (isPro && !user.professional) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            professional: {
              create: {
                companyName: String(u.name || email).trim(),
                contactName: `${firstName} ${lastName}`.trim(),
                phone,
              },
            },
          },
          include: { professional: true, customer: true },
        })
      }
      if (!isPro && !user.customer) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { customer: { create: { firstName, lastName, phone } } },
          include: { professional: true, customer: true },
        })
      }
    }

    if (isPro && user.professional) {
      oldProToProfile.set(oldId, user.professional.id)
      oldProToUser.set(oldId, user.id)
      console.log(`  PRO  ${email} ← user_name (old #${oldId})`)
    } else if (user.customer) {
      oldCustToProfile.set(oldId, user.customer.id)
      console.log(`  CUST ${email} ← user_name (old #${oldId})`)
    }
  }

  console.log('Services…')
  let importCategory = await prisma.category.findUnique({ where: { slug: 'imported-checkare' } })
  if (!importCategory) {
    importCategory = await prisma.category.create({
      data: {
        name: 'Imported Services',
        slug: 'imported-checkare',
        description: 'Imported from Checkare',
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
            tokenCost: 1,
            isActive: true,
            sortOrder: Number(c.cat_id) || 0,
          },
        })
      } catch {
        service = await prisma.service.findUnique({ where: { slug } })
        if (!service) {
          slug = `imported-${c.cat_id}`
          service = await prisma.service.create({
            data: {
              categoryId: importCategory.id,
              name: String(c.cat_name).slice(0, 200),
              slug,
              tokenCost: 1,
              isActive: true,
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
        const found = await prisma.answerOption.findFirst({
          where: { questionId: question.id, value },
        })
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

  // pro_meta for known pros only
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
  }

  for (const opt of options) {
    await prisma.setting.upsert({
      where: { key: String(opt.option_key) },
      create: { key: String(opt.option_key), value: String(opt.option_value ?? '') },
      update: { value: String(opt.option_value ?? '') },
    })
  }

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

  const leadRows = [...readJsonl('leads.jsonl')]
  let leadOk = 0
  let leadOrphan = 0
  console.log('Importing leads…', leadRows.length)

  await chunked(leadRows, 80, async (batch) => {
    const ops = []
    for (const lead of batch) {
      const oldLeadId = Number(lead.lead_id)
      const serviceId = oldCatToService.get(Number(lead.cat_id))
      if (!serviceId) continue
      const oldUid = Number(lead.user_id) || 0
      const customerId = oldUid ? oldCustToProfile.get(oldUid) : null
      // Proper FK only — skip leads whose customer was not in users dump
      if (!customerId) {
        leadOrphan += 1
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
      const title = `[${TAG}] Lead #${oldLeadId}`
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

  // Messages only when BOTH sides exist in real users table
  let msgOk = 0
  let msgSkip = 0
  const msgRows = []
  for (const m of clientRequ) {
    const customerId = oldCustToProfile.get(Number(m.client_id))
    const professionalId = oldProToProfile.get(Number(m.pro_id))
    if (!customerId || !professionalId) {
      msgSkip += 1
      continue
    }
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
  await chunked(msgRows, 200, async (batch) => {
    await prisma.clientMessage.createMany({ data: batch })
    msgOk += batch.length
  })

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
          status: 'APPROVED',
          createdAt: r.created_at ? new Date(r.created_at) : new Date(),
        },
        update: {
          title: String(r.review_title || 'Review').slice(0, 250),
          body: String(r.review_text || ''),
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
    await prisma.payment.create({
      data: {
        userId,
        amountCents: Math.round(Number(o.amount || 0) * 100),
        currency: 'GBP',
        status:
          String(o.p_status).toLowerCase() === 'completed' ||
          String(o.status).toLowerCase() === 'completed'
            ? 'COMPLETED'
            : 'PENDING',
        provider: 'legacy-import',
        providerPaymentId: `legacy-order-${o.order_id}`,
        meta: { source: TAG, points: o.points },
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
    await prisma.tokenTransaction.create({
      data: {
        professionalId,
        type,
        amount: type === 'UNLOCK' ? -Math.abs(amount) : Math.abs(amount),
        balanceAfter: 0,
        reference: `legacy-points-${t.id}`,
        meta: { source: TAG },
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
    realUsersImported: users.length,
    prosMapped: oldProToProfile.size,
    customersMapped: oldCustToProfile.size,
    leads: leadOk,
    leadsSkippedNoUser: leadOrphan,
    messagesImported: msgOk,
    messagesSkippedMissingUser: msgSkip,
    reviews: revOk,
    payments: payOk,
    tokenTxns: txnOk,
    note: 'Dump users table only has 11 rows. user_name→email for those. No fake imported-customer-* emails.',
  }
  fs.writeFileSync(path.join(CACHE, 'reimport-summary.json'), JSON.stringify(summary, null, 2))
  console.log('\nDONE', summary)
  console.log(
    '\nIMPORTANT: checkare_123.sql users table contains ONLY 11 accounts.',
    'Export full users from live MySQL to restore all real emails.',
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
