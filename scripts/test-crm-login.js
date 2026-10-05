async function tryLogin(base, email, password, role) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, role }),
  })
  const body = await res.json().catch(() => ({}))
  console.log(`${base} ${email} role=${role} => ${res.status}`, body.message || body.user?.role || 'ok')
}

;(async () => {
  await tryLogin('http://127.0.0.1:5000', 'superadmin@123quotes.com', 'superadmin123', 'STAFF')
  await tryLogin('http://127.0.0.1:5000', 'admin@123quotes.com', 'admin123', 'STAFF')
  try {
    await tryLogin('http://127.0.0.1:5174', 'superadmin@123quotes.com', 'superadmin123', 'STAFF')
  } catch (e) {
    console.log('CRM proxy down:', e.message)
  }
})()
