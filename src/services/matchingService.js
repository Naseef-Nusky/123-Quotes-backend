const prisma = require('../config/db')
const { sendEmail } = require('./emailService')

function postcodePrefix(postcode = '') {
  return String(postcode).trim().toUpperCase().split(' ')[0].slice(0, 4)
}

async function matchProfessionalsForLead(leadId) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { request: true, service: true },
  })
  if (!lead) throw new Error('Lead not found')

  const professionals = await prisma.professionalProfile.findMany({
    where: {
      isAvailable: true,
      user: { status: 'ACTIVE', emailVerified: true },
      services: { some: { serviceId: lead.serviceId } },
    },
    include: {
      serviceAreas: true,
      user: true,
    },
  })

  const leadPrefix = postcodePrefix(lead.postcode)
  const matches = []

  for (const pro of professionals) {
    let score = 50
    const areas = pro.serviceAreas || []

    if (areas.length === 0) {
      score += 5
    } else {
      const areaHit = areas.some((area) => {
        if (area.postcode && postcodePrefix(area.postcode) === leadPrefix) return true
        if (area.city && lead.city && area.city.toLowerCase() === lead.city.toLowerCase()) return true
        return false
      })
      if (!areaHit) continue
      score += 30
    }

    matches.push({ professionalId: pro.id, score, email: pro.user.email, userId: pro.userId })
  }

  matches.sort((a, b) => b.score - a.score)

  for (const match of matches) {
    await prisma.leadMatch.upsert({
      where: {
        leadId_professionalId: {
          leadId: lead.id,
          professionalId: match.professionalId,
        },
      },
      create: {
        leadId: lead.id,
        professionalId: match.professionalId,
        score: match.score,
        status: 'AVAILABLE',
      },
      update: { score: match.score },
    })

    await sendEmail({
      to: match.email,
      userId: match.userId,
      templateKey: 'new_lead',
      type: 'NEW_LEAD',
      title: 'New matching lead available',
      body: `A new ${lead.service.name} lead is available near ${lead.postcode}.`,
      vars: {
        serviceName: lead.service.name,
        postcode: lead.postcode,
        summary: lead.summary || '',
      },
    })
  }

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      matchedCount: matches.length,
      status: matches.length ? 'MATCHED' : 'OPEN',
    },
  })

  await prisma.customerRequest.update({
    where: { id: lead.requestId },
    data: { status: matches.length ? 'MATCHED' : 'SUBMITTED' },
  })

  return matches
}

module.exports = { matchProfessionalsForLead, postcodePrefix }
