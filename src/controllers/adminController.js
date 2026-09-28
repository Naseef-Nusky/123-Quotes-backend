const prisma = require('../config/db')
const { asyncHandler, ok, fail } = require('../utils/helpers')
const bcrypt = require('bcryptjs')
const {
  sendProfessionalApprovedEmail,
  sendProfessionalUnderReviewEmail,
  notifyAdminsOfNewBusiness,
} = require('../services/notificationService')
const { applyApplicationToProfile } = require('../services/businessApplicationService')

const dashboard = asyncHandler(async (_req, res) => {
  const [customers, professionals, requests, leads, unlocks, payments, lockSetting] =
    await Promise.all([
      prisma.customerProfile.count(),
      prisma.professionalProfile.count(),
      prisma.customerRequest.count(),
      prisma.lead.count(),
      prisma.leadUnlock.count(),
      prisma.payment.aggregate({ _sum: { amountCents: true }, where: { status: 'COMPLETED' } }),
      prisma.setting.findUnique({ where: { key: 'lead_view_locked' } }).catch(() => null),
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
    leadViewLocked: Boolean(lockSetting?.value),
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

  const lite = String(req.query.lite || '') === '1'

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
      professional: lite
        ? {
            select: {
              contactName: true,
              companyName: true,
              phone: true,
              postcode: true,
              website: true,
              bio: true,
              services: {
                select: { service: { select: { id: true, name: true, slug: true } } },
              },
              serviceAreas: {
                select: { postcode: true, radiusMiles: true, label: true },
              },
            },
          }
        : {
            include: {
              services: { include: { service: true } },
              serviceAreas: true,
            },
          },
    },
    orderBy: { createdAt: 'desc' },
  })
  return ok(res, { users })
})

const updateUserStatus = asyncHandler(async (req, res) => {
  const existing = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: { professional: true },
  })
  if (!existing) return fail(res, 'User not found', 404)
  if (existing.role === 'SUPER_ADMIN') {
    return fail(res, 'Super admin status cannot be changed', 403)
  }

  const nextStatus = req.body.status
  const wasPending = existing.status === 'PENDING'
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: req.params.id },
      data: {
        status: nextStatus,
        ...(nextStatus === 'ACTIVE' ? { emailVerified: true } : {}),
      },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        emailVerified: true,
        createdAt: true,
      },
    })

    if (existing.professional) {
      await tx.professionalProfile.update({
        where: { userId: existing.id },
        data: { isAvailable: nextStatus === 'ACTIVE' },
      })
    }

    return updated
  })

  if (
    existing.role === 'PROFESSIONAL' &&
    wasPending &&
    nextStatus === 'ACTIVE' &&
    existing.professional
  ) {
    await sendProfessionalApprovedEmail(
      user,
      existing.professional.contactName || existing.professional.companyName,
    )
    await prisma.businessApplication.updateMany({
      where: { userId: existing.id, status: 'PENDING', isAdditional: false },
      data: {
        status: 'APPROVED',
        reviewedAt: new Date(),
        reviewedById: req.user?.id || null,
      },
    })
  }

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

  const exists = await prisma.user.findUnique({
    where: { email_role: { email: email.toLowerCase().trim(), role: nextRole } },
  })
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
    const taken = await prisma.user.findUnique({
      where: {
        email_role: {
          email: email.toLowerCase().trim(),
          role: role || existing.role,
        },
      },
    })
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
  const where = { provider: 'square' }

  if (type === 'purchases' || type === 'purchase') {
    where.packageId = { not: null }
  }
  // type === 'square' / 'all' / 'recent' / 'online' → all Square payments

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
  return ok(res, { payments, type: type || 'square', provider: 'square' })
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

