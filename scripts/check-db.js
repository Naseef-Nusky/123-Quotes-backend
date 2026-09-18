require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  const host = (process.env.DATABASE_URL || '').replace(/:[^:@]+@/, ':****@')
  console.log('DATABASE_URL:', host || '(missing)')

  const rows = await prisma.$queryRaw`SELECT 1::int as ok, current_database() as db, current_user as usr`
  console.log('STATUS: CONNECTED')
  console.log(rows)

  try {
    const users = await prisma.user.count()
    console.log('SCHEMA: OK (User table exists), users =', users)
  } catch (err) {
    console.log('SCHEMA: MISSING or not migrated yet')
    console.log(err.message.split('\n')[0])
  }
}

main()
  .catch((err) => {
    console.error('STATUS: FAILED')
    console.error(err.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
