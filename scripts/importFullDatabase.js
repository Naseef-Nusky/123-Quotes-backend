/**
 * Full import from extracted Checkare/Hunto dump (scripts/.import-cache).
 * Permanently wipes app data first, then imports.
 *
 * Mapping: users.user_name → User.email (real emails only).
 * No placeholder / @*.import accounts.
 * All leads/messages/reviews/orders import; FKs set when dump user exists.
 *
 *   node scripts/extractCheckareDump.js ~/Downloads/checkare_hunto.sql --with-postal
 *   node scripts/importFullDatabase.js
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')
const { randomUUID } = require('crypto')

const prisma = new PrismaClient()
const CACHE = path.join(__dirname, '.import-cache')
const TAG = 'hunto'
const DEFAULT_PASSWORD = 'ImportLegacy123!'

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

async function wipe() {
  console.log('1) Wiping database…')
  const steps = [
    () => prisma.clientMessage.deleteMany(),
    () => prisma.review.deleteMany(),
    () => prisma.requestAttachment.deleteMany(),
    () => prisma.requestAnswer.deleteMany(),
    () => prisma.leadUnlock.deleteMany(),
    () => prisma.leadMatch.deleteMany(),
    () => prisma.lead.deleteMany(),
    () => prisma.customerRequest.deleteMany(),
    () => prisma.tokenTransaction.deleteMany(),
    () => prisma.payment.deleteMany(),
    () => prisma.notification.deleteMany(),
    () => prisma.activityLog.deleteMany(),
    () => prisma.professionalService.deleteMany(),
    () => prisma.serviceArea.deleteMany(),
    () => prisma.questionBranch.deleteMany(),
    () => prisma.answerOption.deleteMany(),
    () => prisma.question.deleteMany(),
    () => prisma.businessApplication.deleteMany(),
    () => prisma.professionalProfile.deleteMany(),
    () => prisma.customerProfile.deleteMany(),
    () => prisma.subscription.deleteMany(),
    () => prisma.subscriptionPlan.deleteMany(),
    () => prisma.tokenPackage.deleteMany(),
    () => prisma.service.deleteMany(),
    () => prisma.category.deleteMany(),
    () => prisma.emailTemplate.deleteMany(),
    () => prisma.pageContent.deleteMany(),
    () => prisma.setting.deleteMany(),
    () => prisma.ukOutcode.deleteMany(),
    () => prisma.user.deleteMany(),
  ]
  for (const step of steps) await step()
  console.log('   wipe OK')
}

async function main() {
  if (!fs.existsSync(path.join(CACHE, 'users.json'))) {
    throw new Error('Missing import cache — extract SQL first')
  }

  await wipe()

  const users = loadJson('users.json')
  const categories = loadJson('category.json')
  const catAns = loadJson('cat_ans.json')
  const clientRequ = loadJson('client_requ.json')
  const leadsFiles = loadJson('leads_files.json')
  const options = loadJson('options.json')
  const orders = loadJson('orders.json')
  const proMeta = loadJson('pro_meta.json')
  const proPoints = loadJson('pro_points.json')
  const proFiles = fs.existsSync(path.join(CACHE, 'pro_files.json'))
    ? loadJson('pro_files.json')
    : []
  const reviews = loadJson('reviews.json')
  const declineLeads = fs.existsSync(path.join(CACHE, 'decline_leads.json'))
    ? loadJson('decline_leads.json')
    : []
  const postalMap = loadJson('postal_codes_subset.json')
  const outcodesFull = loadJson('uk_outcodes_full.json')

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 8)
  const hashCache = new Map([['', passwordHash]])
  async function hashPass(pw) {
    const key = String(pw || '')
    if (hashCache.has(key)) return hashCache.get(key)
    const h = await bcrypt.hash(key, 8)
    hashCache.set(key, h)
    return h
  }

  // Only users that exist in the dump with a real email (users.user_name).
  // Do NOT invent accounts for orphan lead/message IDs.
  const realUsers = users.filter((u) => String(u.user_name || '').includes('@'))
  const isPro = (u) => String(u.user_type).toLowerCase() === 'pro'
  const isCustomer = (u) => ['req', 'customer', 'client'].includes(String(u.user_type).toLowerCase())
  const proIds = new Set(realUsers.filter(isPro).map((u) => Number(u.user_id)))
  const custIds = new Set(realUsers.filter(isCustomer).map((u) => Number(u.user_id)))

  const oldProToProfile = new Map()
  const oldProToUser = new Map()
  const oldCustToProfile = new Map()
  /** Contact from ANY dump user (req or pro) — leads.user_id may point to either. */
  /** @type {Map<number, { name: string, email: string, phone: string|null }>} */
  const oldUserContact = new Map()
  const oldLeadToNew = new Map()

  for (const u of realUsers) {
    const oldId = Number(u.user_id)
    const email = String(u.user_name).trim().toLowerCase()
    const { firstName, lastName } = splitName(u.name)
    const phone = u.contact ? String(u.contact).trim() || null : null
    const display = `${firstName} ${lastName}`.trim() || email.split('@')[0]
    oldUserContact.set(oldId, { name: display, email, phone })
  }

  console.log('2) Users (real emails only)…', {
    dumpUsers: users.length,
    withEmail: realUsers.length,
    pros: proIds.size,
    customers: custIds.size,
  })

  // Professionals — users.user_name → email, users.status, users.alogin
  const legacyStatus = (u) =>
    String(u.status || '').toLowerCase() === 'pending' ? 'PENDING' : 'ACTIVE'
  const lastLogin = (u) => (u.alogin ? new Date(u.alogin) : null)
  // users.alogin is stamped when the old row was created → original Joined date
  const joinedAt = (u) => (u.alogin ? new Date(String(u.alogin).replace(' ', 'T')) : undefined)
  const proRows = []
  for (const u of realUsers.filter(isPro)) {
    const oldId = Number(u.user_id)
    const email = String(u.user_name).trim().toLowerCase()
    const { firstName, lastName } = splitName(u.name)
    proRows.push({
      oldId,
      email,
      hash: await hashPass(u.password),
      firstName,
      lastName,
      phone: u.contact ? String(u.contact) : null,
      companyName: String(u.name || email).trim(),
      status: legacyStatus(u),
      lastLoginAt: lastLogin(u),
      createdAt: joinedAt(u),
    })
  }
  await prisma.user.createMany({
    data: proRows.map((r) => ({
      email: r.email,
      passwordHash: r.hash,
      role: 'PROFESSIONAL',
      status: r.status,
      emailVerified: true,
      lastLoginAt: r.lastLoginAt,
      ...(r.createdAt ? { createdAt: r.createdAt } : {}),
    })),
    skipDuplicates: true,
  })
  const proUsers = await prisma.user.findMany({
    where: { role: 'PROFESSIONAL' },
    include: { professional: true },
  })
  const proByEmail = new Map(proUsers.map((u) => [u.email.toLowerCase(), u]))
  const proProfiles = []
  for (const r of proRows) {
    const user = proByEmail.get(r.email)
    if (!user) continue
    if (!user.professional) {
      const id = randomUUID()
      proProfiles.push({
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
  if (proProfiles.length) await prisma.professionalProfile.createMany({ data: proProfiles })
  console.log('   pros', oldProToProfile.size)

  // Customers — users.user_name → email (req only; skip admin/other)
  const custRows = []
  for (const u of realUsers.filter(isCustomer)) {
    const oldId = Number(u.user_id)
    const email = String(u.user_name).trim().toLowerCase()
    const { firstName, lastName } = splitName(u.name)
    const phone = u.contact ? String(u.contact).trim() || null : null
    custRows.push({
      oldId,
      email,
      hash: await hashPass(u.password),
      firstName,
      lastName,
      phone,
      status: legacyStatus(u),
      lastLoginAt: lastLogin(u),
      createdAt: joinedAt(u),
    })
  }
  await prisma.user.createMany({
    data: custRows.map((r) => ({
      email: r.email,
      passwordHash: r.hash,
      role: 'CUSTOMER',
      status: r.status,
      emailVerified: true,
      lastLoginAt: r.lastLoginAt,
      ...(r.createdAt ? { createdAt: r.createdAt } : {}),
    })),
    skipDuplicates: true,
  })
  const custUsers = await prisma.user.findMany({
    where: { role: 'CUSTOMER' },
    include: { customer: true },
  })
  const custByEmail = new Map(custUsers.map((u) => [u.email.toLowerCase(), u]))
  const custProfiles = []
  for (const r of custRows) {
    const user = custByEmail.get(r.email)
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
  if (custProfiles.length) await prisma.customerProfile.createMany({ data: custProfiles })
  console.log('   customers', oldCustToProfile.size)

  console.log('3) Categories / services / questions…')
  // Dump `category` rows with parent=0 are the site categories.
  // Each becomes a Category + one Service of the same name (site structure).
  async function createImportCategory(c, slug) {
    const name = String(c.cat_name).slice(0, 200)
    // Duplicate dump names share one category (name/slug are unique)
    const existing =
      (await prisma.category.findUnique({ where: { name } })) ||
      (await prisma.category.findUnique({ where: { slug } }))
    if (existing) return existing
    return prisma.category.create({
      data: {
        name,
        slug,
        description: String(c.cat_name).slice(0, 200),
        isActive: String(c.status) === 'Active',
        sortOrder: Number(c.cat_id) || 0,
      },
    })
  }
  const oldCatToService = new Map()
  /** old question cat_id -> { questionId, serviceId } */
  const oldQuestionMap = new Map()
  /** old cat_ans.id -> { label, oldQuestionCatId, optionId } */
  const oldAnsMap = new Map()
  /** Per service: map old question cat_id -> new Question.id (incl. global Q1) */
  const serviceQuestionMap = new Map()
  const usedSlugs = new Set()

  const globalQ = categories.find((x) => Number(x.cat_id) === 1)
  const globalAns = globalQ ? catAns.filter((x) => Number(x.cat_id) === 1) : []

  for (const c of categories.filter((x) => String(x.parent) === '0')) {
    let slug = slugify(c.cat_name, `service-${c.cat_id}`)
    if (usedSlugs.has(slug)) slug = `${slug}-${c.cat_id}`
    usedSlugs.add(slug)
    const oldCatId = Number(c.cat_id)
    const category = await createImportCategory(c, slug)
    let service
    try {
      service = await prisma.service.create({
        data: {
          categoryId: category.id,
          name: String(c.cat_name).slice(0, 200),
          slug,
          shortDesc: String(c.cat_name).slice(0, 160),
          tokenCost: 1,
          isActive: String(c.status) === 'Active',
          sortOrder: oldCatId || 0,
        },
      })
    } catch {
      slug = `imported-${c.cat_id}`
      service = await prisma.service.create({
        data: {
          categoryId: category.id,
          name: String(c.cat_name).slice(0, 200),
          slug,
          tokenCost: 1,
          isActive: String(c.status) === 'Active',
        },
      })
    }
    oldCatToService.set(oldCatId, service.id)
    const perServiceQ = new Map()
    serviceQuestionMap.set(service.id, perServiceQ)

    // Questions for this service: old rows whose parent is the service,
    // plus a final global question (old cat_id=1, e.g. "how likely...")
    const serviceQuestions = categories.filter(
      (x) =>
        String(x.parent) === String(c.cat_id) &&
        ['rb', 'cb'].includes(String(x.child_type).toLowerCase()),
    )
    if (globalQ) {
      serviceQuestions.push({ ...globalQ, __global: true })
    }

    let sort = 0
    const createdQuestions = []
    for (const q of serviceQuestions) {
      sort += 1
      const oldQId = Number(q.cat_id)
      const question = await prisma.question.create({
        data: {
          serviceId: service.id,
          label: String(q.cat_name).slice(0, 250),
          type: String(q.child_type).toLowerCase() === 'cb' ? 'MULTIPLE_CHOICE' : 'SINGLE_CHOICE',
          isRequired: false,
          sortOrder: sort,
          isActive: String(q.status) === 'Active',
        },
      })
      perServiceQ.set(oldQId, question.id)
      if (!q.__global) {
        oldQuestionMap.set(oldQId, { questionId: question.id, serviceId: service.id })
      }
      createdQuestions.push({ q, question })

      const ansRows = q.__global
        ? globalAns
        : catAns.filter((x) => Number(x.cat_id) === oldQId)
      let oi = 0
      for (const a of ansRows) {
        oi += 1
        const option = await prisma.answerOption.create({
          data: {
            questionId: question.id,
            label: String(a.name).slice(0, 200),
            value: slugify(a.name, `opt-${a.id}`),
            sortOrder: oi,
          },
        })
        // Keep the first mapping per ans (global answers shared per service copy)
        if (!oldAnsMap.has(Number(a.id))) {
          oldAnsMap.set(Number(a.id), {
            label: String(a.name),
            oldQuestionCatId: Number(a.cat_id),
            next: a.next,
          })
        }
        // Branch from cat_ans.next -> target question (when both known here)
        const nextOld = Number(a.next)
        if (nextOld && perServiceQ.has(nextOld)) {
          // target already created later in order; defer — handled below
        }
        createdQuestions[createdQuestions.length - 1].options =
          createdQuestions[createdQuestions.length - 1].options || []
        createdQuestions[createdQuestions.length - 1].options.push({ a, option })
      }
    }
    // Branches (cat_ans.next) now that per-service questions exist
    for (const { q, question, options } of createdQuestions) {
      for (const { a, option } of options || []) {
        const targetId = perServiceQ.get(Number(a.next))
        if (!targetId || targetId === question.id) continue
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
  }
  for (const missingId of [155, 156, 158]) {
    if (oldCatToService.has(missingId)) continue
    const category = await prisma.category.create({
      data: {
        name: `Imported Service ${missingId}`,
        slug: `imported-missing-${missingId}`,
        isActive: true,
      },
    })
    const service = await prisma.service.create({
      data: {
        categoryId: category.id,
        name: `Imported Service ${missingId}`,
        slug: `imported-missing-${missingId}`,
        tokenCost: 1,
        isActive: true,
      },
    })
    oldCatToService.set(missingId, service.id)
  }
  console.log('   services', oldCatToService.size)

  // pro_meta — apply to known pros; keep full dump in settings (no stub users)
  const metaByUser = new Map()
  for (const m of proMeta) {
    const uid = Number(m.user_id)
    if (!metaByUser.has(uid)) metaByUser.set(uid, {})
    metaByUser.get(uid)[m.meta_key] = m.meta_value
  }
  let proMetaApplied = 0
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
      await prisma.professionalService
        .create({ data: { professionalId: profileId, serviceId } })
        .catch(() => {})
    }
    if (postal || meta.area || meta.dis_to_loc) {
      await prisma.serviceArea
        .create({
          data: {
            professionalId: profileId,
            postcode: postal ? postcodeFromPostal(postal) : null,
            city: postal?.district || null,
            radiusMiles:
              meta.dis_to_loc != null && Number.isFinite(Number(meta.dis_to_loc))
                ? Math.trunc(Number(meta.dis_to_loc))
                : null,
            label: meta.area ? String(meta.area) : null,
          },
        })
        .catch(() => {})
    }
    proMetaApplied += 1
  }
  await prisma.setting.upsert({
    where: { key: 'legacy_pro_meta' },
    create: { key: 'legacy_pro_meta', value: proMeta },
    update: { value: proMeta },
  })
  await prisma.setting.upsert({
    where: { key: 'legacy_pro_files' },
    create: { key: 'legacy_pro_files', value: proFiles },
    update: { value: proFiles },
  })
  for (const f of proFiles) {
    const profileId = oldProToProfile.get(Number(f.user_id))
    if (!profileId) continue
    const ext = String(f.ext || 'jpg').replace(/^\./, '')
    await prisma.professionalProfile.update({
      where: { id: profileId },
      data: { logoUrl: `legacy-pro-file-${f.file_id}.${ext}` },
    })
  }
  console.log('   pro_meta rows', proMeta.length, '| applied to profiles', proMetaApplied)

  for (const opt of options) {
    await prisma.setting.create({
      data: { key: String(opt.option_key), value: String(opt.option_value ?? '') },
    }).catch(async () => {
      await prisma.setting.update({
        where: { key: String(opt.option_key) },
        data: { value: String(opt.option_value ?? '') },
      })
    })
  }

  console.log('4) Postcodes (unique outcodes)…', outcodesFull.length)
  await chunked(outcodesFull, 500, async (batch) => {
    await prisma.ukOutcode.createMany({
      data: batch.map((o) => ({
        outcode: o.outcode,
        town: o.town || null,
        region: o.region || null,
        country: o.country || 'UK',
        latitude: o.latitude ?? null,
        longitude: o.longitude ?? null,
      })),
      skipDuplicates: true,
    })
  })

  console.log('5) Leads (all rows; customer FK only when users.user_name exists)…')
  const metaByLead = new Map()
  for (const m of readJsonl('leads_meta.jsonl')) {
    const lid = Number(m.lead_id)
    if (!metaByLead.has(lid)) metaByLead.set(lid, [])
    metaByLead.get(lid).push(m)
  }
  const filesByLead = new Map()
  for (const f of leadsFiles) {
    const lid = Number(f.lead_id)
    if (!filesByLead.has(lid)) filesByLead.set(lid, [])
    filesByLead.get(lid).push(f)
  }

  const leadStatusMap = (raw) => {
    switch (String(raw || '').toLowerCase()) {
      case 'completed':
        return 'CLOSED'
      case 'locked':
        return 'CLOSED'
      case 'cancelled':
      case 'canceled':
        return 'CANCELLED'
      default:
        return 'OPEN' // Active / Pending
    }
  }

  const leadRows = [...readJsonl('leads.jsonl')]
  let leadOk = 0
  let leadWithCustomer = 0
  let leadSkipped = 0
  let answerOk = 0
  await chunked(leadRows, 80, async (batch) => {
    const ops = []
    for (const lead of batch) {
      const oldLeadId = Number(lead.lead_id)
      const serviceId = oldCatToService.get(Number(lead.cat_id))
      if (!serviceId) {
        leadSkipped += 1
        continue
      }
      const oldUid = Number(lead.user_id) || 0
      const customerId = oldUid ? oldCustToProfile.get(oldUid) || null : null
      const contact = oldUid ? oldUserContact.get(oldUid) || null : null
      if (customerId || contact?.email) leadWithCustomer += 1
      const postal = postalMap[String(lead.postalcode_id)]
      const postcode = postcodeFromPostal(postal)

      // leads_meta -> RequestAnswer (question = meta_key, values = cat_ans ids)
      const perServiceQ = serviceQuestionMap.get(serviceId)
      const answers = []
      const unresolved = []
      for (const m of metaByLead.get(oldLeadId) || []) {
        const oldQId = Number(m.meta_key)
        const questionId = perServiceQ?.get(oldQId)
        if (!questionId) {
          unresolved.push(`${m.meta_key}: ${m.meta_value}`)
          continue
        }
        const ids = String(m.meta_value || '')
          .split(',')
          .map((part) => Number(String(part).trim()))
          .filter((n) => Number.isFinite(n) && n > 0)
        const labels = ids
          .map((id) => oldAnsMap.get(id)?.label)
          .filter(Boolean)
        answers.push({
          id: randomUUID(),
          questionId,
          value: labels.length ? labels.join(', ') : String(m.meta_value || ''),
          __requestId: null, // filled below
        })
      }
      const description = [
        lead.description,
        unresolved.length ? unresolved.join('\n') : null,
      ]
        .filter(Boolean)
        .join('\n\n')
      const createdAt = lead.rec_date ? new Date(lead.rec_date) : new Date()
      const requestId = randomUUID()
      const leadId = randomUUID()
      for (const a of answers) a.__requestId = requestId
      oldLeadToNew.set(oldLeadId, leadId)
      ops.push({
        request: {
          id: requestId,
          customerId,
          legacyUserId: oldUid || null,
          contactName: contact?.name || null,
          contactEmail: contact?.email || null,
          contactPhone: contact?.phone || null,
          legacyLeadStatus: lead.status ? String(lead.status) : null,
          exactSearch: String(lead.exact_search || '').toLowerCase() === 'yes',
          newsletter: String(lead.newsletter || '').toLowerCase() === 'yes',
          serviceId,
          status: 'SUBMITTED',
          title: `[${TAG}] Lead #${oldLeadId}`,
          description: description || null,
          postcode,
          city: postal?.district || null,
          submittedAt: createdAt,
          createdAt,
          updatedAt: createdAt,
        },
        answers,
        lead: {
          id: leadId,
          requestId,
          serviceId,
          status: leadStatusMap(lead.status),
          summary: String(lead.description || '').slice(0, 300) || null,
          postcode,
          city: postal?.district || null,
          tokenCost: 1,
          createdAt,
          updatedAt: createdAt,
        },
        attachments: (filesByLead.get(oldLeadId) || []).map((file) => {
          const ext = String(file.ext || 'bin').replace(/^\./, '').toLowerCase()
          return {
            id: randomUUID(),
            requestId,
            originalName: `legacy-file-${file.file_id}.${ext}`,
            storedName: `legacy-missing-${file.file_id}.${ext}`,
            mimeType: ext === 'pdf' ? 'application/pdf' : 'application/octet-stream',
            sizeBytes: 0,
            ext,
          }
        }),
      })
    }
    if (!ops.length) return
    await prisma.customerRequest.createMany({ data: ops.map((o) => o.request) })
    await prisma.lead.createMany({ data: ops.map((o) => o.lead) })
    const ansRows = ops.flatMap((o) =>
      (o.answers || []).map((a) => ({
        id: a.id,
        requestId: a.__requestId,
        questionId: a.questionId,
        value: a.value,
      })),
    )
    if (ansRows.length) {
      await prisma.requestAnswer.createMany({ data: ansRows, skipDuplicates: true })
      answerOk += ansRows.length
    }
    const atts = ops.flatMap((o) => o.attachments)
    if (atts.length) await prisma.requestAttachment.createMany({ data: atts })
    leadOk += ops.length
    if (leadOk % 800 === 0) console.log('   leads', leadOk)
  })
  console.log(
    '   leads done',
    leadOk,
    '| with real customer email',
    leadWithCustomer,
    '| skipped (no service)',
    leadSkipped,
    '| questionnaire answers',
    answerOk,
  )

  console.log('6) Messages / reviews / orders / points…')
  const msgRows = []
  for (const m of clientRequ) {
    const legacyClientId = Number(m.client_id) || null
    const legacyProId = Number(m.pro_id) || null
    const customerId = legacyClientId ? oldCustToProfile.get(legacyClientId) || null : null
    const professionalId = legacyProId ? oldProToProfile.get(legacyProId) || null : null
    msgRows.push({
      id: randomUUID(),
      customerId,
      professionalId,
      legacyClientId,
      legacyProId,
      senderRole: 'CUSTOMER',
      message: String(m.message || ''),
      status: String(m.status).toLowerCase() === 'active' ? 'ACTIVE' : 'ARCHIVED',
      updatedAt: new Date(),
    })
  }
  await chunked(msgRows, 250, async (batch) => {
    await prisma.clientMessage.createMany({ data: batch })
  })
  console.log(
    '   messages',
    msgRows.length,
    '| both sides linked',
    msgRows.filter((m) => m.customerId && m.professionalId).length,
  )

  let revOk = 0
  for (const r of reviews) {
    const legacyProId = Number(r.company_id) || null
    const legacyCustomerId = Number(r.review_user_id) || null
    const professionalId = legacyProId ? oldProToProfile.get(legacyProId) || null : null
    const customerId = legacyCustomerId ? oldCustToProfile.get(legacyCustomerId) || null : null
    try {
      await prisma.review.create({
        data: {
          professionalId,
          customerId,
          legacyProId,
          legacyCustomerId,
          title: String(r.review_title || 'Review').slice(0, 250),
          body: String(r.review_text || ''),
          rating: Math.min(5, Math.max(1, Number(r.review_star_value) || 1)),
          status: 'APPROVED',
          createdAt: r.created_at ? new Date(r.created_at) : new Date(),
        },
      })
      revOk += 1
    } catch {
      /* skip dup */
    }
  }
  console.log('   reviews', revOk)

  let payOk = 0
  for (const o of orders) {
    const legacyUserId = Number(o.user_id) || null
    const userId = legacyUserId ? oldProToUser.get(legacyUserId) || null : null
    await prisma.payment.create({
      data: {
        userId,
        legacyUserId,
        amountCents: Math.round(Number(o.amount || 0) * 100),
        currency: 'GBP',
        status:
          String(o.p_status).toLowerCase() === 'completed' ||
          String(o.status).toLowerCase() === 'completed'
            ? 'COMPLETED'
            : 'PENDING',
        provider: 'legacy-import',
        providerPaymentId: `legacy-order-${o.order_id}`,
        meta: { source: TAG, points: o.points, remark: o.p_remark || null },
      },
    })
    payOk += 1
  }
  console.log('   orders', payOk)

  let txnOk = 0
  for (const t of proPoints) {
    const legacyUserId = Number(t.user_id) || null
    const professionalId = legacyUserId ? oldProToProfile.get(legacyUserId) || null : null
    const type = String(t.trans_type).toLowerCase() === 'lead' ? 'UNLOCK' : 'PURCHASE'
    const amount = Number(t.amount) || 0
    await prisma.tokenTransaction.create({
      data: {
        professionalId,
        legacyUserId,
        type,
        amount: type === 'UNLOCK' ? -Math.abs(amount) : Math.abs(amount),
        balanceAfter: 0,
        reference: `legacy-points-${t.id}`,
        meta: { source: TAG },
        createdAt: t.rec_date ? new Date(t.rec_date) : new Date(),
      },
    })
    if (professionalId && type === 'PURCHASE' && amount > 0) {
      await prisma.professionalProfile.update({
        where: { id: professionalId },
        data: { tokenBalance: { increment: amount } },
      })
    }
    txnOk += 1
  }
  console.log('   points', txnOk)

  let declineOk = 0
  for (const d of declineLeads) {
    const leadId = oldLeadToNew.get(Number(d.lead_id))
    const professionalId = oldProToProfile.get(Number(d.user_id))
    if (!leadId || !professionalId) continue
    try {
      await prisma.leadMatch.create({
        data: {
          leadId,
          professionalId,
          status: 'DECLINED',
          matchedAt: d.date_log ? new Date(d.date_log) : new Date(),
        },
      })
      declineOk += 1
    } catch {
      /* skip dup */
    }
  }
  console.log('   decline_leads', declineOk, '/', declineLeads.length)

  // Admin + packages
  console.log('7) Admin + token packages…')
  const superEmail = process.env.SUPER_ADMIN_EMAIL || 'superadmin@123quotes.com'
  const superPass = process.env.SUPER_ADMIN_PASSWORD || 'superadmin123'
  await prisma.user.create({
    data: {
      email: superEmail,
      passwordHash: await bcrypt.hash(superPass, 10),
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      emailVerified: true,
      customer: { create: { firstName: 'Super', lastName: 'Admin' } },
    },
  }).catch(() => {})

  for (const p of [
    { name: 'Starter', tokens: 70, priceCents: 6800, sortOrder: 1 },
    { name: 'Growth', tokens: 100, priceCents: 7600, sortOrder: 2 },
    { name: 'Pro', tokens: 200, priceCents: 14000, sortOrder: 3 },
    { name: 'Business', tokens: 500, priceCents: 32000, sortOrder: 4 },
  ]) {
    await prisma.tokenPackage.create({
      data: { ...p, currency: 'GBP', isActive: true, description: `${p.tokens} tokens` },
    }).catch(() => {})
  }

  const summary = {
    dumpUsersWithEmail: realUsers.length,
    professionals: oldProToProfile.size,
    customers: oldCustToProfile.size,
    services: oldCatToService.size,
    outcodes: outcodesFull.length,
    leads: leadOk,
    leadsWithRealCustomer: leadWithCustomer,
    leadAnswers: answerOk,
    leadsSkippedNoService: leadSkipped,
    messages: msgRows.length,
    reviews: revOk,
    orders: payOk,
    points: txnOk,
    declineLeads: declineOk,
    leadsFilesInDump: leadsFiles.length,
    attachmentsLinked: await prisma.requestAttachment.count(),
    sourceDump: 'checkare_hunto.sql',
    mapping:
      'users.user_name → User.email only; no stub emails; orphan rows keep legacy ids with null FK',
  }
  fs.writeFileSync(path.join(CACHE, 'full-import-summary.json'), JSON.stringify(summary, null, 2))
  console.log('\nFULL IMPORT DONE', summary)
  console.log('Admin:', superEmail)
  console.log('Imported user password (from dump hash or default):', DEFAULT_PASSWORD)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