const updateProfessional = asyncHandler(async (req, res) => {
  const { id } = req.params
  const { email, password, status, contactName, companyName, phone, bio, type } = req.body

  const existing = await prisma.user.findUnique({
    where: { id },
    include: { professional: { include: { services: { include: { service: true } } } } },
  })
  if (!existing) return fail(res, 'User not found', 404)
  if (existing.role !== 'PROFESSIONAL' || !existing.professional) {
    return fail(res, 'Not a professional account', 400)
  }

  if (email && email.toLowerCase() !== existing.email) {
    const taken = await prisma.user.findUnique({
      where: { email_role: { email: email.toLowerCase().trim(), role: 'PROFESSIONAL' } },
    })
    if (taken) return fail(res, 'Email already in use', 409)
  }

  const userData = {}
  if (email) userData.email = email.toLowerCase().trim()
  if (status) userData.status = status
  if (password) {
    if (String(password).length < 6) return fail(res, 'password must be at least 6 characters')
    userData.passwordHash = await bcrypt.hash(password, 10)
  }

  const profileData = {}
  if (contactName != null) profileData.contactName = contactName
  if (companyName != null) profileData.companyName = companyName
  if (phone != null) profileData.phone = phone
  if (bio != null) profileData.bio = bio

  const user = await prisma.$transaction(async (tx) => {
    if (Object.keys(userData).length) {
      await tx.user.update({ where: { id }, data: userData })
    }
    if (Object.keys(profileData).length) {
      await tx.professionalProfile.update({
        where: { userId: id },
        data: profileData,
      })
    }

    if (type && String(type).trim()) {
      const service = await tx.service.findFirst({
        where: {
          OR: [
            { name: { equals: String(type).trim(), mode: 'insensitive' } },
            { slug: { equals: String(type).trim().toLowerCase().replace(/\s+/g, '-'), mode: 'insensitive' } },
          ],
        },
      })
      if (service) {
        await tx.professionalService.deleteMany({ where: { professionalId: existing.professional.id } })
        await tx.professionalService.create({
          data: { professionalId: existing.professional.id, serviceId: service.id },
        })
      }
    }

    return tx.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        professional: { include: { services: { include: { service: true } } } },
      },
    })
  })

  return ok(res, { user })
})

const deleteProfessional = asyncHandler(async (req, res) => {
  const existing = await prisma.user.findUnique({ where: { id: req.params.id } })
  if (!existing) return fail(res, 'User not found', 404)
  if (existing.role !== 'PROFESSIONAL') return fail(res, 'Not a professional account', 400)
  await prisma.user.delete({ where: { id: req.params.id } })
  return ok(res, { deleted: true, id: req.params.id })
})

const updateCustomer = asyncHandler(async (req, res) => {
  const { id } = req.params
  const { email, password, firstName, lastName, phone, postcode, address, city, status } = req.body

  const existing = await prisma.user.findUnique({
    where: { id },
    include: { customer: true },
  })
  if (!existing) return fail(res, 'User not found', 404)
  if (existing.role !== 'CUSTOMER') return fail(res, 'Not a customer account', 400)

  if (email && email.toLowerCase() !== existing.email) {
    const taken = await prisma.user.findUnique({
      where: { email_role: { email: email.toLowerCase().trim(), role: 'CUSTOMER' } },
    })
    if (taken) return fail(res, 'Email already in use', 409)
  }

  const data = {}
  if (email) data.email = email.toLowerCase().trim()
  if (status) data.status = status
  if (password) {
    if (String(password).length < 6) return fail(res, 'password must be at least 6 characters')
    data.passwordHash = await bcrypt.hash(password, 10)
  }

  const user = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data })
    if (existing.customer) {
      await tx.customerProfile.update({
        where: { userId: id },
        data: {
          ...(firstName != null ? { firstName } : {}),
          ...(lastName != null ? { lastName } : {}),
          ...(phone != null ? { phone } : {}),
          ...(postcode != null ? { postcode } : {}),
          ...(address != null ? { address } : {}),
          ...(city != null ? { city } : {}),
        },
      })
    }
    return tx.user.findUnique({
      where: { id },
      include: { customer: true },
    })
  })

  return ok(res, { user })
})

const createCustomer = asyncHandler(async (req, res) => {
  const { email, password, firstName, lastName, phone, postcode, address, city, status } = req.body
  if (!email || !password || !firstName) {
    return fail(res, 'email, password and firstName are required')
  }
  if (String(password).length < 6) return fail(res, 'password must be at least 6 characters')

  const emailNorm = String(email).toLowerCase().trim()
  const exists = await prisma.user.findUnique({
    where: { email_role: { email: emailNorm, role: 'CUSTOMER' } },
  })
  if (exists) return fail(res, 'Email already in use', 409)

  const user = await prisma.user.create({
    data: {
      email: emailNorm,
      passwordHash: await bcrypt.hash(password, 10),
      role: 'CUSTOMER',
      status: status || 'ACTIVE',
      emailVerified: true,
      customer: {
        create: {
          firstName: String(firstName).trim(),
          lastName: String(lastName || '').trim() || 'Customer',
          phone: phone || null,
          postcode: postcode || null,
          address: address || null,
          city: city || null,
        },
      },
    },
    include: { customer: true },
  })

  return ok(res, { user }, 201)
})

