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

  const categoryId = lead.service?.categoryId || null

  // Match exact service OR any service in the same category
  const professionals = await prisma.professionalProfile.findMany({
    where: {
      isAvailable: true,
      user: { status: 'ACTIVE', emailVerified: true },
      services: {
        some: categoryId
          ? {
              OR: [
                { serviceId: lead.serviceId },
                { service: { categoryId, isActive: true } },
              ],
            }
          : { serviceId: lead.serviceId },
      },
    },
    include: {
      serviceAreas: true,
      services: { include: { service: true } },
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
        // Nationwide coverage
        if (String(area.postcode || '').toUpperCase() === 'NATIONWIDE') return true
        if (String(area.label || '').toLowerCase() === 'nationwide') return true
        return false
      })
      if (!areaHit) continue
      score += 30
    }

    const offersExact = (pro.services || []).some((ps) => ps.serviceId === lead.serviceId)
    const offersCategory =
      !offersExact &&
      categoryId &&
      (pro.services || []).some((ps) => ps.service?.categoryId === categoryId)

    if (offersExact) score += 25
    else if (offersCategory) score += 10
    else continue

    matches.push({
      professionalId: pro.id,
      score,
      email: pro.user.email,
      userId: pro.userId,
      matchType: offersExact ? 'service' : 'category',
    })
  }

  matches.sort((a, b) => b.score - a.score)

  const matchedProIds = matches.map((m) => m.professionalId)

  // Drop stale matches that no longer qualify (so pros don't see incorrect leads)
  await prisma.leadMatch.deleteMany({
    where: {
      leadId: lead.id,
      ...(matchedProIds.length
        ? { professionalId: { notIn: matchedProIds } }
        : {}),
    },
  })

  for (const match of matches) {
    const existing = await prisma.leadMatch.findUnique({
      where: {
        leadId_professionalId: {
          leadId: lead.id,
          professionalId: match.professionalId,
        },
      },
    })

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
      // Keep DECLINED / UNLOCKED / VIEWED — only refresh score
      update: { score: match.score },
    })

    // Email only on first match (avoid spam on rematch)
    if (!existing) {
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
  }

  const nextStatus =
    lead.status === 'CLOSED' ||
    lead.status === 'CANCELLED' ||
    lead.status === 'PARTIALLY_UNLOCKED'
      ? lead.status
      : matches.length
        ? 'MATCHED'
        : 'OPEN'

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      matchedCount: matches.length,
      status: nextStatus,
    },
  })

  // Don't downgrade request if already matched/unlocked flow
  const nextRequestStatus = matches.length ? 'MATCHED' : 'SUBMITTED'
  if (lead.request?.status === 'DRAFT' || lead.request?.status === 'SUBMITTED' || lead.request?.status === 'MATCHED') {
    await prisma.customerRequest.update({
      where: { id: lead.requestId },
      data: { status: nextRequestStatus },
    })
  }

  return matches
}

module.exports = { matchProfessionalsForLead, postcodePrefix }
