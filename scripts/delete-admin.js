require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  const email = 'admin@123quotes.com'
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    console.log('Account not found:', email)
    return
  }
  await prisma.user.delete({ where: { id: user.id } })
  console.log('Deleted:', email, user.role)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