const createProfessional = asyncHandler(async (req, res) => {
  const {
    email,
    password,
    contactName,
    companyName,
    phone,
    postcode,
    bio,
    website,
    type,
    serviceName,
    serviceSlug,
    serviceIds = [],
    radiusMiles,
    nationwide,
    status,
  } = req.body

  if (!email || !password || !contactName) {
    return fail(res, 'email, password and contactName are required')
  }
  if (String(password).length < 6) return fail(res, 'password must be at least 6 characters')

  const emailNorm = String(email).toLowerCase().trim()
  const exists = await prisma.user.findUnique({
    where: { email_role: { email: emailNorm, role: 'PROFESSIONAL' } },
  })
  if (exists) return fail(res, 'Email already in use', 409)

  let resolvedServiceIds = Array.isArray(serviceIds) ? [...serviceIds] : []
  const typeOrName = serviceName || type
  if (!resolvedServiceIds.length && (serviceSlug || typeOrName)) {
    const service = await prisma.service.findFirst({
      where: {
        OR: [
          serviceSlug ? { slug: String(serviceSlug) } : undefined,
          typeOrName
            ? { name: { equals: String(typeOrName).trim(), mode: 'insensitive' } }
            : undefined,
          typeOrName
            ? {
                slug: {
                  equals: String(typeOrName).trim().toLowerCase().replace(/\s+/g, '-'),
                  mode: 'insensitive',
                },
              }
            : undefined,
        ].filter(Boolean),
        isActive: true,
      },
    })
    if (service) resolvedServiceIds = [service.id]
  }

  const nextStatus = status || 'ACTIVE'
  const isNationwide = Boolean(nationwide)
  const areaPostcode = isNationwide ? 'NATIONWIDE' : postcode || null

  const user = await prisma.user.create({
    data: {
      email: emailNorm,
      passwordHash: await bcrypt.hash(password, 10),
      role: 'PROFESSIONAL',
      status: nextStatus,
      emailVerified: true,
      professional: {
        create: {
          contactName: String(contactName).trim(),
          companyName: String(companyName || contactName).trim(),
          phone: phone || null,
          postcode: isNationwide ? 'UK' : postcode || null,
          website: website || null,
          bio: bio || null,
          isAvailable: nextStatus === 'ACTIVE',
          services: resolvedServiceIds.length
            ? { create: resolvedServiceIds.map((serviceId) => ({ serviceId })) }
            : undefined,
          serviceAreas: areaPostcode
            ? {
                create: [
                  {
                    postcode: areaPostcode,
                    radiusMiles: isNationwide ? null : Number(radiusMiles) || 50,
                    label: isNationwide ? 'Nationwide' : undefined,
                  },
                ],
              }
            : undefined,
        },
      },
    },
    include: {
      professional: {
        include: {
          services: { include: { service: true } },
          serviceAreas: true,
        },
      },
    },
  })

  if (nextStatus === 'PENDING') {
    await prisma.businessApplication.create({
      data: {
        userId: user.id,
        email: emailNorm,
        contactName: String(contactName).trim(),
        companyName: String(companyName || contactName).trim(),
        phone: phone || null,
        website: website || null,
        postcode: isNationwide ? 'UK' : postcode || null,
        radiusMiles: isNationwide ? null : Number(radiusMiles) || 50,
        nationwide: isNationwide,
        serviceName: typeOrName || null,
        serviceId: resolvedServiceIds[0] || null,
        isAdditional: false,
        status: 'PENDING',
      },
    })
    await sendProfessionalUnderReviewEmail(user, String(contactName).trim())
    await notifyAdminsOfNewBusiness({
      user,
      contactName: String(contactName).trim(),
      companyName: String(companyName || contactName).trim(),
      serviceName: typeOrName || null,
    })
  } else if (nextStatus === 'ACTIVE') {
    await sendProfessionalApprovedEmail(user, String(contactName).trim())
  }

  return ok(res, { user }, 201)
})

