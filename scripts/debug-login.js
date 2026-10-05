require('dotenv').config()
const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  const email = 'superadmin@123quotes.com'
  const envPw = process.env.SUPER_ADMIN_PASSWORD || 'superadmin123'
  const users = await prisma.user.findMany({
    where: { email },
    select: { id: true, email: true, role: true, status: true, passwordHash: true },
  })
  console.log(
    'users',
    users.map((u) => ({ id: u.id, role: u.role, status: u.status, hash: u.passwordHash?.slice(0, 10) })),
  )
  for (const u of users) {
    console.log(u.role, 'envPw match', await bcrypt.compare(envPw, u.passwordHash || ''))
    console.log(u.role, 'literal superadmin123', await bcrypt.compare('superadmin123', u.passwordHash || ''))
  }

  const candidates = [
    { email: 'superadmin@123quotes.com', password: 'superadmin123', role: 'STAFF' },
    { email: 'admin@123quotes.com', password: 'admin123', role: 'STAFF' },
    { email: 'superadmin@123quotes.com', password: 'admin123', role: 'STAFF' },
    { email: 'admin@123quotes.com', password: 'superadmin123', role: 'STAFF' },
  ]
  for (const body of candidates) {
    const res = await fetch('http://127.0.0.1:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    console.log(body.email, body.password, '=>', res.status, data.message || data.user?.role)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
