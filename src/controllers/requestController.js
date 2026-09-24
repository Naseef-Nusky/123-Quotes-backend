const prisma = require('../config/db')
const bcrypt = require('bcryptjs')
const { randomToken } = require('../utils/crypto')
const { asyncHandler, ok, fail } = require('../utils/helpers')
const { matchProfessionalsForLead } = require('../services/matchingService')
const { sendEmail } = require('../services/emailService')
const { logActivity } = require('../services/activityService')

async function upsertAnswers(requestId, answers) {
  const list = Array.isArray(answers) ? answers : []
  for (const answer of list) {
    if (!answer?.questionId) continue
    await prisma.requestAnswer.upsert({
      where: {
        requestId_questionId: {
          requestId,
          questionId: answer.questionId,
        },
      },
      create: {
        requestId,
        questionId: answer.questionId,
        value: Array.isArray(answer.value) ? answer.value.join(', ') : String(answer.value ?? ''),
      },
      update: {
        value: Array.isArray(answer.value) ? answer.value.join(', ') : String(answer.value ?? ''),
      },
    })
  }
}

async function finalizeRequest({ requestId, customerUserId, body = {}, ip, isNewAccount = false }) {
  const request = await prisma.customerRequest.findUnique({
    where: { id: requestId },
    include: {
      answers: { include: { question: true } },
      service: true,
      customer: { include: { user: true } },
    },
  })
  if (!request) return { error: 'Request not found', status: 404 }
  if (request.status !== 'DRAFT') {
    return { error: 'This request was already submitted', status: 400 }
  }

  const required = await prisma.question.findMany({
    where: { serviceId: request.serviceId, isRequired: true, isActive: true },
  })
  const answeredIds = new Set(request.answers.map((a) => a.questionId))
  const missing = required.filter((q) => !answeredIds.has(q.id))
  if (missing.length) {
    return {
      error: `Missing required answers: ${missing.map((m) => m.label).join(', ')}`,
      status: 400,
    }
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
        postcode: body.postcode || request.postcode,
        city: body.city || request.city,
        address: body.address || request.address,
        description: body.description || request.description,
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

  const customerName = [request.customer.firstName, request.customer.lastName]
    .filter(Boolean)
    .join(' ')
    .trim() || 'there'
  const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
  const matchCountLabel =
    matches.length === 1 ? '1 professional' : `${matches.length} professionals`

  let loginUrl = `${appUrl}/login`
  let setPasswordUrl = loginUrl
  let accountHeading = 'Your 123Quotes Account'
  let accountBody =
    'You can manage this request and any future requests from your dashboard. Click the button below to log in:'
  let ctaLabel = 'Log in to 123Quotes'
  let ctaUrl = loginUrl

  if (isNewAccount) {
    const setPasswordToken = randomToken()
    await prisma.user.update({
      where: { id: request.customer.userId },
      data: {
        resetToken: setPasswordToken,
        resetTokenExpiry: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
        emailVerified: true,
        status: 'ACTIVE',
      },
    })
    setPasswordUrl = `${appUrl}/set-password?token=${setPasswordToken}`
    loginUrl = setPasswordUrl
    ctaUrl = setPasswordUrl
    accountHeading = 'Your Free 123Quotes Account'
    accountBody =
      'We have created an account for you so that you can better manage this request as well as any future requests you may wish to place. Simply click the button below to log in:'
    ctaLabel = 'Log in to 123Quotes'
  }

  await sendEmail({
    to: request.customer.user.email,
    userId: request.customer.userId,
    templateKey: 'request_submitted',
    type: 'REQUEST_SUBMITTED',
    title: isNewAccount ? 'Welcome to 123Quotes' : 'Your request was submitted',
    body: `We've received your ${request.service.name} request.`,
    vars: {
      customerName,
      serviceName: request.service.name,
      matchCount: matches.length,
      matchCountLabel,
      loginUrl,
      setPasswordUrl,
      accountHeading,
      accountBody,
      ctaLabel,
      ctaUrl,
    },
  })

  await logActivity({
    userId: customerUserId || request.customer.userId,
    action: 'request.submit',
    entityType: 'CustomerRequest',
    entityId: request.id,
    ip,
  })

  const full = await prisma.customerRequest.findUnique({
    where: { id: request.id },
    include: {
      service: true,
      answers: { include: { question: true } },
      lead: { include: { matches: true } },
    },
  })

  return { request: full, matchCount: matches.length }
}

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

  await upsertAnswers(request.id, req.body.answers)

  const updated = await prisma.customerRequest.findUnique({
    where: { id: request.id },
    include: { answers: { include: { question: true } }, service: true },
  })

  return ok(res, { request: updated })
})

