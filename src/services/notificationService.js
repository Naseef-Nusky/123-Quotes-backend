const prisma = require('../config/db')
const { sendEmail } = require('./emailService')
const { randomToken } = require('../utils/crypto')
const { EMAIL_TEMPLATES } = require('../emails/templates')

function adminBaseUrl() {
  return (process.env.ADMIN_URL || process.env.CRM_URL || 'http://localhost:5174').replace(/\/$/, '')
}

function appBaseUrl() {
  return (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
}

async function ensureEmailTemplate(key) {
  const source = EMAIL_TEMPLATES.find((t) => t.key === key)
  if (!source) return
  await prisma.emailTemplate.upsert({
    where: { key },
    create: {
      key: source.key,
      subject: source.subject,
      bodyHtml: source.bodyHtml,
      bodyText: source.bodyText,
      isActive: true,
    },
    update: {
      subject: source.subject,
      bodyHtml: source.bodyHtml,
      bodyText: source.bodyText,
      isActive: true,
    },
  })
}

/** In-app notifications for all admin / super-admin users. */
async function notifyAdmins({ title, body, meta = {}, type = 'ADMIN' }) {
  const admins = await prisma.user.findMany({
    where: {
      role: { in: ['ADMIN', 'SUPER_ADMIN'] },
      status: 'ACTIVE',
    },
    select: { id: true },
  })

  if (!admins.length) return { count: 0 }

  await prisma.notification.createMany({
    data: admins.map((a) => ({
      userId: a.id,
      type,
      title,
      body,
      meta,
      emailSent: false,
      isRead: false,
    })),
  })

  return { count: admins.length }
}

async function sendProfessionalUnderReviewEmail(user, contactName) {
  return sendEmail({
    to: user.email,
    userId: user.id,
    templateKey: 'professional_under_review',
    type: 'STATUS_UPDATE',
    title: 'Application under review',
    body: 'Your business application is currently under review.',
    vars: {
      name: contactName || 'there',
      loginUrl: `${appBaseUrl()}/business/login`,
    },
  })
}

async function sendProfessionalApprovedEmail(user, contactName, companyName) {
  const setPasswordToken = randomToken()
  const expiry = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7) // 7 days

  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetToken: setPasswordToken,
      resetTokenExpiry: expiry,
      emailVerified: true,
      status: 'ACTIVE',
    },
  })

  const base = appBaseUrl()
  const setPasswordUrl = `${base}/set-password?token=${encodeURIComponent(setPasswordToken)}&audience=business`
  const businessLoginUrl = `${base}/business/login`
  const businessName =
    companyName ||
    contactName ||
    user.professional?.companyName ||
    user.professional?.contactName ||
    'there'

  await ensureEmailTemplate('professional_approved')

  return sendEmail({
    to: user.email,
    userId: user.id,
    templateKey: 'professional_approved',
    type: 'STATUS_UPDATE',
    title: 'Welcome to 123Quotes',
    body: 'Your business application has been approved. Log in to manage your leads.',
    vars: {
      name: contactName || businessName,
      businessName,
      setPasswordUrl,
      businessLoginUrl,
      loginUrl: setPasswordUrl,
    },
  })
}

async function notifyAdminsOfNewBusiness({ user, contactName, companyName, serviceName }) {
  const reviewUrl = `${adminBaseUrl()}/business-registration`
  const company = companyName || contactName || user.email
  return notifyAdmins({
    title: 'New business registration',
    body: `${company} (${user.email}) applied${serviceName ? ` for ${serviceName}` : ''}. Pending review.`,
    meta: {
      kind: 'business_registration',
      userId: user.id,
      email: user.email,
      companyName: company,
      serviceName: serviceName || null,
      reviewUrl,
    },
  })
}

module.exports = {
  notifyAdmins,
  notifyAdminsOfNewBusiness,
  sendProfessionalUnderReviewEmail,
  sendProfessionalApprovedEmail,
  adminBaseUrl,
  appBaseUrl,
}
