const prisma = require('../config/db')
const { asyncHandler, ok, fail } = require('../utils/helpers')
const { matchProfessionalsForLead } = require('../services/matchingService')
const { sendEmail } = require('../services/emailService')
const { logActivity } = require('../services/activityService')

const createDraft = asyncHandler(async (req, res) => {
  if (!req.user.customer) return fail(res, 'Customer profile required', 403)
  const { serviceId, postcode, city, address, description, title } = req.body
  if (!serviceId || !postcode) return fail(res, 'serviceId and postcode are required')

  const request = await prisma.customerRequest.create({
    data: {
      customerId: req.user.customer.id,
      serviceId,
      postcode,
      city,
      address,
      description,
      title,
      status: 'DRAFT',
    },
  })

  return ok(res, { request }, 201)
})

const saveAnswers = asyncHandler(async (req, res) => {
  const request = await prisma.customerRequest.findUnique({ where: { id: req.params.id } })
  if (!request || request.customerId !== req.user.customer?.id) {
    return fail(res, 'Request not found', 404)
  }
  if (!['DRAFT', 'SUBMITTED'].includes(request.status)) {
    return fail(res, 'Request cannot be edited')
  }

  const answers = Array.isArray(req.body.answers) ? req.body.answers : []
  for (const answer of answers) {
    await prisma.requestAnswer.upsert({
      where: {
        requestId_questionId: {
          requestId: request.id,
          questionId: answer.questionId,
        },
      },
      create: {
        requestId: request.id,
        questionId: answer.questionId,
        value: Array.isArray(answer.value) ? answer.value.join(', ') : String(answer.value ?? ''),
      },
      update: {
        value: Array.isArray(answer.value) ? answer.value.join(', ') : String(answer.value ?? ''),
      },
    })
  }

  const updated = await prisma.customerRequest.findUnique({
    where: { id: request.id },
    include: { answers: { include: { question: true } }, service: true },
  })

  return ok(res, { request: updated })
})

const submitRequest = asyncHandler(async (req, res) => {
  const request = await prisma.customerRequest.findUnique({
    where: { id: req.params.id },
    include: {
      answers: { include: { question: true } },
      service: true,
      customer: { include: { user: true } },
    },
  })

  if (!request || request.customerId !== req.user.customer?.id) {
    return fail(res, 'Request not found', 404)
  }

  const required = await prisma.question.findMany({
    where: { serviceId: request.serviceId, isRequired: true, isActive: true },
  })
  const answeredIds = new Set(request.answers.map((a) => a.questionId))
  const missing = required.filter((q) => !answeredIds.has(q.id))
  if (missing.length) {
    return fail(res, `Missing required answers: ${missing.map((m) => m.label).join(', ')}`)
  }

  const summary = request.answers
    .slice(0, 5)
    .map((a) => `${a.question.label}: ${a.value}`)
    .join(' | ')

  const updated = await prisma.$transaction(async (tx) => {
    const reqRow = await tx.customerRequest.update({
      where: { id: request.id },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        postcode: req.body.postcode || request.postcode,
        city: req.body.city || request.city,
        address: req.body.address || request.address,
        description: req.body.description || request.description,
      },
    })

    const lead = await tx.lead.create({
      data: {
        requestId: reqRow.id,
        serviceId: reqRow.serviceId,
        postcode: reqRow.postcode,
        city: reqRow.city,
        summary,
        tokenCost: request.service.tokenCost,
        status: 'OPEN',
      },
    })

    return { reqRow, lead }
  })

  const matches = await matchProfessionalsForLead(updated.lead.id)

  await sendEmail({
    to: request.customer.user.email,
    userId: request.customer.userId,
    templateKey: 'request_submitted',
    type: 'REQUEST_SUBMITTED',
    title: 'Request submitted',
    body: `Your ${request.service.name} request was submitted successfully.`,
    vars: { serviceName: request.service.name, matchCount: matches.length },
  })

  await logActivity({
    userId: req.user.id,
    action: 'request.submit',
    entityType: 'CustomerRequest',
    entityId: request.id,
    ip: req.ip,
  })

  const full = await prisma.customerRequest.findUnique({
    where: { id: request.id },
    include: {
      service: true,
      answers: { include: { question: true } },
      lead: { include: { matches: true } },
    },
  })

  return ok(res, { request: full, matchCount: matches.length })
})

const myRequests = asyncHandler(async (req, res) => {
  const requests = await prisma.customerRequest.findMany({
    where: { customerId: req.user.customer.id },
    include: {
      service: true,
      lead: {
        include: {
          unlocks: {
            include: {
              professional: { select: { id: true, companyName: true, contactName: true, phone: true } },
            },
          },
          matches: { include: { professional: { select: { id: true, companyName: true, city: true } } } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
  return ok(res, { requests })
})

const getRequest = asyncHandler(async (req, res) => {
  const request = await prisma.customerRequest.findUnique({
    where: { id: req.params.id },
    include: {
      service: true,
      answers: { include: { question: true } },
      lead: {
        include: {
          matches: { include: { professional: { select: { id: true, companyName: true, city: true } } } },
          unlocks: {
            include: { professional: { select: { id: true, companyName: true, contactName: true, phone: true } } },
          },
        },
      },
    },
  })

  if (!request) return fail(res, 'Request not found', 404)
  if (req.user.role === 'CUSTOMER' && request.customerId !== req.user.customer?.id) {
    return fail(res, 'Forbidden', 403)
  }

  return ok(res, { request })
})

const adminListRequests = asyncHandler(async (req, res) => {
  const requests = await prisma.customerRequest.findMany({
    where: req.query.status ? { status: req.query.status } : undefined,
    include: {
      customer: true,
      service: true,
      lead: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  return ok(res, { requests })
})

const adminUpdateRequestStatus = asyncHandler(async (req, res) => {
  const request = await prisma.customerRequest.update({
    where: { id: req.params.id },
    data: { status: req.body.status },
  })
  return ok(res, { request })
})

module.exports = {
  createDraft,
  saveAnswers,
  submitRequest,
  myRequests,
  getRequest,
  adminListRequests,
  adminUpdateRequestStatus,
}
