const { PrismaClient } = require('@prisma/client')
const { matchProfessionalsForLead } = require('../src/services/matchingService')

const prisma = new PrismaClient()

async function main() {
  const leads = await prisma.lead.findMany({
    where: { status: { in: ['OPEN', 'MATCHED', 'PARTIALLY_UNLOCKED'] } },
    select: { id: true, status: true, postcode: true, service: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  })

  console.log('Rematching', leads.length, 'active leads…')
  for (const lead of leads) {
    const matches = await matchProfessionalsForLead(lead.id)
    console.log(
      `${lead.id.slice(0, 8)} | ${lead.service?.name} | ${lead.postcode} | ${lead.status} -> ${matches.length} matches`,
      matches.map((m) => `${m.matchType}:${m.score}`).join(', ') || '(none)',
    )
  }

  // Re-check bad matches
  const all = await prisma.leadMatch.findMany({
    include: {
      lead: { include: { service: true } },
      professional: { include: { services: { include: { service: true } } } },
    },
  })
  let bad = 0
  for (const m of all) {
    const exact = m.professional.services.some((s) => s.serviceId === m.lead.serviceId)
    const cat = m.professional.services.some(
      (s) => s.service?.categoryId === m.lead.service?.categoryId,
    )
    if (!exact && !cat) {
      bad += 1
      console.log('STILL BAD', m.lead.id.slice(0, 8), m.professionalId.slice(0, 8))
    }
  }
  console.log(bad ? `Remaining bad matches: ${bad}` : 'OK: all stored matches are service or category valid.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
