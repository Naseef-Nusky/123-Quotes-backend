const prisma = require('../config/db')
const { asyncHandler, ok, fail } = require('../utils/helpers')
const { unlockLead } = require('../services/tokenService')
const { matchProfessionalsForLead } = require('../services/matchingService')
const { logActivity } = require('../services/activityService')

function sanitizeLead(lead, unlocked) {
  const base = {
    id: lead.id,
    status: lead.status,
    summary: lead.summary,
    postcode: lead.postcode,
    city: lead.city,
    tokenCost: lead.tokenCost,
    createdAt: lead.createdAt,
    service: lead.service,
    answers: lead.request?.answers?.map((a) => ({
      question: a.question.label,
      value: a.value,
    })),
  }

  if (!unlocked) {
    return {
      ...base,
      contactLocked: true,
      customer: {
        firstName: lead.request?.customer?.firstName?.[0] + '.',
        city: lead.request?.customer?.city || lead.city,
        postcode: lead.postcode,
      },
    }
  }

  return {
    ...base,
    contactLocked: false,
    customer: {
      firstName: lead.request.customer.firstName,
      lastName: lead.request.customer.lastName,
      email: lead.request.customer.user.email,
      phone: lead.request.customer.phone,
      postcode: lead.request.customer.postcode || lead.postcode,
      address: lead.request.customer.address,
      city: lead.request.customer.city || lead.city,
    },
  }
}

const professionalLeads = asyncHandler(async (req, res) => {
  const proId = req.user.professional?.id
  if (!proId) return fail(res, 'Professional profile required', 403)

  const matches = await prisma.leadMatch.findMany({
    where: { professionalId: proId },
    include: {
      lead: {
        include: {
          service: true,
          unlocks: { where: { professionalId: proId } },
          request: {
            include: {
              customer: { include: { user: true } },
              answers: { include: { question: true } },
            },
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
    lead: sanitizeLead(m.lead, (m.lead.unlocks?.length || 0) > 0 || m.status === 'UNLOCKED'),
  }))

  return ok(res, { leads })
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
          include: {
            customer: { include: { user: true } },
            answers: { include: { question: true } },
          },
        },
      },
    })

    return ok(res, {
      message: result.alreadyUnlocked ? 'Already unlocked' : 'Lead unlocked',
      tokensSpent: result.cost || 0,
      lead: sanitizeLead(lead, true),
    })
  } catch (err) {
    return fail(res, err.message, 400)
  }
})

const adminListLeads = asyncHandler(async (_req, res) => {
  const leads = await prisma.lead.findMany({
    include: {
      service: true,
      request: {
        include: {
          customer: { include: { user: true } },
          answers: { include: { question: true } },
        },
      },
      matches: { include: { professional: true } },
      unlocks: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  return ok(res, { leads })
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
      request: { include: { customer: { include: { user: true } } } },
    },
  })
  if (!lead) return fail(res, 'Lead not found', 404)

  const { firstName, lastName, phone, email, postcode, status, summary } = req.body
  const customer = lead.request?.customer
  const userId = customer?.userId

  try {
    await prisma.$transaction(async (tx) => {
      if (customer) {
        await tx.customerProfile.update({
          where: { id: customer.id },
          data: {
            ...(firstName != null ? { firstName } : {}),
            ...(lastName != null ? { lastName } : {}),
            ...(phone != null ? { phone } : {}),
            ...(postcode != null ? { postcode } : {}),
          },
        })
      }
      if (userId && email) {
        const nextEmail = String(email).toLowerCase().trim()
        if (nextEmail !== customer.user?.email) {
          const taken = await tx.user.findUnique({ where: { email: nextEmail } })
          if (taken) {
            const err = new Error('Email already in use')
            err.status = 409
            throw err
          }
          await tx.user.update({ where: { id: userId }, data: { email: nextEmail } })
        }
      }
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          ...(postcode != null ? { postcode } : {}),
          ...(status ? { status } : {}),
          ...(summary != null ? { summary } : {}),
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
        include: {
          customer: { include: { user: true } },
          answers: { include: { question: true } },
        },
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
  adminListLeads,
  adminDeleteLead,
  adminUpdateLead,
  adminRematch,
}
