const prisma = require('../config/db')
const { asyncHandler, ok, fail } = require('../utils/helpers')
const { unlockLead } = require('../services/tokenService')
const { matchProfessionalsForLead } = require('../services/matchingService')
const { logActivity } = require('../services/activityService')
const {
  getMaxUnlocksPerLead,
  getUnlockTokenTiers,
  costFromUnlockTiers,
  getLeadCustomUnlockTiers,
} = require('../utils/leadPricing')
const { formatAnswerValue } = require('../utils/formatAnswer')
const { publicAttachmentShape } = require('../services/attachmentService')

function sanitizeLead(lead, unlocked, extras = {}) {
  const unlockedCount = lead.unlockedCount || 0
  const leadTiers = getLeadCustomUnlockTiers(lead)
  const tiers =
    leadTiers ||
    extras.tiers ||
    [{ fromViews: 0, toViews: null, tokenCost: lead.tokenCost || 1, afterViews: 0 }]
  const currentUnlockCost = costFromUnlockTiers(unlockedCount, tiers)
  const attachmentRows = lead.request?.attachments || []
  const base = {
    id: lead.id,
    status: lead.status,
    summary: lead.summary,
    postcode: lead.postcode,
    city: lead.city,
    tokenCost: currentUnlockCost,
    baseTokenCost: lead.tokenCost,
    unlockedCount,
    matchedCount: lead.matchedCount || lead.matches?.length || 0,
    maxUnlocks: extras.maxUnlocks ?? null,
    unlockTiers: tiers,
    hasCustomUnlockTiers: Boolean(leadTiers),
    createdAt: lead.createdAt,
    service: lead.service,
    answers: lead.request?.answers?.map((a) => ({
      question: a.question?.label || 'Question',
      value: formatAnswerValue(a.value, a.question?.options || []),
      rawValue: a.value,
    })),
    attachmentCount: attachmentRows.length,
  }

  if (!unlocked) {
    return {
      ...base,
      contactLocked: true,
      attachments: [],
      customer: {
        firstName: lead.request?.customer?.firstName?.[0] + '.',
        city: lead.request?.customer?.city || lead.city,
        postcode: lead.postcode,
      },
    }
  }

  const customer = lead.request?.customer
  const contactName = String(lead.request?.contactName || '').trim()
  const contactEmail = lead.request?.contactEmail || customer?.user?.email || null
  const contactPhone = lead.request?.contactPhone || customer?.phone || null
  const nameParts = contactName ? contactName.split(/\s+/) : []
  return {
    ...base,
    contactLocked: false,
    attachments: attachmentRows.map(publicAttachmentShape),
    customer: {
      firstName: customer?.firstName || nameParts[0] || 'Legacy',
      lastName: customer?.lastName || nameParts.slice(1).join(' ') || 'Lead',
      email: contactEmail,
      phone: contactPhone,
      postcode: customer?.postcode || lead.postcode,
      address: customer?.address || null,
      city: customer?.city || lead.city,
      legacyUserId: lead.request?.legacyUserId ?? null,
    },
  }
}

const requestIncludeForLead = {
  customer: { include: { user: true } },
  answers: { include: { question: { include: { options: true } } } },
  attachments: { orderBy: { createdAt: 'asc' } },
}

const professionalLeads = asyncHandler(async (req, res) => {
  const proId = req.user.professional?.id
  if (!proId) return fail(res, 'Professional profile required', 403)

  const maxUnlocks = await getMaxUnlocksPerLead()
  const tiers = await getUnlockTokenTiers()
  const matches = await prisma.leadMatch.findMany({
    where: {
      professionalId: proId,
      status: { notIn: ['DECLINED', 'EXPIRED'] },
    },
    include: {
      lead: {
        include: {
          service: true,
          unlocks: { where: { professionalId: proId } },
          request: {
            include: requestIncludeForLead,
          },
        },
      },
    },
    orderBy: { matchedAt: 'desc' },
  })

  const leads = matches.map((m) => ({
    matchId: m.id,
    matchStatus: m.status,
    score: m.score,
    lead: sanitizeLead(m.lead, (m.lead.unlocks?.length || 0) > 0 || m.status === 'UNLOCKED', {
      maxUnlocks,
      tiers,
    }),
  }))

  return ok(res, { leads, maxUnlocksPerLead: maxUnlocks, unlockTokenTiers: tiers })
})

const unlock = asyncHandler(async (req, res) => {
  const proId = req.user.professional?.id
  if (!proId) return fail(res, 'Professional profile required', 403)

  try {
    const result = await unlockLead({ leadId: req.params.id, professionalId: proId })
    await logActivity({
      userId: req.user.id,
      action: 'lead.unlock',
      entityType: 'Lead',
      entityId: req.params.id,
      ip: req.ip,
    })

    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: {
        service: true,
        request: {
          include: requestIncludeForLead,
        },
      },
    })

    const [maxUnlocks, tiers] = await Promise.all([getMaxUnlocksPerLead(), getUnlockTokenTiers()])
    return ok(res, {
      message: result.alreadyUnlocked ? 'Already unlocked' : 'Lead unlocked',
      tokensSpent: result.cost || 0,
      lead: sanitizeLead(lead, true, { maxUnlocks, tiers }),
    })
  } catch (err) {
    return fail(res, err.message, 400)
  }
})

