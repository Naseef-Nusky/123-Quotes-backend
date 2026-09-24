/**
 * Shared branded HTML email templates for 123 Quotes.
 * Logo is injected via {{logoUrl}} (set automatically by emailService).
 */

const BRAND_BLUE = '#1e8fd5'
const BRAND_NAVY = '#0a3a7a'

function shell({ title, bodyRows }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f8fc;font-family:Arial,Helvetica,sans-serif;color:#222222;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f8fc;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #d6e4f0;">
          <tr>
            <td align="center" style="padding:28px 24px 18px;background:#ffffff;">
              <img src="{{logoUrl}}" alt="123 Quotes" width="140" style="display:block;border:0;height:auto;max-width:140px;" />
            </td>
          </tr>
          ${bodyRows}
          <tr>
            <td style="padding:20px 24px 28px;font-size:12px;line-height:1.5;color:#64748b;text-align:center;border-top:1px solid #e8f0f7;">
              © 123Quotes · <a href="mailto:info@123quotes.co.uk" style="color:${BRAND_BLUE};text-decoration:none;">info@123quotes.co.uk</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function p(text) {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#222222;">${text}</p>`
}

function h1(text) {
  return `<h1 style="margin:0 0 20px;font-size:28px;line-height:1.25;font-weight:700;color:#111111;">${text}</h1>`
}

function h2(text) {
  return `<h2 style="margin:8px 0 12px;font-size:18px;line-height:1.3;font-weight:700;color:#111111;">${text}</h2>`
}

function btn(hrefVar, label) {
  return `<a href="{{${hrefVar}}}" style="display:inline-block;background:linear-gradient(180deg,${BRAND_BLUE} 0%,${BRAND_NAVY} 100%);color:#ffffff;text-decoration:none;padding:13px 24px;font-size:15px;font-weight:700;border-radius:6px;">${label}</a>`
}

function contentCell(inner) {
  return `<tr><td style="padding:8px 28px 28px;text-align:left;">${inner}</td></tr>`
}

const EMAIL_TEMPLATES = [
  {
    key: 'request_submitted',
    subject: 'Welcome to 123Quotes',
    bodyHtml: shell({
      title: 'Welcome to 123Quotes',
      bodyRows: contentCell(`
        ${h1('Welcome to 123Quotes')}
        ${p('Hi {{customerName}},')}
        ${p(`we've received your request and have already found {{matchCountLabel}} that match your criteria. To view them, simply <a href="{{loginUrl}}" style="color:${BRAND_BLUE};text-decoration:underline;">sign into your account</a>`)}
        ${p('<strong>Please remember:</strong> Professionals on 123Quotes pay to respond to you, so please let each of them know whether they are right for the job.')}
        ${h2('{{accountHeading}}')}
        ${p('{{accountBody}}')}
        ${btn('ctaUrl', '{{ctaLabel}}')}
      `),
    }),
    bodyText:
      "Hi {{customerName}}, we've received your request and have already found {{matchCountLabel}} that match your criteria. {{ctaLabel}}: {{ctaUrl}}",
  },
  {
    key: 'account_verification',
    subject: 'Verify your 123Quotes account',
    bodyHtml: shell({
      title: 'Verify your email',
      bodyRows: contentCell(`
        ${h1('Verify your email')}
        ${p('Hi {{name}},')}
        ${p('Thanks for joining 123Quotes. Please verify your email address to activate your account.')}
        ${btn('verifyUrl', 'Verify email')}
      `),
    }),
    bodyText: 'Hi {{name}}, verify your email: {{verifyUrl}}',
  },
  {
    key: 'password_reset',
    subject: 'Reset your 123Quotes password',
    bodyHtml: shell({
      title: 'Reset your password',
      bodyRows: contentCell(`
        ${h1('Reset your password')}
        ${p('We received a request to reset your 123Quotes password. Click the button below to choose a new one.')}
        ${btn('resetUrl', 'Reset password')}
        ${p('If you did not request this, you can ignore this email.')}
      `),
    }),
    bodyText: 'Reset your password: {{resetUrl}}',
  },
  {
    key: 'new_lead',
    subject: 'New {{serviceName}} lead near {{postcode}}',
    bodyHtml: shell({
      title: 'New lead available',
      bodyRows: contentCell(`
        ${h1('New lead available')}
        ${p('A new <strong>{{serviceName}}</strong> lead is available near <strong>{{postcode}}</strong>.')}
        ${p('{{summary}}')}
        ${btn('loginUrl', 'View lead')}
      `),
    }),
    bodyText: 'New lead: {{serviceName}} / {{postcode}} — {{loginUrl}}',
  },
  {
    key: 'lead_unlocked',
    subject: 'Lead unlocked – contact details ready',
    bodyHtml: shell({
      title: 'Lead unlocked',
      bodyRows: contentCell(`
        ${h1('Lead unlocked')}
        ${p('Customer contact details are ready:')}
        ${p('<strong>{{customerName}}</strong><br/>Email: {{customerEmail}}<br/>Phone: {{customerPhone}}')}
      `),
    }),
    bodyText: 'Unlocked: {{customerName}} {{customerEmail}} {{customerPhone}}',
  },
  {
    key: 'token_purchase',
    subject: 'Token purchase confirmed',
    bodyHtml: shell({
      title: 'Token purchase confirmed',
      bodyRows: contentCell(`
        ${h1('Purchase confirmed')}
        ${p('You purchased <strong>{{tokens}}</strong> tokens ({{packageName}}).')}
        ${btn('loginUrl', 'Go to portal')}
      `),
    }),
    bodyText: 'Purchased {{tokens}} tokens ({{packageName}})',
  },
  {
    key: 'low_token',
    subject: 'Low token balance',
    bodyHtml: shell({
      title: 'Low token balance',
      bodyRows: contentCell(`
        ${h1('Low token balance')}
        ${p('Your balance is <strong>{{balance}}</strong> tokens. Top up to keep unlocking leads.')}
        ${btn('loginUrl', 'Buy tokens')}
      `),
    }),
    bodyText: 'Low balance: {{balance}} tokens',
  },
]

module.exports = { EMAIL_TEMPLATES, BRAND_BLUE, BRAND_NAVY }
