require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')
const { EMAIL_TEMPLATES } = require('../src/emails/templates')

const prisma = new PrismaClient()

const SAMPLE_VARS = {
  customerName: 'Alex Customer',
  matchCountLabel: '3 professionals',
  loginUrl: 'https://example.com/login',
  ctaUrl: 'https://example.com/set-password?token=preview',
  ctaLabel: 'Log in to 123Quotes',
  accountHeading: 'Your Free 123Quotes Account',
  accountBody:
    'We have created an account for you so that you can better manage this request as well as any future requests you may wish to place. Simply click the button below to log in:',
  name: 'Jordan',
  verifyUrl: 'https://example.com/verify?token=preview',
  resetUrl: 'https://example.com/reset-password?token=preview',
  loginLinkUrl: 'https://example.com/login?token=preview',
  serviceName: 'Web Development',
  postcode: 'SW1A 1AA',
  summary: 'Create a new website · Budget under £500 · ASAP',
  answersHtml: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;border:1px solid #d6e4f0;border-radius:10px;overflow:hidden;background:#fafcfe;">
      <tr><td style="padding:12px 14px;background:#eef6fc;border-bottom:1px solid #d6e4f0;"><p style="margin:0;font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#0a3a7a;">Customer answers</p></td></tr>
      <tr><td style="padding:12px 14px;"><p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;color:#64748b;">Project type</p><p style="margin:0;font-size:15px;font-weight:600;color:#0a3a7a;">New website</p></td></tr>
      <tr><td style="padding:12px 14px;border-top:1px solid #e8f0f7;"><p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;color:#64748b;">Budget</p><p style="margin:0;font-size:15px;font-weight:600;color:#0a3a7a;">Under £500</p></td></tr>
    </table>`,
  answersText: 'Project type: New website\nBudget: Under £500',
  businessLoginUrl: 'https://example.com/business/login',
  customerEmail: 'customer@example.com',
  customerPhone: '+44 7700 900123',
  tokens: '100',
  packageName: '100 Tokens',
  balance: '2',
  businessName: 'Prime Heat Engineers',
  setPasswordUrl: 'https://example.com/set-password?token=preview&audience=business',
}

function fillTemplate(html) {
  const assetBase = (process.env.EMAIL_ASSET_BASE_URL || process.env.APP_URL || 'http://localhost:5173').replace(
    /\/$/,
    '',
  )
  let out = html.replaceAll('{{logoUrl}}', `${assetBase}/logo.png`)
  for (const [key, value] of Object.entries(SAMPLE_VARS)) {
    out = out.replaceAll(`{{${key}}}`, value)
  }
  return out
}

async function main() {
  for (const t of EMAIL_TEMPLATES) {
    await prisma.emailTemplate.upsert({
      where: { key: t.key },
      create: { ...t, isActive: true },
      update: {
        subject: t.subject,
        bodyHtml: t.bodyHtml,
        bodyText: t.bodyText,
        isActive: true,
      },
    })
    console.log('upserted', t.key)
  }

  const outDir = path.join(__dirname, '../tmp/email-previews')
  fs.mkdirSync(outDir, { recursive: true })

  const indexLines = ['<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Email previews</title></head><body style="font-family:Arial;padding:24px;">', '<h1>123 Quotes email previews</h1><ul>']

  for (const t of EMAIL_TEMPLATES) {
    const file = path.join(outDir, `${t.key}.html`)
    fs.writeFileSync(file, fillTemplate(t.bodyHtml), 'utf8')
    indexLines.push(`<li><a href="./${t.key}.html">${t.key}</a> — ${t.subject}</li>`)
  }

  indexLines.push('</ul></body></html>')
  fs.writeFileSync(path.join(outDir, 'index.html'), indexLines.join('\n'), 'utf8')

  console.log('Previews written:', outDir)
  console.log('Templates synced:', EMAIL_TEMPLATES.length)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
