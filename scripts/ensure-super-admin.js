require('dotenv').config()
const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      ALTER TYPE "Role" ADD VALUE 'SUPER_ADMIN';
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `)
  console.log('Role enum ready')

  const roles = await prisma.$queryRawUnsafe(
    `SELECT unnest(enum_range(NULL::"Role"))::text AS role`,
  )
  console.log('Roles:', roles.map((r) => r.role).join(', '))

  const email = process.env.SUPER_ADMIN_EMAIL || 'superadmin@123quotes.com'
  const password = process.env.SUPER_ADMIN_PASSWORD || 'superadmin123'

  let user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        emailVerified: true,
        customer: {
          create: { firstName: 'Super', lastName: 'Admin' },
        },
      },
    })
    console.log('Super admin created:', email)
  } else if (user.role !== 'SUPER_ADMIN') {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { role: 'SUPER_ADMIN', status: 'ACTIVE', emailVerified: true },
    })
    console.log('Promoted to super admin:', email)
  } else {
    console.log('Super admin exists:', email)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
