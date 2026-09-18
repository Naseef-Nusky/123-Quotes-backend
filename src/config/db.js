const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

function maskDatabaseUrl(url = '') {
  return url.replace(/:[^:@/]+@/, ':****@')
}

async function connectDB() {
  const url = process.env.DATABASE_URL || ''
  console.log('Connecting to database...')
  console.log(`DATABASE_URL: ${maskDatabaseUrl(url) || '(missing)'}`)

  try {
    const rows = await prisma.$queryRaw`SELECT 1::int as ok, current_database() as db, current_user as usr`
    const info = rows?.[0] || {}
    console.log('✅ Database connected successfully')
    console.log(`   Host DB: ${info.db || 'unknown'} | User: ${info.usr || 'unknown'}`)
    return true
  } catch (err) {
    console.error('❌ Database connection failed')
    console.error(`   ${err.message}`)
    throw err
  }
}

module.exports = prisma
module.exports.connectDB = connectDB
