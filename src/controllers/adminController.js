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
  if (req.query.roles) {
    where.role = { in: String(req.query.roles).split(',').map((r) => r.trim()).filter(Boolean) }
  } else if (req.query.role) {
    where.role = req.query.role
  }
  if (req.query.status) where.status = req.query.status

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      emailVerified: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
      customer: true,
      professional: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  return ok(res, { users })
})

const updateUserStatus = asyncHandler(async (req, res) => {
  const existing = await prisma.user.findUnique({ where: { id: req.params.id } })
  if (!existing) return fail(res, 'User not found', 404)
  if (existing.role === 'SUPER_ADMIN') {
    return fail(res, 'Super admin status cannot be changed', 403)
  }

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { status: req.body.status },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      emailVerified: true,
      createdAt: true,
    },
  })
  return ok(res, { user })
})

const STAFF_ROLES = ['ADMIN', 'SUPER_ADMIN']

const createAdmin = asyncHandler(async (req, res) => {
  if (req.user?.role !== 'SUPER_ADMIN') {
    return fail(res, 'Only a super admin can add system users', 403)
  }

  const { email, password, name, firstName, lastName, status, role } = req.body
  if (!email || !password) return fail(res, 'email and password are required')
  if (String(password).length < 6) return fail(res, 'password must be at least 6 characters')

  const nextRole = role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN'

  const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  if (exists) return fail(res, 'Email already in use', 409)

  const given = firstName || name || (nextRole === 'SUPER_ADMIN' ? 'Super' : 'Admin')
  const family = lastName || 'Admin'

  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase().trim(),
      passwordHash: await bcrypt.hash(password, 10),
      role: nextRole,
      status: status || 'ACTIVE',
      emailVerified: true,
      customer: {
        create: {
          firstName: given,
          lastName: family,
        },
      },
    },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      emailVerified: true,
      createdAt: true,
      customer: true,
    },
  })
  return ok(res, { user }, 201)
})

const updateSystemUser = asyncHandler(async (req, res) => {
  const { id } = req.params
  const { email, password, firstName, lastName, name, status, emailVerified, role } = req.body

  const existing = await prisma.user.findUnique({
    where: { id },
    include: { customer: true },
  })
  if (!existing) return fail(res, 'User not found', 404)
  if (!STAFF_ROLES.includes(existing.role)) {
    return fail(res, 'Only system admin users can be edited here', 400)
  }

  if (existing.role === 'SUPER_ADMIN') {
    return fail(res, 'Super admin details cannot be edited', 403)
  }

  if (role && !STAFF_ROLES.includes(role)) {
    return fail(res, 'Invalid role', 400)
  }
  if (role === 'SUPER_ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
    return fail(res, 'Only a super admin can assign super admin role', 403)
  }

  if (email && email.toLowerCase() !== existing.email) {
    const taken = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
    if (taken) return fail(res, 'Email already in use', 409)
  }

  const data = {}
  if (email) data.email = email.toLowerCase().trim()
  if (status) data.status = status
  if (role) data.role = role
  if (typeof emailVerified === 'boolean') data.emailVerified = emailVerified
  if (password) {
    if (String(password).length < 6) return fail(res, 'password must be at least 6 characters')
    data.passwordHash = await bcrypt.hash(password, 10)
  }

  const given = firstName || name
  const family = lastName

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
        customer: true,
      },
    })

    if (given || family) {
      if (existing.customer) {
        await tx.customerProfile.update({
          where: { userId: id },
          data: {
            ...(given ? { firstName: given } : {}),
            ...(family ? { lastName: family } : {}),
          },
        })
      } else {
        await tx.customerProfile.create({
          data: {
            userId: id,
            firstName: given || 'Admin',
            lastName: family || 'User',
          },
        })
      }
      return tx.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
          customer: true,
        },
      })
    }

    return updated
  })

  return ok(res, { user })
})

const deleteSystemUser = asyncHandler(async (req, res) => {
  const { id } = req.params

  const existing = await prisma.user.findUnique({ where: { id } })
  if (!existing) return fail(res, 'User not found', 404)
  if (!STAFF_ROLES.includes(existing.role)) {
    return fail(res, 'Only system admin users can be deleted here', 400)
  }

  if (existing.role === 'SUPER_ADMIN') {
    return fail(res, 'Super admin accounts cannot be removed', 403)
  }

  if (req.user?.id === id) return fail(res, 'You cannot delete your own account', 400)

  const staffCount = await prisma.user.count({ where: { role: { in: STAFF_ROLES } } })
  if (staffCount <= 1) return fail(res, 'Cannot delete the last system user', 400)

  await prisma.user.delete({ where: { id } })
  return ok(res, { deleted: true, id })
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

const listPayments = asyncHandler(async (req, res) => {
  const type = String(req.query.type || '').toLowerCase()
  const where = {}

  if (type === 'online') {
    where.provider = { in: ['square', 'paypal', 'stripe', 'online'] }
  } else if (type === 'manual') {
    where.provider = { in: ['manual', 'offline', 'bank', 'cash', 'invoice'] }
  } else if (type === 'purchases' || type === 'purchase') {
    where.packageId = { not: null }
  }
  // type === 'all' / 'recent' / empty → no filter (full ledger)

  const payments = await prisma.payment.findMany({
    where,
    include: {
      user: {
        include: {
          professional: { select: { contactName: true, companyName: true, phone: true } },
          customer: { select: { firstName: true, lastName: true, phone: true } },
        },
      },
      package: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return ok(res, { payments, type: type || 'all' })
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

module.exports = {
  dashboard,
  listUsers,
  updateUserStatus,
  createAdmin,
  updateSystemUser,
  deleteSystemUser,
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
}
