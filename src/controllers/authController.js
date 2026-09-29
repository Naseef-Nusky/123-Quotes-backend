const bcrypt = require('bcryptjs')
const prisma = require('../config/db')
const { signToken } = require('../middleware/auth')
const { randomToken } = require('../utils/crypto')
const { asyncHandler, ok, fail } = require('../utils/helpers')
const { sendEmail } = require('../services/emailService')
const { logActivity } = require('../services/activityService')
const {
  notifyAdminsOfNewBusiness,
  sendProfessionalUnderReviewEmail,
} = require('../services/notificationService')
const { resolveServiceId } = require('../services/businessApplicationService')

const STAFF_ROLES = ['ADMIN', 'SUPER_ADMIN']
const AUTH_ROLES = ['CUSTOMER', 'PROFESSIONAL']

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerified,
    customer: user.customer || null,
    professional: user.professional
      ? {
          id: user.professional.id,
          companyName: user.professional.companyName,
          contactName: user.professional.contactName,
          tokenBalance: user.professional.tokenBalance,
          isAvailable: user.professional.isAvailable,
        }
      : null,
  }
}

function resolveAuthRole(value, fallback = 'CUSTOMER') {
  const role = String(value || fallback).toUpperCase()
  if (AUTH_ROLES.includes(role)) return role
  return fallback
}

async function findUserByEmailRole(email, role, include = { customer: true, professional: true }) {
  const args = {
    where: { email_role: { email: String(email || '').toLowerCase().trim(), role } },
  }
  if (include) args.include = include
  return prisma.user.findUnique(args)
}

async function findUserForLogin(email, roleRaw) {
  const emailNorm = String(email || '').toLowerCase().trim()
  const roleHint = String(roleRaw || '').toUpperCase()
  const include = { customer: true, professional: true }

  if (roleHint === 'CUSTOMER' || roleHint === 'PROFESSIONAL') {
    return findUserByEmailRole(emailNorm, roleHint, include)
  }

  if (roleHint === 'ADMIN' || roleHint === 'SUPER_ADMIN') {
    return findUserByEmailRole(emailNorm, roleHint, include)
  }

  // Admin CRM / staff portal: no portal role — match any staff account by email
  if (!roleRaw || roleHint === 'STAFF') {
    return prisma.user.findFirst({
      where: { email: emailNorm, role: { in: STAFF_ROLES } },
      include,
    })
  }

  return findUserByEmailRole(emailNorm, 'CUSTOMER', include)
}

