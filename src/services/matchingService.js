const prisma = require('../config/db')
const { sendEmail } = require('./emailService')
const { formatLeadAnswersForEmail } = require('../utils/formatAnswer')

/** Outward code from a full or partial UK postcode (e.g. SW1A 1AA → SW1A). */
function extractOutcode(input = '') {
  const cleaned = String(input || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
  if (!cleaned) return ''
  const parts = cleaned.split(' ')
  if (parts.length >= 2) return parts[0]
  if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(cleaned)) {
    return cleaned.slice(0, -3)
  }
  return cleaned
}

function postcodePrefix(postcode = '') {
  return extractOutcode(postcode).slice(0, 4)
}

/** Legacy import junk that looks like a postcode but is not a real area. */
function isJunkAreaToken(value = '') {
  const v = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
  return !v || v === 'withina' || v === 'nwithina' || v === 'null' || v === 'undefined'
}

function isRealServiceArea(area) {
  const pc = String(area?.postcode || '').trim()
  const city = String(area?.city || '').trim()
  if (pc && !isJunkAreaToken(pc)) return true
  if (city && !isJunkAreaToken(city)) return true
  return false
}

function isNationwideArea(area) {
  const pc = String(area?.postcode || '').trim().toUpperCase()
  return pc === 'NATIONWIDE' || pc === 'UK' || String(area?.label || '').toLowerCase() === 'nationwide'
}

