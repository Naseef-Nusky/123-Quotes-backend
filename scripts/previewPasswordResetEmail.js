require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { renderTemplate, brandVars } = require('../src/services/emailService')

async function main() {
  const resetUrl = `${process.env.APP_URL}/reset-password?token=preview-token`
  const content = await renderTemplate('password_reset', { resetUrl })
  const outDir = path.join(__dirname, '../tmp')
  fs.mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, 'email-preview-password-reset.html')
  fs.writeFileSync(outFile, content.html, 'utf8')
  console.log({
    subject: content.subject,
    hasLogo: content.html.includes('logo.png') || content.html.includes('logoUrl') === false,
    logoInHtml: content.html.includes('/logo.png'),
    hasButton: content.html.includes('Reset password'),
    hasResetLink: content.html.includes(resetUrl),
    EMAIL_ENABLED: process.env.EMAIL_ENABLED,
    preview: outFile,
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
