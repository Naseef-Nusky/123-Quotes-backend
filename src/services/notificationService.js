const prisma = require('../config/db')
const { sendEmail } = require('./emailService')

function adminBaseUrl() {
  return (process.env.ADMIN_URL || process.env.CRM_URL || 'http://localhost:5174').replace(/\/$/, '')
}

function appBaseUrl() {
  return (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
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

async function sendProfessionalApprovedEmail(user, contactName) {
  return sendEmail({
    to: user.email,
    userId: user.id,
    templateKey: 'professional_approved',
    type: 'STATUS_UPDATE',
    title: 'Application approved',
    body: 'Your business application has been approved. You can now log in.',
    vars: {
      name: contactName || 'there',
      loginUrl: `${appBaseUrl()}/business/login`,
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
