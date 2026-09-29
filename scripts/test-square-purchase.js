require('dotenv').config({ quiet: true })

async function main() {
  const base = 'http://localhost:5000/api'

  const loginRes = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pro@123quotes.com', password: 'pro12345', role: 'PROFESSIONAL' }),
  })
  const login = await loginRes.json()
  if (!loginRes.ok) throw new Error(`Login failed: ${JSON.stringify(login)}`)
  const token = login.token
  console.log('logged in', login.user?.email, 'balance', login.user?.professional?.tokenBalance)

  const pkgsRes = await fetch(`${base}/professionals/packages`)
  const pkgs = await pkgsRes.json()
  const pkg = (pkgs.packages || [])[0]
  if (!pkg) throw new Error('No packages')
  console.log('buying', pkg.name, pkg.priceCents, pkg.currency)

  const buyRes = await fetch(`${base}/professionals/me/tokens/purchase`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      packageId: pkg.id,
      sourceId: 'cnon:card-nonce-ok',
    }),
  })
  const buy = await buyRes.json()
  console.log('status', buyRes.status)
  console.log(JSON.stringify(buy, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
