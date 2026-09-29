/**
 * Shared branded HTML email templates for 123 Quotes.
 * Logo is injected via {{logoUrl}} (inline CID from emailService when sending).
 */

const BRAND_BLUE = '#1e8fd5'
const BRAND_BLUE_LIGHT = '#3baee8'
const BRAND_NAVY = '#0a3a7a'
const TEXT = '#222222'
const MUTED = '#64748b'
const BORDER = '#d6e4f0'

function shell({ title, bodyRows }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f8fc;font-family:Arial,Helvetica,sans-serif;color:${TEXT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f8fc;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid ${BORDER};box-shadow:0 4px 24px rgba(10,58,122,0.08);">
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,${BRAND_BLUE_LIGHT} 0%,${BRAND_BLUE} 50%,${BRAND_NAVY} 100%);font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td align="center" style="padding:28px 28px 16px;background:#ffffff;">
              <img src="{{logoUrl}}" alt="123 Quotes" width="140" style="display:block;border:0;height:auto;max-width:140px;margin:0 auto;" />
            </td>
          </tr>
          ${bodyRows}
          <tr>
            <td style="padding:22px 28px 28px;font-size:12px;line-height:1.6;color:${MUTED};text-align:center;border-top:1px solid #e8f0f7;background:#fafcfe;">
              <p style="margin:0 0 8px;font-weight:600;color:${BRAND_NAVY};">123Quotes</p>
              <p style="margin:0 0 8px;">
                <a href="mailto:info@123quotes.co.uk" style="color:${BRAND_BLUE};text-decoration:none;">info@123quotes.co.uk</a>
              </p>
              <p style="margin:0;font-size:11px;">© 123Quotes · All rights reserved</p>
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
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${TEXT};">${text}</p>`
}

function h1(text) {
  return `<h1 style="margin:0 0 18px;font-size:26px;line-height:1.25;font-weight:700;color:#111111;">${text}</h1>`
}

function h2(text) {
  return `<h2 style="margin:20px 0 10px;font-size:18px;line-height:1.3;font-weight:700;color:${BRAND_NAVY};">${text}</h2>`
}

function link(hrefVar, label) {
  return `<a href="{{${hrefVar}}}" style="color:${BRAND_BLUE};text-decoration:underline;font-weight:600;">${label}</a>`
}

function btn(hrefVar, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px;">
  <tr>
    <td align="left" style="border-radius:8px;background:linear-gradient(180deg,${BRAND_BLUE_LIGHT} 0%,${BRAND_BLUE} 45%,${BRAND_NAVY} 100%);">
      <a href="{{${hrefVar}}}" target="_blank" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">${label}</a>
    </td>
  </tr>
</table>`
}

function contentCell(inner) {
  return `<tr><td style="padding:4px 28px 8px;text-align:left;">${inner}</td></tr>`
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
        ${p(`We've received your request and have already found {{matchCountLabel}} that match your criteria. To view them, ${link('loginUrl', 'sign into your account')}.`)}
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
        ${p('If you did not create this account, you can ignore this email.')}
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
        ${p('Hi {{name}},')}
        ${p('We received a request to reset your 123Quotes password. Click the button below to choose a new one.')}
        ${btn('resetUrl', 'Reset password')}
        ${p('If you did not request this, you can ignore this email.')}
      `),
    }),
    bodyText: 'Reset your password: {{resetUrl}}',
  },
  {
    key: 'login_link',
    subject: 'Your 123Quotes login link',
    bodyHtml: shell({
      title: 'Log in to 123Quotes',
      bodyRows: contentCell(`
        ${h1('Log in to 123Quotes')}
        ${p('Hi {{name}},')}
        ${p('Click the button below to sign in to your account. This link expires in 30 minutes.')}
        ${btn('loginLinkUrl', 'Log in')}
        ${p('If you did not request this email, you can ignore it.')}
      `),
    }),
    bodyText: 'Log in to 123Quotes: {{loginLinkUrl}}',
  },
  {
    key: 'new_lead',
    subject: 'New {{serviceName}} lead near {{postcode}}',
    bodyHtml: shell({
      title: 'New lead available',
      bodyRows: contentCell(`
        ${h1('New lead available')}
        ${p('Hi there,')}
        ${p('A new <strong>{{serviceName}}</strong> lead is available near <strong>{{postcode}}</strong>.')}
        ${p('{{summary}}')}
        ${btn('businessLoginUrl', 'View lead in portal')}
      `),
    }),
    bodyText: 'New lead: {{serviceName}} / {{postcode}} — {{businessLoginUrl}}',
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
        ${btn('businessLoginUrl', 'Open lead in portal')}
      `),
    }),
    bodyText: 'Unlocked: {{customerName}} {{customerEmail}} {{customerPhone}} — {{businessLoginUrl}}',
  },
  {
    key: 'token_purchase',
    subject: 'Token purchase confirmed',
    bodyHtml: shell({
      title: 'Token purchase confirmed',
      bodyRows: contentCell(`
        ${h1('Purchase confirmed')}
        ${p('Thank you — your payment was successful.')}
        ${p('You purchased <strong>{{tokens}}</strong> tokens ({{packageName}}).')}
        ${btn('businessLoginUrl', 'Go to business portal')}
      `),
    }),
    bodyText: 'Purchased {{tokens}} tokens ({{packageName}}) — {{businessLoginUrl}}',
  },
  {
    key: 'low_token',
    subject: 'Low token balance',
    bodyHtml: shell({
      title: 'Low token balance',
      bodyRows: contentCell(`
        ${h1('Low token balance')}
        ${p('Your balance is <strong>{{balance}}</strong> tokens. Top up to keep unlocking leads and reaching customers.')}
        ${btn('businessLoginUrl', 'Buy tokens')}
      `),
    }),
    bodyText: 'Low balance: {{balance}} tokens — top up: {{businessLoginUrl}}',
  },
  {
    key: 'professional_under_review',
    subject: 'Your 123Quotes application is under review',
    bodyHtml: shell({
      title: 'Application under review',
      bodyRows: contentCell(`
        ${h1('Application under review')}
        ${p('Hi {{name}},')}
        ${p('Thank you for submitting your details. Your business application is currently under review by our team.')}
        ${p('We will email you once your account has been approved so you can start viewing leads.')}
        ${p('If you have any questions, reply to this email or contact <a href="mailto:info@123quotes.co.uk" style="color:' + BRAND_BLUE + ';text-decoration:none;font-weight:600;">info@123quotes.co.uk</a>.')}
      `),
    }),
    bodyText:
      'Hi {{name}}, thank you for submitting your details. Your business application is currently under review. We will email you once it is approved.',
  },
  {
    key: 'professional_approved',
    subject: 'Welcome to 123Quotes',
    bodyHtml: shell({
      title: 'Welcome to 123Quotes',
      bodyRows: contentCell(`
        ${h1('Welcome to 123Quotes, {{businessName}}')}
        ${p('We are excited to work with you. Please keep a look out for new leads from customers who are waiting for you to contact them.')}
        ${p('You can log into your account and manage your leads anytime. Set your password below, then sign in to your business portal.')}
        ${btn('setPasswordUrl', 'Log in to 123Quotes')}
      `),
    }),
    bodyText:
      'Welcome to 123Quotes, {{businessName}}. We are excited to work with you. Please keep a look out for new leads from customers who are waiting for you to contact them. Log in: {{setPasswordUrl}}',
  },
]

module.exports = { EMAIL_TEMPLATES, BRAND_BLUE, BRAND_NAVY }