const submitRequest = asyncHandler(async (req, res) => {
  const request = await prisma.customerRequest.findUnique({
    where: { id: req.params.id },
    select: { id: true, customerId: true },
  })

  if (!request || request.customerId !== req.user.customer?.id) {
    return fail(res, 'Request not found', 404)
  }

  const result = await finalizeRequest({
    requestId: request.id,
    customerUserId: req.user.id,
    body: req.body,
    ip: req.ip,
  })
  if (result.error) return fail(res, result.error, result.status || 400)
  return ok(res, { request: result.request, matchCount: result.matchCount })
})

/** Public: questionnaire finalize creates the customer account + request (no separate signup). */
const submitGuestRequest = asyncHandler(async (req, res) => {
  const {
    email,
    firstName,
    lastName,
    phone,
    serviceId,
    postcode,
    city,
    address,
    description,
    title,
    answers,
  } = req.body

  if (!email || !firstName || !lastName) {
    return fail(res, 'firstName, lastName and email are required')
  }
  if (!serviceId || !postcode) return fail(res, 'serviceId and postcode are required')

  const emailNorm = String(email).trim().toLowerCase()
  const exists = await prisma.user.findUnique({ where: { email: emailNorm } })
  if (exists) {
    return fail(
      res,
      'An account with this email already exists. Please log in to submit another request.',
      409,
    )
  }

  const service = await prisma.service.findFirst({
    where: { id: serviceId, isActive: true },
  })
  if (!service) return fail(res, 'Service not found', 404)

  const placeholderHash = await bcrypt.hash(randomToken(24), 10)
  const setPasswordToken = randomToken()

  const user = await prisma.user.create({
    data: {
      email: emailNorm,
      passwordHash: placeholderHash,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerified: true,
      resetToken: setPasswordToken,
      resetTokenExpiry: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      customer: {
        create: {
          firstName: String(firstName).trim(),
          lastName: String(lastName).trim(),
          phone: phone ? String(phone).trim() : null,
          postcode: String(postcode).trim(),
          city: city ? String(city).trim() : null,
          address: address ? String(address).trim() : null,
        },
      },
    },
    include: { customer: true },
  })

  const request = await prisma.customerRequest.create({
    data: {
      customerId: user.customer.id,
      serviceId,
      postcode: String(postcode).trim(),
      city: city ? String(city).trim() : null,
      address: address ? String(address).trim() : null,
      description: description || null,
      title: title || null,
      status: 'DRAFT',
    },
  })

  await upsertAnswers(request.id, answers)

  const result = await finalizeRequest({
    requestId: request.id,
    customerUserId: user.id,
    body: { postcode, city, address, description },
    ip: req.ip,
    isNewAccount: true,
  })

  if (result.error) {
    return fail(res, result.error, result.status || 400)
  }

  await logActivity({ userId: user.id, action: 'customer.register.from_request', ip: req.ip })

  return ok(
    res,
    {
      message:
        'Request submitted. Check your email to set your password and access your dashboard.',
      request: result.request,
      matchCount: result.matchCount,
    },
    201,
  )
})

const myRequests = asyncHandler(async (req, res) => {
  const requests = await prisma.customerRequest.findMany({
    where: { customerId: req.user.customer.id },
    include: {
      service: true,
      answers: { include: { question: true } },
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
  submitGuestRequest,
  myRequests,
  getRequest,
  adminListRequests,
  adminUpdateRequestStatus,
}