function milesBetween(a, b) {
  if (
    !a ||
    !b ||
    a.latitude == null ||
    a.longitude == null ||
    b.latitude == null ||
    b.longitude == null
  ) {
    return Number.POSITIVE_INFINITY
  }
  const R = 3958.8
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

async function loadCoordsByOutcode(outcodes) {
  const list = [
    ...new Set(
      (outcodes || [])
        .map((o) => String(o || '').trim().toUpperCase())
        .filter(Boolean),
    ),
  ]
  if (!list.length) return new Map()
  const rows = await prisma.ukOutcode.findMany({
    where: { outcode: { in: list } },
    select: { outcode: true, latitude: true, longitude: true },
  })
  return new Map(rows.map((r) => [r.outcode, r]))
}

/**
 * Area score bonus, or null if this pro does not cover the lead.
 * Matches: Nationwide, same outcode, same city, or within travel radius (miles).
 */
function areaScoreForLead(serviceAreas, lead, coordsByOutcode = new Map()) {
  const areas = (serviceAreas || []).filter(isRealServiceArea)
  if (areas.length === 0) return 5

  const leadOutcode = extractOutcode(lead.postcode)
  const leadCoords = leadOutcode ? coordsByOutcode.get(leadOutcode) : null

  const hit = areas.some((area) => {
    if (isNationwideArea(area)) return true

    const areaOutcode = extractOutcode(area.postcode)
    if (areaOutcode && leadOutcode && areaOutcode === leadOutcode) return true

    if (area.city && lead.city && area.city.toLowerCase() === lead.city.toLowerCase()) {
      return true
    }

    const radius = Number(area.radiusMiles)
    if (Number.isFinite(radius) && radius > 0 && areaOutcode && leadCoords) {
      const areaCoords = coordsByOutcode.get(areaOutcode)
      if (areaCoords && milesBetween(areaCoords, leadCoords) <= radius) return true
    }

    return false
  })

  return hit ? 30 : null
}

function scoreProForLead(pro, lead, coordsByOutcode = new Map()) {
  const areaBonus = areaScoreForLead(pro.serviceAreas, lead, coordsByOutcode)
  if (areaBonus == null) return null

  const categoryId = lead.service?.categoryId || null
  const offersExact = (pro.services || []).some((ps) => ps.serviceId === lead.serviceId)
  const offersCategory =
    !offersExact &&
    categoryId &&
    (pro.services || []).some((ps) => ps.service?.categoryId === categoryId)

  if (!offersExact && !offersCategory) return null

  return {
    score: 50 + areaBonus + (offersExact ? 25 : 10),
    matchType: offersExact ? 'service' : 'category',
  }
}

function collectOutcodesFromAreasAndLeads(serviceAreas, leads) {
  const outcodes = []
  for (const area of serviceAreas || []) {
    if (isNationwideArea(area) || !isRealServiceArea(area)) continue
    const oc = extractOutcode(area.postcode)
    if (oc) outcodes.push(oc)
  }
  for (const lead of leads || []) {
    const oc = extractOutcode(lead.postcode)
    if (oc) outcodes.push(oc)
  }
  return outcodes
}

/**
 * Rebuild AVAILABLE lead matches for one professional from their current
 * services + areas (e.g. after Settings save). Keeps UNLOCKED / DECLINED.
 */
async function rematchLeadsForProfessional(professionalId, { notify = false } = {}) {
  const pro = await prisma.professionalProfile.findUnique({
    where: { id: professionalId },
    include: {
      serviceAreas: true,
      services: { include: { service: true } },
      user: true,
    },
  })
  if (!pro) throw new Error('Professional not found')

  const canReceive =
    pro.isAvailable && pro.user?.status === 'ACTIVE' && pro.user?.emailVerified

  const leads = await prisma.lead.findMany({
    where: { status: { notIn: ['CLOSED', 'CANCELLED'] } },
    select: {
      id: true,
      serviceId: true,
      postcode: true,
      city: true,
      service: { select: { id: true, name: true, categoryId: true } },
    },
  })

  const coordsByOutcode = await loadCoordsByOutcode(
    collectOutcodesFromAreasAndLeads(pro.serviceAreas, leads),
  )

  const qualifying = []
  if (canReceive) {
    for (const lead of leads) {
      const scored = scoreProForLead(pro, lead, coordsByOutcode)
      if (!scored) continue
      qualifying.push({ leadId: lead.id, score: scored.score })
    }
  }

  const qualifyIds = new Set(qualifying.map((q) => q.leadId))

  await prisma.leadMatch.deleteMany({
    where: {
      professionalId,
      status: { in: ['AVAILABLE', 'VIEWED'] },
      ...(qualifyIds.size ? { leadId: { notIn: [...qualifyIds] } } : {}),
    },
  })

  if (!qualifying.length) {
    return { matched: 0, created: 0, removedStale: true }
  }

  const existing = await prisma.leadMatch.findMany({
    where: { professionalId, leadId: { in: [...qualifyIds] } },
    select: { leadId: true },
  })
  const existingIds = new Set(existing.map((m) => m.leadId))

  const createBatch = qualifying
    .filter((q) => !existingIds.has(q.leadId))
    .map((q) => ({
      leadId: q.leadId,
      professionalId,
      score: q.score,
      status: 'AVAILABLE',
    }))

  let created = 0
  for (let i = 0; i < createBatch.length; i += 500) {
    const chunk = createBatch.slice(i, i + 500)
    const result = await prisma.leadMatch.createMany({
      data: chunk,
      skipDuplicates: true,
    })
    created += result.count
  }

  if (notify && created) {
    await sendEmail({
      to: pro.user.email,
      userId: pro.userId,
      templateKey: 'new_lead',
      type: 'NEW_LEAD',
      title: 'Your lead matches were updated',
      body: `${created} lead(s) now match your services and areas.`,
      vars: { serviceName: 'your services', postcode: '', summary: '' },
    })
  }

  return { matched: qualifyIds.size, created }
}

async function matchProfessionalsForLead(leadId, { notify = true } = {}) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      service: true,
      request: {
        include: {
          answers: {
            include: { question: { include: { options: true } } },
          },
        },
      },
    },
  })
  if (!lead) throw new Error('Lead not found')

  const sortedAnswers = [...(lead.request?.answers || [])].sort(
    (a, b) => (a.question?.sortOrder ?? 0) - (b.question?.sortOrder ?? 0),
  )
  const { answersHtml, answersText } = formatLeadAnswersForEmail(sortedAnswers)
  // Fallback if a lead has summary text but no structured answers
  const answersBlockHtml =
    answersHtml ||
    (lead.summary
      ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#222222;">${String(lead.summary)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')}</p>`
      : '<p style="margin:0 0 16px;font-size:14px;color:#64748b;">No questionnaire answers were provided.</p>')
  const answersBlockText = answersText || lead.summary || 'No questionnaire answers were provided.'

  const categoryId = lead.service?.categoryId || null

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

  const coordsByOutcode = await loadCoordsByOutcode(
    collectOutcodesFromAreasAndLeads(
      professionals.flatMap((p) => p.serviceAreas || []),
      [lead],
    ),
  )

  const matches = []
  for (const pro of professionals) {
    const scored = scoreProForLead(pro, lead, coordsByOutcode)
    if (!scored) continue
    matches.push({
      professionalId: pro.id,
      score: scored.score,
      email: pro.user.email,
      userId: pro.userId,
      matchType: scored.matchType,
    })
  }

  matches.sort((a, b) => b.score - a.score)
  const matchedProIds = matches.map((m) => m.professionalId)

  await prisma.leadMatch.deleteMany({
    where: {
      leadId: lead.id,
      ...(matchedProIds.length ? { professionalId: { notIn: matchedProIds } } : {}),
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
      update: { score: match.score },
    })

    if (!existing && notify) {
      await sendEmail({
        to: match.email,
        userId: match.userId,
        templateKey: 'new_lead',
        type: 'NEW_LEAD',
        title: 'New matching lead available',
        body: `A new ${lead.service.name} lead is available near ${lead.postcode}.`,
        vars: {
          serviceName: lead.service.name,
          postcode: lead.postcode || '',
          summary: lead.summary || '',
          answersHtml: answersBlockHtml,
          answersText: answersBlockText,
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

  const nextRequestStatus = matches.length ? 'MATCHED' : 'SUBMITTED'
  if (
    lead.request?.status === 'DRAFT' ||
    lead.request?.status === 'SUBMITTED' ||
    lead.request?.status === 'MATCHED'
  ) {
    await prisma.customerRequest.update({
      where: { id: lead.requestId },
      data: { status: nextRequestStatus },
    })
  }

  return matches
}

module.exports = {
  matchProfessionalsForLead,
  rematchLeadsForProfessional,
  postcodePrefix,
  extractOutcode,
  isRealServiceArea,
}
