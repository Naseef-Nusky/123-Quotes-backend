/**
 * Register a domain for Apple Pay with Square.
 *
 * Prerequisites:
 * 1. Host Square's verification file at:
 *    https://YOUR_DOMAIN/.well-known/apple-developer-merchantid-domain-association
 *    (shipped in 123-Quotes-frontend/public/.well-known/)
 * 2. Confirm nginx serves that path as a static file (not SPA index.html)
 * 3. Use matching SQUARE_* credentials (sandbox vs production)
 *
 * Usage:
 *   node scripts/register-apple-pay-domain.js www.app.123quotes.co.uk
 *   node scripts/register-apple-pay-domain.js app.123quotes.co.uk www.123quotes.co.uk
 */
require('dotenv').config()
const { SquareClient, SquareEnvironment } = require('square')

async function main() {
  const domains = process.argv.slice(2).map((d) => d.trim().replace(/^https?:\/\//, '').replace(/\/$/, ''))
  if (!domains.length) {
    console.error('Usage: node scripts/register-apple-pay-domain.js <domain> [domain...]')
    process.exit(1)
  }
  if (!process.env.SQUARE_ACCESS_TOKEN) {
    console.error('SQUARE_ACCESS_TOKEN is required')
    process.exit(1)
  }

  const environment =
    process.env.SQUARE_ENVIRONMENT === 'production'
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox

  const client = new SquareClient({
    token: process.env.SQUARE_ACCESS_TOKEN,
    environment,
  })

  console.log(`Square environment: ${process.env.SQUARE_ENVIRONMENT || 'sandbox'}`)

  for (const domainName of domains) {
    process.stdout.write(`Registering ${domainName}… `)
    try {
      const res = await client.applePay.registerDomain({ domainName })
      console.log(res?.status || res?.domainStatus || 'OK', JSON.stringify(res || {}))
    } catch (err) {
      const detail =
        err?.errors?.[0]?.detail ||
        err?.body?.errors?.[0]?.detail ||
        err?.message ||
        String(err)
      console.log('FAILED')
      console.error(`  ${detail}`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
