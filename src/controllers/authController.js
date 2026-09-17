const bcrypt = require('bcryptjs')
const prisma = require('../config/db')
const { signToken } = require('../middleware/auth')
const { randomToken } = require('../utils/crypto')
const { asyncHandler, ok, fail } = require('../utils/helpers')
const { sendEmail } = require('../services/emailService')
const { logActivity } = require('../services/activityService')

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

const registerCustomer = asyncHandler(async (req, res) => {
  const { email, password, firstName, lastName, phone, postcode } = req.body
  if (!email || !password || !firstName || !lastName) {
    return fail(res, 'Missing required fields')
  }

  const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  if (exists) return fail(res, 'Email already registered', 409)

  const verificationToken = randomToken()
  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      passwordHash: await bcrypt.hash(password, 10),
      role: 'CUSTOMER',
      status: 'PENDING',
      verificationToken,
      customer: {
        create: { firstName, lastName, phone, postcode },
      },
    },
    include: { customer: true },
  })

  const verifyUrl = `${process.env.APP_URL}/verify-email?token=${verificationToken}`
  await sendEmail({
    to: user.email,
    userId: user.id,
    templateKey: 'account_verification',
    type: 'ACCOUNT_VERIFICATION',
    title: 'Verify your email',
    body: `Verify your account: ${verifyUrl}`,
    vars: { name: firstName, verifyUrl },
  })

  await logActivity({ userId: user.id, action: 'customer.register', ip: req.ip })
  return ok(res, { message: 'Registered. Please verify your email.', user: publicUser(user) }, 201)
})

const registerProfessional = asyncHandler(async (req, res) => {
  const { email, password, companyName, contactName, phone, postcode, serviceIds = [] } = req.body
  if (!email || !password || !companyName || !contactName) {
    return fail(res, 'Missing required fields')
  }

  const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  if (exists) return fail(res, 'Email already registered', 409)

  const verificationToken = randomToken()
  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      passwordHash: await bcrypt.hash(password, 10),
      role: 'PROFESSIONAL',
      status: 'PENDING',
      verificationToken,
      professional: {
        create: {
          companyName,
          contactName,
          phone,
          postcode,
          services: serviceIds.length
            ? { create: serviceIds.map((serviceId) => ({ serviceId })) }
            : undefined,
          serviceAreas: postcode ? { create: [{ postcode }] } : undefined,
        },
      },
    },
    include: { professional: true },
  })

  const verifyUrl = `${process.env.APP_URL}/verify-email?token=${verificationToken}`
  await sendEmail({
    to: user.email,
    userId: user.id,
    templateKey: 'account_verification',
    type: 'ACCOUNT_VERIFICATION',
    title: 'Verify your email',
    body: `Verify your account: ${verifyUrl}`,
    vars: { name: contactName, verifyUrl },
  })

  await logActivity({ userId: user.id, action: 'professional.register', ip: req.ip })
  return ok(res, { message: 'Registered. Please verify your email.', user: publicUser(user) }, 201)
})

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body
  const user = await prisma.user.findUnique({
    where: { email: String(email || '').toLowerCase() },
    include: { customer: true, professional: true },
  })

  if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) {
    return fail(res, 'Invalid credentials', 401)
  }

  if (user.status === 'SUSPENDED') return fail(res, 'Account suspended', 403)

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
  const email = String(req.body.email || '').toLowerCase()
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) return ok(res, { message: 'If that email exists, a reset link was sent' })

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
    vars: { resetUrl },
  })

  return ok(res, { message: 'If that email exists, a reset link was sent' })
})

const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body
  const user = await prisma.user.findFirst({
    where: { resetToken: token, resetTokenExpiry: { gt: new Date() } },
  })
  if (!user) return fail(res, 'Invalid or expired reset token')

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(password, 10),
      resetToken: null,
      resetTokenExpiry: null,
    },
  })

  return ok(res, { message: 'Password updated' })
})

module.exports = {
  registerCustomer,
  registerProfessional,
  login,
  me,
  verifyEmail,
  forgotPassword,
  resetPassword,
  publicUser,
}
