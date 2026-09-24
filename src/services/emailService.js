const sgMail = require('@sendgrid/mail')
const prisma = require('../config/db')

const enabled = () =>
  process.env.EMAIL_ENABLED === 'true' && Boolean(process.env.SENDGRID_API_KEY)

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY)
}

function assetBase() {
  return (process.env.EMAIL_ASSET_BASE_URL || process.env.APP_URL || 'http://localhost:5173').replace(
    /\/$/,
    '',
  )
}

function brandVars(extra = {}) {
  const base = assetBase()
  return {
    logoUrl: process.env.EMAIL_LOGO_URL || `${base}/logo.png`,
    appUrl: base,
    loginUrl: `${base}/login`,
    ...extra,
  }
}

async function renderTemplate(key, vars = {}) {
  const template = await prisma.emailTemplate.findUnique({ where: { key } })
  const merged = brandVars(vars)

  if (!template || !template.isActive) {
    return {
      subject: merged.subject || '123 Quotes Notification',
      html: merged.html || `<p>${merged.body || ''}</p>`,
      text: merged.text || merged.body || '',
    }
  }

  const replace = (str) =>
    Object.entries(merged).reduce(
      (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, String(v ?? '')),
      str || '',
    )

  return {
    subject: replace(template.subject),
    html: replace(template.bodyHtml),
    text: replace(template.bodyText || ''),
  }
}

async function sendEmail({ to, templateKey, vars, type, userId, title, body }) {
  const content = await renderTemplate(templateKey, vars)

  if (userId) {
    await prisma.notification.create({
      data: {
        userId,
        type: type || 'ADMIN',
        title: title || content.subject,
        body: body || content.text || content.subject,
        emailSent: false,
        meta: { templateKey },
      },
    })
  }

  if (!enabled()) {
    console.log(`[email:dev] to=${to} subject=${content.subject} logo=${brandVars().logoUrl}`)
    return { queued: false, mocked: true, subject: content.subject, html: content.html }
  }

  await sgMail.send({
    to,
    from: {
      email: process.env.SENDGRID_FROM_EMAIL || 'noreply@123quotes.com',
      name: process.env.SENDGRID_FROM_NAME || '123 Quotes',
    },
    subject: content.subject,
    html: content.html,
    text: content.text || undefined,
  })

  if (userId) {
    await prisma.notification.updateMany({
      where: { userId, title: title || content.subject, emailSent: false },
      data: { emailSent: true },
    })
  }

  return { queued: true }
}

module.exports = { sendEmail, renderTemplate, brandVars }
