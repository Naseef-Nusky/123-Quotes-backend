const prisma = require('../config/db')
const { asyncHandler, ok, fail } = require('../utils/helpers')
const bcrypt = require('bcryptjs')

const dashboard = asyncHandler(async (_req, res) => {
  const [
    customers,
    professionals,
    requests,
    leads,
    unlocks,
    payments,
    recentRequests,
    recentLeads,
  ] = await Promise.all([
    prisma.customerProfile.count(),
    prisma.professionalProfile.count(),
    prisma.customerRequest.count(),
    prisma.lead.count(),
    prisma.leadUnlock.count(),
    prisma.payment.aggregate({ _sum: { amountCents: true }, where: { status: 'COMPLETED' } }),
    prisma.customerRequest.findMany({
      take: 8,
      orderBy: { createdAt: 'desc' },
      include: { customer: true, service: true },
    }),
    prisma.lead.findMany({
      take: 8,
      orderBy: { createdAt: 'desc' },
      include: { service: true },
    }),
  ])

  return ok(res, {
    stats: {
      customers,
      professionals,
      requests,
      leads,
      unlocks,
      revenueCents: payments._sum.amountCents || 0,
    },
    recentRequests,
    recentLeads,
  })
})

const listUsers = asyncHandler(async (req, res) => {
  const where = {}
  if (req.query.role) where.role = req.query.role
  if (req.query.status) where.status = req.query.status

  const users = await prisma.user.findMany({
    where,
    include: { customer: true, professional: true },
    orderBy: { createdAt: 'desc' },
  })
  return ok(res, { users })
})

const updateUserStatus = asyncHandler(async (req, res) => {
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { status: req.body.status },
  })
  return ok(res, { user })
})

const listPackagesAdmin = asyncHandler(async (_req, res) => {
  const packages = await prisma.tokenPackage.findMany({ orderBy: { sortOrder: 'asc' } })
  return ok(res, { packages })
})

const upsertPackage = asyncHandler(async (req, res) => {
  const { id, name, description, tokens, priceCents, currency, isActive, sortOrder } = req.body
  if (!name || !tokens || priceCents == null) return fail(res, 'name, tokens, priceCents required')

  const pkg = id
    ? await prisma.tokenPackage.update({
        where: { id },
        data: { name, description, tokens, priceCents, currency, isActive, sortOrder },
      })
    : await prisma.tokenPackage.create({
        data: {
          name,
          description,
          tokens,
          priceCents,
          currency: currency || 'GBP',
          isActive: isActive !== false,
          sortOrder: sortOrder || 0,
        },
      })

  return ok(res, { package: pkg }, id ? 200 : 201)
})

const listPayments = asyncHandler(async (_req, res) => {
  const payments = await prisma.payment.findMany({
    include: { user: true, package: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return ok(res, { payments })
})

const listActivity = asyncHandler(async (_req, res) => {
  const logs = await prisma.activityLog.findMany({
    include: { user: { select: { email: true, role: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return ok(res, { logs })
})

const listTemplates = asyncHandler(async (_req, res) => {
  const templates = await prisma.emailTemplate.findMany({ orderBy: { key: 'asc' } })
  return ok(res, { templates })
})

const upsertTemplate = asyncHandler(async (req, res) => {
  const { id, key, subject, bodyHtml, bodyText, isActive } = req.body
  if (!key || !subject || !bodyHtml) return fail(res, 'key, subject, bodyHtml required')

  const template = id
    ? await prisma.emailTemplate.update({
        where: { id },
        data: { key, subject, bodyHtml, bodyText, isActive },
      })
    : await prisma.emailTemplate.upsert({
        where: { key },
        create: { key, subject, bodyHtml, bodyText, isActive: isActive !== false },
        update: { subject, bodyHtml, bodyText, isActive },
      })

  return ok(res, { template })
})

const getSettings = asyncHandler(async (_req, res) => {
  const settings = await prisma.setting.findMany()
  return ok(res, { settings })
})

const upsertSetting = asyncHandler(async (req, res) => {
  const { key, value } = req.body
  const setting = await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
  return ok(res, { setting })
})

const getPages = asyncHandler(async (_req, res) => {
  const pages = await prisma.pageContent.findMany({ orderBy: { slug: 'asc' } })
  return ok(res, { pages })
})

const upsertPage = asyncHandler(async (req, res) => {
  const { slug, title, body, isPublished } = req.body
  const page = await prisma.pageContent.upsert({
    where: { slug },
    create: { slug, title, body, isPublished: isPublished !== false },
    update: { title, body, isPublished },
  })
  return ok(res, { page })
})

const createAdmin = asyncHandler(async (req, res) => {
  const { email, password, name } = req.body
  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      passwordHash: await bcrypt.hash(password, 10),
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerified: true,
      customer: {
        create: {
          firstName: name || 'Admin',
          lastName: 'User',
        },
      },
    },
  })
  return ok(res, { user: { id: user.id, email: user.email, role: user.role } }, 201)
})

module.exports = {
  dashboard,
  listUsers,
  updateUserStatus,
  listPackagesAdmin,
  upsertPackage,
  listPayments,
  listActivity,
  listTemplates,
  upsertTemplate,
  getSettings,
  upsertSetting,
  getPages,
  upsertPage,
  createAdmin,
}
