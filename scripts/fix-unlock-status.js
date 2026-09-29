const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const leads = await prisma.lead.findMany({
    where: { status: { in: ['OPEN', 'MATCHED', 'PARTIALLY_UNLOCKED'] } },
    include: { _count: { select: { unlocks: true } } },
  })
  for (const lead of leads) {
    if (lead._count.unlocks > 0 && lead.status !== 'PARTIALLY_UNLOCKED' && lead.status !== 'CLOSED') {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { status: 'PARTIALLY_UNLOCKED' },
      })
      console.log('Restored PARTIALLY_UNLOCKED', lead.id.slice(0, 8), 'unlocks=', lead._count.unlocks)
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
