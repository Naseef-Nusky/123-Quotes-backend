const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  const leads = await prisma.lead.findMany({
    take: 8,
    orderBy: { createdAt: 'desc' },
    include: {
      service: { include: { category: true } },
      matches: {
        include: {
          professional: {
            include: {
              user: { select: { email: true, status: true, emailVerified: true } },
              services: { include: { service: true } },
              serviceAreas: true,
            },
          },
        },
      },
    },
  })

  console.log('Recent leads:', leads.length)
  for (const lead of leads) {
    console.log('---')
    console.log(
      `Lead ${lead.id.slice(0, 8)} | ${lead.service?.name} | cat: ${lead.service?.category?.name} | status: ${lead.status} | matchedCount: ${lead.matchedCount} | match rows: ${lead.matches.length} | postcode: ${lead.postcode}`,
    )
    for (const m of lead.matches) {
      const exact = (m.professional.services || []).some((s) => s.serviceId === lead.serviceId)
      const sameCat = (m.professional.services || []).some(
        (s) => s.service?.categoryId === lead.service?.categoryId,
      )
      console.log(
        `  score=${m.score} exact=${exact} category=${sameCat} | ${m.professional.companyName} | ${m.professional.user?.email}`,
      )
    }
  }

  // Dry-run rematch on newest lead without sending emails by temporarily stubbing? 
  // Instead compute expected matches for newest lead
  const newest = leads[0]
  if (!newest) {
    console.log('No leads to verify')
    return
  }

  const categoryId = newest.service?.categoryId
  const candidates = await prisma.professionalProfile.findMany({
    where: {
      isAvailable: true,
      user: { status: 'ACTIVE', emailVerified: true },
      services: {
        some: categoryId
          ? {
              OR: [
                { serviceId: newest.serviceId },
                { service: { categoryId, isActive: true } },
              ],
            }
          : { serviceId: newest.serviceId },
      },
    },
    include: {
      serviceAreas: true,
      services: { include: { service: true } },
      user: { select: { email: true } },
    },
  })

  function postcodePrefix(postcode = '') {
    return String(postcode).trim().toUpperCase().split(' ')[0].slice(0, 4)
  }
  const leadPrefix = postcodePrefix(newest.postcode)
  let expected = 0
  console.log('\nExpected matches for newest lead (service+category+area rules):')
  for (const pro of candidates) {
    const areas = pro.serviceAreas || []
    let areaOk = areas.length === 0
    if (!areaOk) {
      areaOk = areas.some((area) => {
        if (area.postcode && postcodePrefix(area.postcode) === leadPrefix) return true
        if (area.city && newest.city && area.city.toLowerCase() === newest.city.toLowerCase()) return true
        if (String(area.postcode || '').toUpperCase() === 'NATIONWIDE') return true
        if (String(area.label || '').toLowerCase() === 'nationwide') return true
        return false
      })
    }
    if (!areaOk) {
      console.log(`  SKIP area | ${pro.companyName} | ${pro.user.email}`)
      continue
    }
    const exact = pro.services.some((s) => s.serviceId === newest.serviceId)
    const cat = pro.services.some((s) => s.service?.categoryId === categoryId)
    if (!exact && !cat) continue
    expected += 1
    console.log(`  OK ${exact ? 'SERVICE' : 'CATEGORY'} | ${pro.companyName} | ${pro.user.email}`)
  }

  console.log(`\nStored match rows: ${newest.matches.length} | Expected under new rules: ${expected}`)
  if (newest.matches.length === expected) {
    console.log('OK: stored matches align with service + category + area rules.')
  } else {
    console.log(
      'DIFF: existing lead was matched with older rules. New requests will use category matching. Rematch via admin if needed.',
    )
  }

  // Sanity: every stored match should still be exact or same-category
  let bad = 0
  for (const lead of leads) {
    for (const m of lead.matches) {
      const exact = (m.professional.services || []).some((s) => s.serviceId === lead.serviceId)
      const sameCat = (m.professional.services || []).some(
        (s) => s.service?.categoryId === lead.service?.categoryId,
      )
      if (!exact && !sameCat) {
        bad += 1
        console.log(
          `BAD match on lead ${lead.id.slice(0, 8)}: ${m.professional.companyName} has neither service nor category`,
        )
      }
    }
  }
  if (!bad) console.log('OK: no stored matches outside service/category.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
