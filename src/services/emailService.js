const sgMail = require('@sendgrid/mail')
const prisma = require('../config/db')

const enabled = () =>
  process.env.EMAIL_ENABLED === 'true' && Boolean(process.env.SENDGRID_API_KEY)

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY)
}

async function renderTemplate(key, vars = {}) {
  const template = await prisma.emailTemplate.findUnique({ where: { key } })
  if (!template || !template.isActive) {
    return {
      subject: vars.subject || '123 Quotes Notification',
      html: vars.html || `<p>${vars.body || ''}</p>`,
      text: vars.text || vars.body || '',
    }
  }

  const replace = (str) =>
    Object.entries(vars).reduce(
      (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, String(v ?? '')),
      str,
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
    console.log(`[email:dev] to=${to} subject=${content.subject}`)
    return { queued: false, mocked: true }
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

module.exports = { sendEmail, renderTemplate }
