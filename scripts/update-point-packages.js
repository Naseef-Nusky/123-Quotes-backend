require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const packages = [
  { name: '100 Tokens', description: '100 tokens to unlock leads', tokens: 100, priceCents: 2500, sortOrder: 1 },
  { name: '200 Tokens', description: '200 tokens – good for regular outreach', tokens: 200, priceCents: 4500, sortOrder: 2 },
  { name: '500 Tokens', description: '500 tokens – best value for active pros', tokens: 500, priceCents: 9900, sortOrder: 3 },
  { name: '1000 Tokens', description: '1000 tokens for high-volume teams', tokens: 1000, priceCents: 17900, sortOrder: 4 },
]

async function main() {
  const existing = await prisma.tokenPackage.findMany({ orderBy: { sortOrder: 'asc' } })
  for (let i = 0; i < packages.length; i++) {
    const next = packages[i]
    const row = existing[i]
    if (row) {
      await prisma.tokenPackage.update({
        where: { id: row.id },
        data: { ...next, currency: 'GBP', isActive: true },
      })
      console.log('updated', row.id, next.name)
    } else {
      await prisma.tokenPackage.create({
        data: { ...next, currency: 'GBP', isActive: true },
      })
      console.log('created', next.name)
    }
  }
  // Deactivate any extras beyond the four packs
  if (existing.length > packages.length) {
    for (const row of existing.slice(packages.length)) {
      await prisma.tokenPackage.update({ where: { id: row.id }, data: { isActive: false } })
      console.log('deactivated', row.name)
    }
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
