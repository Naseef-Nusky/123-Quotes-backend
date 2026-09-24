require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const template = {
  key: 'request_submitted',
  subject: 'Welcome to 123Quotes',
  bodyHtml: `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#222222;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:28px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
          <tr>
            <td align="center" style="padding-bottom:22px;">
              <img src="{{logoUrl}}" alt="123 Quotes" width="120" style="display:block;border:0;height:auto;" />
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <img src="{{bannerUrl}}" alt="" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;" />
            </td>
          </tr>
          <tr>
            <td style="padding:0 4px;text-align:left;">
              <h1 style="margin:0 0 22px;font-size:30px;line-height:1.2;font-weight:700;color:#111111;">Welcome to 123Quotes</h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#222222;">Hi {{customerName}},</p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#222222;">
                we've received your request and have already found {{matchCountLabel}} that match your criteria. To view them, simply
                <a href="{{setPasswordUrl}}" style="color:#3b82f6;text-decoration:underline;">sign into your account</a>
              </p>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.65;color:#222222;">
                <strong>Please remember:</strong> Professionals on 123Quotes pay to respond to you, so please let each of them know whether they are right for the job.
              </p>
              <h2 style="margin:0 0 12px;font-size:18px;line-height:1.3;font-weight:700;color:#111111;">Your Free 123Quotes Account</h2>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#222222;">
                We have created an account for you so that you can better manage this request as well as any future requests you may wish to place. Simply click the button below to log in:
              </p>
              <a href="{{setPasswordUrl}}" style="display:inline-block;background:#3b82f6;color:#ffffff;text-decoration:none;padding:12px 22px;font-size:15px;font-weight:700;border-radius:2px;">Log in to 123Quotes</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  bodyText:
    "Hi {{customerName}}, we've received your request and have already found {{matchCountLabel}} that match your criteria. Set your password: {{setPasswordUrl}}",
}

async function main() {
  await prisma.emailTemplate.upsert({
    where: { key: template.key },
    create: { ...template, isActive: true },
    update: {
      subject: template.subject,
      bodyHtml: template.bodyHtml,
      bodyText: template.bodyText,
      isActive: true,
    },
  })
  console.log('request_submitted email template updated')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
