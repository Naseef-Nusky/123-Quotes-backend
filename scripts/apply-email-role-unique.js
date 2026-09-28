require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS "User_email_key"')
  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "User_email_role_key" ON "User"("email", "role")',
  )
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User"("email")')
  console.log('email+role unique indexes applied')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
