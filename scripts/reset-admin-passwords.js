require('dotenv').config()
const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function upsertStaff({ email, password, role, firstName, lastName }) {
  const emailNorm = String(email).toLowerCase().trim()
  let user = await prisma.user.findFirst({
    where: { email: emailNorm, role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
  })
  const passwordHash = await bcrypt.hash(password, 10)

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: emailNorm,
        passwordHash,
        role,
        status: 'ACTIVE',
        emailVerified: true,
        customer: { create: { firstName, lastName } },
      },
    })
    console.log('created', emailNorm, role)
    return
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      role,
      status: 'ACTIVE',
      emailVerified: true,
    },
  })
  console.log('reset password', emailNorm, role)
}

async function main() {
  await upsertStaff({
    email: process.env.SUPER_ADMIN_EMAIL || 'superadmin@123quotes.com',
    password: process.env.SUPER_ADMIN_PASSWORD || 'superadmin123',
    role: 'SUPER_ADMIN',
    firstName: 'Super',
    lastName: 'Admin',
  })
  await upsertStaff({
    email: process.env.ADMIN_EMAIL || 'admin@123quotes.com',
    password: process.env.ADMIN_PASSWORD || 'admin123',
    role: 'ADMIN',
    firstName: 'Platform',
    lastName: 'Admin',
  })
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