const decline = asyncHandler(async (req, res) => {
  const proId = req.user.professional?.id
  if (!proId) return fail(res, 'Professional profile required', 403)

  const match = await prisma.leadMatch.findUnique({
    where: {
      leadId_professionalId: { leadId: req.params.id, professionalId: proId },
    },
  })
  if (!match) return fail(res, 'Lead is not matched to this professional', 404)
  if (match.status === 'DECLINED') {
    return ok(res, { message: 'Lead already declined', match })
  }
  if (match.status === 'UNLOCKED') {
    return fail(res, 'Cannot decline a lead you have already unlocked', 400)
  }

  const unlock = await prisma.leadUnlock.findUnique({
    where: { leadId_professionalId: { leadId: req.params.id, professionalId: proId } },
  })
  if (unlock) {
    return fail(res, 'Cannot decline a lead you have already unlocked', 400)
  }

  const updated = await prisma.leadMatch.update({
    where: { id: match.id },
    data: { status: 'DECLINED' },
  })

  await logActivity({
    userId: req.user.id,
    action: 'lead.decline',
    entityType: 'Lead',
    entityId: req.params.id,
    ip: req.ip,
  })

  return ok(res, { message: 'Lead declined', match: updated })
})

function outcodeFromPostcode(postcode) {
  const clean = String(postcode || '').replace(/\s+/g, '').toUpperCase()
  if (!clean || clean === 'UK' || clean.length < 2) return null
  // Full postcode: drop the 3-char incode; already an outcode: keep as-is.
  const candidate = clean.length > 3 ? clean.slice(0, -3) : clean
  return /^[A-Z]{1,2}\d[A-Z\d]?$/.test(candidate) ? candidate : candidate || null
}

const adminListLeads = asyncHandler(async (_req, res) => {
  const leads = await prisma.lead.findMany({
    include: {
      service: true,
      request: {
        include: requestIncludeForLead,
      },
      matches: { include: { professional: true } },
      unlocks: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  // Enrich with old-DB postal_codes data (district/ward/Country/lat/lng),
  // aggregated per outcode in UkOutcode: town=district, region=ward.
  const outcodes = [
    ...new Set(leads.map((l) => outcodeFromPostcode(l.postcode)).filter(Boolean)),
  ]
  const outcodeRows = outcodes.length
    ? await prisma.ukOutcode.findMany({ where: { outcode: { in: outcodes } } })
    : []
  const byOutcode = new Map(outcodeRows.map((r) => [r.outcode, r]))

  const enriched = leads.map((lead) => {
    const outcode = outcodeFromPostcode(lead.postcode)
    const info = outcode ? byOutcode.get(outcode) : null
    return {
      ...lead,
      postcodeInfo: info
        ? {
            outcode: info.outcode,
            fullPostcode: lead.postcode || null,
            district: info.town || null,
            ward: info.region || null,
            country: info.country || null,
          }
        : outcode
          ? { outcode, fullPostcode: lead.postcode || null }
          : null,
    }
  })

  return ok(res, { leads: enriched })
})

const adminDeleteLead = asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } })
  if (!lead) return fail(res, 'Lead not found', 404)
  await prisma.customerRequest.delete({ where: { id: lead.requestId } })
  return ok(res, { deleted: true, id: req.params.id })
})