const registerProfessional = asyncHandler(async (req, res) => {
  const {
    email,
    password,
    companyName,
    contactName,
    phone,
    postcode,
    website,
    serviceIds = [],
    serviceSlug,
    serviceName,
    radiusMiles,
    nationwide,
  } = req.body
  if (!email || !companyName || !contactName) {
    return fail(res, 'Missing required fields')
  }

  const emailNorm = String(email).toLowerCase().trim()
  const nextContact = String(contactName).trim()
  const nextCompany = String(companyName || contactName).trim()
  const { serviceId } = await resolveServiceId({ serviceIds, serviceSlug, serviceName })
  const radius = nationwide ? null : Number(radiusMiles) || 50

  const staffHit = await prisma.user.findFirst({
    where: { email: emailNorm, role: { in: STAFF_ROLES } },
  })
  if (staffHit) {
    return fail(res, 'This email cannot be used for a business account', 400)
  }

  const existingPro = await findUserByEmailRole(emailNorm, 'PROFESSIONAL', {
    professional: true,
    customer: true,
  })

  // Existing business account → NEW pending application (do not overwrite live profile / password)
  if (existingPro) {
    if (existingPro.status === 'SUSPENDED' || existingPro.status === 'INACTIVE') {
      return fail(res, 'This account is not available. Please contact support.', 403)
    }

    const application = await prisma.businessApplication.create({
      data: {
        userId: existingPro.id,
        email: emailNorm,
        contactName: nextContact,
        companyName: nextCompany,
        phone: phone || null,
        website: website || null,
        postcode: nationwide ? 'UK' : postcode || null,
        radiusMiles: radius,
        nationwide: Boolean(nationwide),
        serviceName: serviceName || serviceSlug || null,
        serviceId,
        isAdditional: true,
        status: 'PENDING',
      },
    })

    await sendProfessionalUnderReviewEmail(existingPro, nextContact)
    await notifyAdminsOfNewBusiness({
      user: existingPro,
      contactName: nextContact,
      companyName: nextCompany,
      serviceName: serviceName || serviceSlug || null,
    })
    await logActivity({
      userId: existingPro.id,
      action: 'professional.application.additional',
      ip: req.ip,
      meta: { applicationId: application.id, serviceName: application.serviceName },
    })

    return ok(res, {
      message:
        'Thanks — we received your additional business application. An admin will review it before it goes live.',
      existing: true,
      updated: false,
      applicationId: application.id,
      user: publicUser(existingPro),
    })
  }

  // Customer may already exist with this email — create a SEPARATE business user + password
  if (!password || String(password).length < 6) {
    return fail(res, 'password must be at least 6 characters')
  }

  const areaPostcode = nationwide ? 'NATIONWIDE' : postcode || null
  const verificationToken = randomToken()
  const user = await prisma.user.create({
    data: {
      email: emailNorm,
      passwordHash: await bcrypt.hash(password, 10),
      role: 'PROFESSIONAL',
      status: 'PENDING',
      verificationToken,
      professional: {
        create: {
          companyName: nextCompany,
          contactName: nextContact,
          phone: phone || null,
          postcode: postcode || null,
          website: website || null,
          isAvailable: false,
          services: serviceId ? { create: [{ serviceId }] } : undefined,
          serviceAreas: areaPostcode
            ? {
                create: [
                  {
                    postcode: areaPostcode,
                    radiusMiles: radius,
                    label: nationwide ? 'Nationwide' : undefined,
                  },
                ],
              }
            : undefined,
        },
      },
    },
    include: { professional: true },
  })

  const application = await prisma.businessApplication.create({
    data: {
      userId: user.id,
      email: emailNorm,
      contactName: nextContact,
      companyName: nextCompany,
      phone: phone || null,
      website: website || null,
      postcode: nationwide ? 'UK' : postcode || null,
      radiusMiles: radius,
      nationwide: Boolean(nationwide),
      serviceName: serviceName || serviceSlug || null,
      serviceId,
      isAdditional: false,
      status: 'PENDING',
    },
  })

  await sendProfessionalUnderReviewEmail(user, nextContact)
  await notifyAdminsOfNewBusiness({
    user,
    contactName: nextContact,
    companyName: nextCompany,
    serviceName: serviceName || serviceSlug || null,
  })
  await logActivity({
    userId: user.id,
    action: 'professional.register',
    ip: req.ip,
    meta: { applicationId: application.id },
  })

  return ok(
    res,
    {
      message: 'Application submitted. Your account is pending admin review.',
      existing: false,
      applicationId: application.id,
      user: publicUser(user),
    },
    201,
  )
})

const login = asyncHandler(async (req, res) => {
  const { email, password, role: roleRaw } = req.body
  const user = await findUserForLogin(email, roleRaw)

  if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) {
    return fail(res, 'Invalid credentials', 401)
  }

  if (user.status === 'SUSPENDED') return fail(res, 'Account suspended', 403)
  if (user.status === 'PENDING') {
    return fail(
      res,
      'Your application is still under review. We will email you when it is approved.',
      403,
    )
  }
  if (user.status === 'INACTIVE') return fail(res, 'Account is inactive', 403)

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  await logActivity({ userId: user.id, action: 'auth.login', ip: req.ip })

  return ok(res, { token: signToken(user), user: publicUser(user) })
})

const me = asyncHandler(async (req, res) => ok(res, { user: publicUser(req.user) }))

const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body
  const user = await prisma.user.findFirst({ where: { verificationToken: token } })
  if (!user) return fail(res, 'Invalid verification token', 400)

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, status: 'ACTIVE', verificationToken: null },
  })

  return ok(res, { message: 'Email verified successfully' })
})

