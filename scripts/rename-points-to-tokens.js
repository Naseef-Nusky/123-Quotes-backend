require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const PACKAGES = [
  {
    tokens: 100,
    name: '100 Tokens',
    description: '100 tokens to unlock leads',
    priceCents: 2500,
    sortOrder: 1,
  },
  {
    tokens: 200,
    name: '200 Tokens',
    description: '200 tokens – good for regular outreach',
    priceCents: 4500,
    sortOrder: 2,
  },
  {
    tokens: 500,
    name: '500 Tokens',
    description: '500 tokens – best value for active pros',
    priceCents: 9900,
    sortOrder: 3,
  },
  {
    tokens: 1000,
    name: '1000 Tokens',
    description: '1000 tokens for high-volume teams',
    priceCents: 17900,
    sortOrder: 4,
  },
]

async function main() {
  for (const pkg of PACKAGES) {
    const existing = await prisma.tokenPackage.findFirst({
      where: {
        OR: [{ tokens: pkg.tokens }, { name: { contains: String(pkg.tokens), mode: 'insensitive' } }],
      },
      orderBy: { sortOrder: 'asc' },
    })

    if (existing) {
      await prisma.tokenPackage.update({
        where: { id: existing.id },
        data: {
          name: pkg.name,
          description: pkg.description,
          tokens: pkg.tokens,
          priceCents: pkg.priceCents,
          sortOrder: pkg.sortOrder,
          isActive: true,
        },
      })
      console.log('updated', existing.id, '->', pkg.name)
    } else {
      await prisma.tokenPackage.create({
        data: {
          ...pkg,
          currency: 'GBP',
          isActive: true,
        },
      })
      console.log('created', pkg.name)
    }
  }

  // Rename any leftover "Points" packages
  const leftovers = await prisma.tokenPackage.findMany({
    where: { name: { contains: 'Point', mode: 'insensitive' } },
  })
  for (const row of leftovers) {
    const name = row.name.replace(/Points?/gi, 'Tokens').replace(/points?/gi, 'tokens')
    const description = String(row.description || '')
      .replace(/Points?/gi, 'Tokens')
      .replace(/points?/gi, 'tokens')
    await prisma.tokenPackage.update({
      where: { id: row.id },
      data: { name, description: description || null },
    })
    console.log('renamed leftover', row.name, '->', name)
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
