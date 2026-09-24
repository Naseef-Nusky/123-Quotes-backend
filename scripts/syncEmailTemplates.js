require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')
const { EMAIL_TEMPLATES } = require('../src/emails/templates')

const prisma = new PrismaClient()

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

  // Write HTML preview for the welcome email
  const welcome = EMAIL_TEMPLATES.find((t) => t.key === 'request_submitted')
  const assetBase = (process.env.EMAIL_ASSET_BASE_URL || process.env.APP_URL || 'http://localhost:5173').replace(
    /\/$/,
    '',
  )
  const sample = welcome.bodyHtml
    .replaceAll('{{logoUrl}}', `${assetBase}/logo.png`)
    .replaceAll('{{customerName}}', 'tester newbuild')
    .replaceAll('{{matchCountLabel}}', '3 professionals')
    .replaceAll('{{loginUrl}}', `${assetBase}/set-password?token=preview`)
    .replaceAll('{{ctaUrl}}', `${assetBase}/set-password?token=preview`)
    .replaceAll('{{ctaLabel}}', 'Log in to 123Quotes')
    .replaceAll('{{accountHeading}}', 'Your Free 123Quotes Account')
    .replaceAll(
      '{{accountBody}}',
      'We have created an account for you so that you can better manage this request as well as any future requests you may wish to place. Simply click the button below to log in:',
    )

  const outDir = path.join(__dirname, '../tmp')
  fs.mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, 'email-preview-welcome.html')
  fs.writeFileSync(outFile, sample, 'utf8')
  console.log('Preview written:', outFile)
  console.log('Templates synced:', EMAIL_TEMPLATES.length)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