const forgotPassword = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim()
  const role = resolveAuthRole(req.body.role, 'CUSTOMER')
  const generic = { message: 'If that email exists, a reset link was sent' }
  const user = await findUserByEmailRole(email, role, null)
  if (!user) return ok(res, generic)

  const resetToken = randomToken()
  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetToken,
      resetTokenExpiry: new Date(Date.now() + 1000 * 60 * 60),
    },
  })

  const resetUrl = `${process.env.APP_URL}/reset-password?token=${resetToken}`
  await sendEmail({
    to: user.email,
    userId: user.id,
    templateKey: 'password_reset',
    type: 'PASSWORD_RESET',
    title: 'Password reset',
    body: `Reset your password: ${resetUrl}`,
    vars: { resetUrl, name: user.professional?.contactName || user.customer?.firstName || 'there' },
  })

  return ok(res, generic)
})

const requestLoginLink = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim()
  if (!email) return fail(res, 'Email is required')
  const role = resolveAuthRole(req.body.role, 'CUSTOMER')

  const user = await findUserByEmailRole(email, role)

  const generic = { message: 'If that email exists, a login link was sent' }
  if (!user) return ok(res, generic)
  if (user.status === 'SUSPENDED') return ok(res, generic)

  const loginToken = `login_${randomToken()}`
  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetToken: loginToken,
      resetTokenExpiry: new Date(Date.now() + 1000 * 60 * 30),
    },
  })

  const loginPath = role === 'PROFESSIONAL' ? '/business/login' : '/login'
  const loginLinkUrl = `${process.env.APP_URL}${loginPath}?token=${encodeURIComponent(loginToken)}`
  const name =
    [user.customer?.firstName, user.customer?.lastName].filter(Boolean).join(' ') ||
    user.professional?.contactName ||
    user.email.split('@')[0]

  await sendEmail({
    to: user.email,
    userId: user.id,
    templateKey: 'login_link',
    type: 'PASSWORD_RESET',
    title: 'Your login link',
    body: `Log in to 123Quotes: ${loginLinkUrl}`,
    vars: { name, loginLinkUrl },
  })

  return ok(res, generic)
})

const loginWithLink = asyncHandler(async (req, res) => {
  const token = String(req.body.token || '')
  if (!token || !token.startsWith('login_')) {
    return fail(res, 'Invalid or expired login link', 400)
  }

  const user = await prisma.user.findFirst({
    where: { resetToken: token, resetTokenExpiry: { gt: new Date() } },
    include: { customer: true, professional: true },
  })
  if (!user) return fail(res, 'Invalid or expired login link', 400)
  if (user.status === 'SUSPENDED') return fail(res, 'Account suspended', 403)

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      resetToken: null,
      resetTokenExpiry: null,
      lastLoginAt: new Date(),
      emailVerified: true,
      status: user.status === 'PENDING' ? 'ACTIVE' : user.status,
    },
    include: { customer: true, professional: true },
  })

  await logActivity({ userId: updated.id, action: 'auth.login_link', ip: req.ip })

  return ok(res, { token: signToken(updated), user: publicUser(updated) })
})

const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body
  if (!token || !password) return fail(res, 'token and password are required')
  if (String(password).length < 6) return fail(res, 'password must be at least 6 characters')
  if (String(token).startsWith('login_')) return fail(res, 'Invalid or expired reset token')

  const user = await prisma.user.findFirst({
    where: { resetToken: token, resetTokenExpiry: { gt: new Date() } },
    include: { customer: true, professional: true },
  })
  if (!user) return fail(res, 'Invalid or expired reset token')

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(password, 10),
      resetToken: null,
      resetTokenExpiry: null,
      emailVerified: true,
      status: user.status === 'PENDING' ? 'ACTIVE' : user.status,
    },
    include: { customer: true, professional: true },
  })

  return ok(res, {
    message: 'Password updated',
    token: signToken(updated),
    user: publicUser(updated),
  })
})

module.exports = {
  registerProfessional,
  login,
  me,
  verifyEmail,
  forgotPassword,
  requestLoginLink,
  loginWithLink,
  resetPassword,
  publicUser,
  findUserByEmailRole,
}
