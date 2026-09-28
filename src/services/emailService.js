const fs = require('fs')
const path = require('path')
const sgMail = require('@sendgrid/mail')
const prisma = require('../config/db')

const LOGO_CID = '123quotes-logo'

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

function resolveLogoFile() {
  const candidates = [
    process.env.EMAIL_LOGO_PATH,
    path.join(__dirname, '../assets/logo.png'),
    path.join(__dirname, '../../../123 Quotes-frontend/public/logo.png'),
  ].filter(Boolean)

  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) return file
    } catch {
      /* ignore */
    }
  }
  return null
}

function isPublicHttpUrl(url) {
  return /^https:\/\//i.test(String(url || ''))
}

function brandVars(extra = {}) {
  const base = assetBase()
  const configured = process.env.EMAIL_LOGO_URL || ''

  // Email clients cannot load localhost/http images — use inline CID unless a public https logo is set
  const logoUrl = isPublicHttpUrl(configured) ? configured : `cid:${LOGO_CID}`

  return {
    logoUrl,
    appUrl: base,
    loginUrl: `${base}/login`,
    businessLoginUrl: `${base}/business/login`,
    ...extra,
  }
}

function buildLogoAttachment() {
  const file = resolveLogoFile()
  if (!file) return null
  return {
    content: fs.readFileSync(file).toString('base64'),
    filename: 'logo.png',
    type: 'image/png',
    disposition: 'inline',
    content_id: LOGO_CID,
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
      logoUrl: merged.logoUrl,
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
    logoUrl: merged.logoUrl,
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
    console.log(
      `[email:dev] to=${to} subject=${content.subject} logo=${content.logoUrl}`,
    )
    return { queued: false, mocked: true, subject: content.subject, html: content.html }
  }

  const msg = {
    to,
    from: {
      email: process.env.SENDGRID_FROM_EMAIL || 'noreply@123quotes.com',
      name: process.env.SENDGRID_FROM_NAME || '123 Quotes',
    },
    subject: content.subject,
    html: content.html,
    text: content.text || undefined,
  }

  if (String(content.logoUrl || '').startsWith('cid:')) {
    const attachment = buildLogoAttachment()
    if (attachment) {
      msg.attachments = [attachment]
    } else {
      console.warn('[email:sendgrid] logo file missing — emails will send without logo image')
    }
  }

  try {
    await sgMail.send(msg)
  } catch (err) {
    const detail = err?.response?.body || err.message
    console.error('[email:sendgrid] failed', {
      to,
      from: process.env.SENDGRID_FROM_EMAIL,
      templateKey,
      detail,
    })
    throw new Error(
      typeof detail === 'string'
        ? detail
        : detail?.errors?.[0]?.message || 'SendGrid email failed',
    )
  }

  if (userId) {
    await prisma.notification.updateMany({
      where: { userId, title: title || content.subject, emailSent: false },
      data: { emailSent: true },
    })
  }

  console.log(
    `[email:sent] to=${to} subject=${content.subject} template=${templateKey || '—'} logo=${content.logoUrl}`,
  )
  return { queued: true }
}

module.exports = { sendEmail, renderTemplate, brandVars, resolveLogoFile }