const deleteCustomer = asyncHandler(async (req, res) => {
  const existing = await prisma.user.findUnique({ where: { id: req.params.id } })
  if (!existing) return fail(res, 'User not found', 404)
  if (existing.role !== 'CUSTOMER') return fail(res, 'Not a customer account', 400)
  await prisma.user.delete({ where: { id: req.params.id } })
  return ok(res, { deleted: true, id: req.params.id })
})

const listNotifications = asyncHandler(async (req, res) => {
  const take = Math.min(Number(req.query.limit) || 30, 100)
  const unreadOnly = String(req.query.unread || '') === '1'

  const where = {
    userId: req.user.id,
    ...(unreadOnly ? { isRead: false } : {}),
  }

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
    }),
    prisma.notification.count({ where: { userId: req.user.id, isRead: false } }),
  ])

  return ok(res, { notifications, unreadCount })
})

const markNotificationRead = asyncHandler(async (req, res) => {
  const existing = await prisma.notification.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  })
  if (!existing) return fail(res, 'Notification not found', 404)

  const notification = await prisma.notification.update({
    where: { id: existing.id },
    data: { isRead: true },
  })
  return ok(res, { notification })
})

const markAllNotificationsRead = asyncHandler(async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { userId: req.user.id, isRead: false },
    data: { isRead: true },
  })
  return ok(res, { updated: result.count })
})

const listBusinessApplications = asyncHandler(async (req, res) => {
  const status = req.query.status || 'PENDING'
  const where = status === 'ALL' ? {} : { status }
  const applications = await prisma.businessApplication.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          status: true,
          role: true,
          professional: { select: { companyName: true, contactName: true } },
        },
      },
      service: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return ok(res, { applications })
})

const approveBusinessApplication = asyncHandler(async (req, res) => {
  const application = await prisma.businessApplication.findUnique({
    where: { id: req.params.id },
  })
  if (!application) return fail(res, 'Application not found', 404)
  if (application.status !== 'PENDING') {
    return fail(res, 'Application is not pending', 400)
  }

  await applyApplicationToProfile(application, { activateUser: true })

  const updated = await prisma.businessApplication.update({
    where: { id: application.id },
    data: {
      status: 'APPROVED',
      reviewedAt: new Date(),
      reviewedById: req.user.id,
    },
  })

  if (application.userId) {
    const user = await prisma.user.findUnique({
      where: { id: application.userId },
      include: { professional: true },
    })
    if (user) {
      await sendProfessionalApprovedEmail(
        user,
        application.contactName || user.professional?.contactName,
      )
    }
  }

  return ok(res, { application: updated })
})

const declineBusinessApplication = asyncHandler(async (req, res) => {
  const application = await prisma.businessApplication.findUnique({
    where: { id: req.params.id },
  })
  if (!application) return fail(res, 'Application not found', 404)
  if (application.status !== 'PENDING') {
    return fail(res, 'Application is not pending', 400)
  }

  const updated = await prisma.businessApplication.update({
    where: { id: application.id },
    data: {
      status: 'DECLINED',
      reviewedAt: new Date(),
      reviewedById: req.user.id,
      notes: req.body?.notes || null,
    },
  })

  // First-time applications: mark the user inactive if still pending and no other open apps
  if (!application.isAdditional && application.userId) {
    const otherPending = await prisma.businessApplication.count({
      where: {
        userId: application.userId,
        status: 'PENDING',
        id: { not: application.id },
      },
    })
    if (!otherPending) {
      const user = await prisma.user.findUnique({ where: { id: application.userId } })
      if (user?.status === 'PENDING' && user.role === 'PROFESSIONAL') {
        await prisma.user.update({
          where: { id: user.id },
          data: { status: 'INACTIVE' },
        })
      }
    }
  }

  return ok(res, { application: updated })
})

module.exports = {
  dashboard,
  listUsers,
  updateUserStatus,
  createAdmin,
  updateSystemUser,
  deleteSystemUser,
  updateProfessional,
  deleteProfessional,
  createProfessional,
  createCustomer,
  updateCustomer,
  deleteCustomer,
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
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  listBusinessApplications,
  approveBusinessApplication,
  declineBusinessApplication,
}
