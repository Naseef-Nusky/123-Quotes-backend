require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { renderTemplate } = require('../src/services/emailService')

async function main() {
  const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
  const content = await renderTemplate('new_lead', {
    serviceName: 'House Cleaning',
    postcode: 'SW1A 1AA',
    summary: 'Customer needs a weekly clean for a 3-bed flat. Flexible weekday mornings.',
    businessLoginUrl: `${appUrl}/business/login`,
  })

  const outDir = path.join(__dirname, '../tmp')
  fs.mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, 'email-preview-new-lead.html')

  let html = content.html
  const logoFs = path.join(__dirname, '../src/assets/logo.png')
  if (fs.existsSync(logoFs)) {
    const fileUrl = `file:///${logoFs.replace(/\\/g, '/')}`
    html = html.replace(/src="\{\{logoUrl\}\}"/g, `src="${fileUrl}"`)
    html = html.replace(/src="cid:[^"]+"/g, `src="${fileUrl}"`)
  }

  fs.writeFileSync(outFile, html, 'utf8')
  console.log({
    subject: content.subject,
    preview: outFile,
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
