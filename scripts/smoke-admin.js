/**
 * Quick smoke checks for admin CRM API flows.
 * Run: node scripts/smoke-admin.js
 */
require('dotenv').config()

const BASE = process.env.APP_API_URL || 'http://localhost:5000/api'

async function req(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function main() {
  console.log('Smoke testing', BASE)

  const login = await req('/auth/login', {
    method: 'POST',
    body: {
      email: process.env.SUPER_ADMIN_EMAIL || 'superadmin@123quotes.com',
      password: process.env.SUPER_ADMIN_PASSWORD || 'superadmin123',
    },
  })
  assert(login.status === 200, `login failed: ${login.status} ${login.data.message}`)
  assert(login.data.user?.role === 'SUPER_ADMIN', 'expected SUPER_ADMIN role')
  const token = login.data.token
  console.log('OK login super admin')

  const me = await req('/auth/me', { token })
  assert(me.status === 200, 'me failed')
  assert(me.data.user?.role === 'SUPER_ADMIN', 'me role mismatch')
  console.log('OK /auth/me')

  const users = await req('/admin/users?roles=ADMIN,SUPER_ADMIN', { token })
  assert(users.status === 200, 'list users failed')
  assert(Array.isArray(users.data.users), 'users array missing')
  const superUser = users.data.users.find((u) => u.role === 'SUPER_ADMIN')
  assert(superUser, 'super admin missing from list')
  console.log('OK list system users', users.data.users.length)

  const blockEdit = await req(`/admin/users/${superUser.id}`, {
    method: 'PUT',
    token,
    body: { firstName: 'Hack' },
  })
  assert(blockEdit.status === 403, `super admin edit should be 403, got ${blockEdit.status}`)
  console.log('OK super admin edit blocked')

  const blockStatus = await req(`/admin/users/${superUser.id}/status`, {
    method: 'PATCH',
    token,
    body: { status: 'SUSPENDED' },
  })
  assert(blockStatus.status === 403, `super admin status should be 403, got ${blockStatus.status}`)
  console.log('OK super admin status blocked')

  const blockDelete = await req(`/admin/users/${superUser.id}`, {
    method: 'DELETE',
    token,
  })
  assert(blockDelete.status === 403, `super admin delete should be 403, got ${blockDelete.status}`)
  console.log('OK super admin delete blocked')

  const payments = await req('/admin/payments?type=all', { token })
  assert(payments.status === 200, 'payments failed')
  console.log('OK payments', (payments.data.payments || []).length)

  const content = await req('/content/home')
  assert(content.status === 200 || content.status === 404, 'content route unexpected')
  console.log('OK content/home', content.status)

  console.log('\nAll smoke checks passed.')
}

main().catch((err) => {
  console.error('\nFAIL:', err.message)
  process.exit(1)
})