const adminUpdateLead = asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id },
    include: {
      request: {
        include: requestIncludeForLead,
      },
    },
  })
  if (!lead) return fail(res, 'Lead not found', 404)

  const { firstName, lastName, phone, email, postcode, status, summary, answers, tokenCost, unlockTiers } =
    req.body
  let customer = lead.request?.customer
  let userId = customer?.userId

  try {
    await prisma.$transaction(async (tx) => {
      const nextEmail = email != null ? String(email).toLowerCase().trim() : ''
      const nextPhone = phone != null ? String(phone).trim() : ''
      const nextFirst = firstName != null ? String(firstName).trim() : ''
      const nextLast = lastName != null ? String(lastName).trim() : ''

      // Create customer account when lead has no linked user but admin provides contact
      if (!customer && nextEmail && nextEmail.includes('@')) {
        const taken = await tx.user.findUnique({
          where: { email_role: { email: nextEmail, role: 'CUSTOMER' } },
          include: { customer: true },
        })
        if (taken?.customer) {
          customer = taken.customer
          userId = taken.id
          await tx.customerRequest.update({
            where: { id: lead.requestId },
            data: { customerId: customer.id },
          })
        } else if (!taken) {
          const bcrypt = require('bcryptjs')
          const created = await tx.user.create({
            data: {
              email: nextEmail,
              passwordHash: await bcrypt.hash(require('crypto').randomBytes(16).toString('hex'), 8),
              role: 'CUSTOMER',
              status: 'ACTIVE',
              emailVerified: true,
              customer: {
                create: {
                  firstName: nextFirst || 'Lead',
                  lastName: nextLast || 'Contact',
                  phone: nextPhone || null,
                  postcode: postcode != null ? String(postcode).trim() : lead.postcode,
                },
              },
            },
            include: { customer: true },
          })
          customer = created.customer
          userId = created.id
          await tx.customerRequest.update({
            where: { id: lead.requestId },
            data: { customerId: customer.id },
          })
        }
      }

      if (customer) {
        await tx.customerProfile.update({
          where: { id: customer.id },
          data: {
            ...(firstName != null ? { firstName: nextFirst || customer.firstName } : {}),
            ...(lastName != null ? { lastName: nextLast || customer.lastName } : {}),
            ...(phone != null ? { phone: nextPhone || null } : {}),
            ...(postcode != null ? { postcode: String(postcode).trim() } : {}),
          },
        })
      }
      if (userId && nextEmail) {
        const currentEmail = customer?.user?.email
        if (nextEmail !== currentEmail) {
          const taken = await tx.user.findUnique({
            where: { email_role: { email: nextEmail, role: 'CUSTOMER' } },
          })
          if (taken && taken.id !== userId) {
            const err = new Error('Email already in use')
            err.status = 409
            throw err
          }
          await tx.user.update({ where: { id: userId }, data: { email: nextEmail } })
        }
      }

      // Keep denormalized contact on the request for list/detail views
      if (lead.requestId) {
        await tx.customerRequest.update({
          where: { id: lead.requestId },
          data: {
            ...(firstName != null || lastName != null
              ? {
                  contactName: `${nextFirst || customer?.firstName || ''} ${nextLast || customer?.lastName || ''}`.trim() || null,
                }
              : {}),
            ...(email != null ? { contactEmail: nextEmail || null } : {}),
            ...(phone != null ? { contactPhone: nextPhone || null } : {}),
          },
        })
      }

      if (Array.isArray(answers) && lead.requestId) {
        for (const answer of answers) {
          if (!answer?.questionId) continue
          const value = Array.isArray(answer.value)
            ? answer.value.join(', ')
            : String(answer.value ?? '')
          await tx.requestAnswer.upsert({
            where: {
              requestId_questionId: {
                requestId: lead.requestId,
                questionId: answer.questionId,
              },
            },
            create: {
              requestId: lead.requestId,
              questionId: answer.questionId,
              value,
            },
            update: { value },
          })
        }
      }

      let nextSummary = summary
      if (Array.isArray(answers) && answers.length) {
        const questionIds = answers.map((a) => a.questionId).filter(Boolean)
        const questions = questionIds.length
          ? await tx.question.findMany({
              where: { id: { in: questionIds } },
              include: { options: true },
            })
          : []
        const byId = new Map(questions.map((q) => [q.id, q]))
        nextSummary = answers
          .map((a) => formatAnswerValue(a.value, byId.get(a.questionId)?.options || []))
          .filter(Boolean)
          .join(' / ')
      }

      await tx.lead.update({
        where: { id: lead.id },
        data: {
          ...(postcode != null ? { postcode } : {}),
          ...(status ? { status } : {}),
          ...(nextSummary != null ? { summary: nextSummary } : {}),
          ...(tokenCost != null && Number(tokenCost) > 0
            ? { tokenCost: Math.floor(Number(tokenCost)) }
            : {}),
          ...(unlockTiers !== undefined
            ? {
                unlockTiers:
                  unlockTiers === null
                    ? null
                    : Array.isArray(unlockTiers) && unlockTiers.length
                      ? unlockTiers
                      : null,
              }
            : {}),
        },
      })
      if (postcode != null && lead.requestId) {
        await tx.customerRequest.update({
          where: { id: lead.requestId },
          data: { postcode },
        })
      }
    })
  } catch (err) {
    return fail(res, err.message || 'Update failed', err.status || 400)
  }

  const updated = await prisma.lead.findUnique({
    where: { id: lead.id },
    include: {
      service: true,
      request: {
        include: requestIncludeForLead,
      },
      matches: { include: { professional: true } },
      unlocks: true,
    },
  })

  return ok(res, { lead: updated })
})

const adminRematch = asyncHandler(async (req, res) => {
  const matches = await matchProfessionalsForLead(req.params.id)
  return ok(res, { matchCount: matches.length, matches })
})

module.exports = {
  professionalLeads,
  unlock,
  decline,
  adminListLeads,
  adminDeleteLead,
  adminUpdateLead,
  adminRematch,
}
