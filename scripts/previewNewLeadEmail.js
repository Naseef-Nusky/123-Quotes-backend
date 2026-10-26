require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { renderTemplate } = require('../src/services/emailService')

async function main() {
  const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
  const answersHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;border:1px solid #d6e4f0;border-radius:10px;overflow:hidden;background:#fafcfe;">
      <tr>
        <td style="padding:12px 14px;background:#eef6fc;border-bottom:1px solid #d6e4f0;">
          <p style="margin:0;font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#0a3a7a;">Customer answers</p>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 14px;">
          <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.02em;text-transform:uppercase;color:#64748b;">Property type</p>
          <p style="margin:0;font-size:15px;font-weight:600;color:#0a3a7a;">3-bed flat</p>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 14px;border-top:1px solid #e8f0f7;">
          <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.02em;text-transform:uppercase;color:#64748b;">How often?</p>
          <p style="margin:0;font-size:15px;font-weight:600;color:#0a3a7a;">Weekly</p>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 14px;border-top:1px solid #e8f0f7;">
          <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.02em;text-transform:uppercase;color:#64748b;">Preferred time</p>
          <p style="margin:0;font-size:15px;font-weight:600;color:#0a3a7a;">Weekday mornings</p>
        </td>
      </tr>
    </table>`

  const content = await renderTemplate('new_lead', {
    serviceName: 'House Cleaning',
    postcode: 'SW1A 1AA',
    summary: 'Customer needs a weekly clean for a 3-bed flat. Flexible weekday mornings.',
    answersHtml,
    answersText: 'Property type: 3-bed flat\nHow often?: Weekly\nPreferred time: Weekday mornings',
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
