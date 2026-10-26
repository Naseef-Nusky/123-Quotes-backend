const fs = require('fs')
const prisma = require('../config/db')
const bcrypt = require('bcryptjs')
const { randomToken } = require('../utils/crypto')
const { asyncHandler, ok, fail } = require('../utils/helpers')
const { matchProfessionalsForLead } = require('../services/matchingService')
const { sendEmail } = require('../services/emailService')
const { notifyAdmins } = require('../services/notificationService')
const { logActivity } = require('../services/activityService')
const {
  getDefaultUnlockTokenCost,
  resolveLeadTokenCost,
} = require('../utils/leadPricing')
const { formatAnswerValue } = require('../utils/formatAnswer')
const {
  saveRequestAttachments,
  absolutePathFor,
  publicAttachmentShape,
} = require('../services/attachmentService')

function parseAnswersField(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function mapAttachments(list = []) {
  return list.map(publicAttachmentShape)
}

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

async function finalizeRequest({
  requestId,
  customerUserId,
  body = {},
  ip,
  isNewAccount = false,
  needsPasswordSetup = false,
}) {
  const request = await prisma.customerRequest.findUnique({
    where: { id: requestId },
    include: {
      answers: { include: { question: { include: { options: true } } } },
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
    .map((a) => `${a.question.label}: ${formatAnswerValue(a.value, a.question?.options || [])}`)
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

    const defaultCost = await getDefaultUnlockTokenCost()
    const tokenCost = resolveLeadTokenCost({
      serviceTokenCost: request.service.tokenCost,
      defaultCost,
    })

    const lead = await tx.lead.create({
      data: {
        requestId: reqRow.id,
        serviceId: reqRow.serviceId,
        postcode: reqRow.postcode,
        city: reqRow.city,
        summary,
        tokenCost,
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

  // CRM badge: admins get a "new lead" notification (Recent Leads tab count).
  notifyAdmins({
    title: 'New lead received',
    body: `${request.service.name} request from ${
      customerName !== 'there' ? customerName : request.customer.user.email
    }${updated.reqRow.postcode ? ` (${updated.reqRow.postcode})` : ''}. ${matches.length} professional${
      matches.length === 1 ? '' : 's'
    } matched.`,
    meta: {
      kind: 'new_lead',
      requestId: request.id,
      leadId: updated.lead.id,
      serviceName: request.service.name,
    },
  }).catch(() => {})
  const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
  const matchCountLabel =
    matches.length === 1 ? '1 professional' : `${matches.length} professionals`

  let loginUrl = `${appUrl}/login`
  let setPasswordUrl = loginUrl
  let accountHeading = 'Your 123Quotes Account'
  let accountBody =
    'You can manage this request and any future requests from your dashboard. Click the button below to log in with a one-time link:'
  let ctaLabel = 'Log in to 123Quotes'
  let ctaUrl = loginUrl

  if (isNewAccount || needsPasswordSetup) {
    // New / password-not-set accounts → set-password link (7 days)
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
    setPasswordUrl = `${appUrl}/set-password?token=${encodeURIComponent(setPasswordToken)}`
    loginUrl = setPasswordUrl
    ctaUrl = setPasswordUrl
    if (isNewAccount) {
      accountHeading = 'Your Free 123Quotes Account'
      accountBody =
        'We have created an account for you so that you can better manage this request as well as any future requests you may wish to place. Simply click the button below to set your password and log in:'
      ctaLabel = 'Set your password'
    } else {
      accountHeading = 'Set Your 123Quotes Password'
      accountBody =
        'You already have an account with us, but you have not set a password yet. Click the button below to set your password so you can log in and manage this request:'
      ctaLabel = 'Set your password'
    }
  } else {
    // Password already set → one-click magic login link (30 minutes)
    const loginToken = `login_${randomToken()}`
    await prisma.user.update({
      where: { id: request.customer.userId },
      data: {
        resetToken: loginToken,
        resetTokenExpiry: new Date(Date.now() + 1000 * 60 * 30),
        emailVerified: true,
        status: 'ACTIVE',
      },
    })
    loginUrl = `${appUrl}/login?token=${encodeURIComponent(loginToken)}`
    setPasswordUrl = loginUrl
    ctaUrl = loginUrl
    accountHeading = 'Your 123Quotes Account'
    accountBody =
      'You can manage this request and any future requests from your dashboard. Click the button below to log in instantly (this link expires in 30 minutes):'
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
      attachments: { orderBy: { createdAt: 'asc' } },
      lead: { include: { matches: true } },
    },
  })

  return {
    request: full
      ? { ...full, attachments: mapAttachments(full.attachments || []) }
      : full,
    matchCount: matches.length,
  }
}

const createDraft = asyncHandler(async (req, res) => {
  if (req.user?.role && req.user.role !== 'CUSTOMER') {
    return fail(
      res,
      'Business accounts cannot create customer requests. Please use Customer Login.',
      403,
    )
  }
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

/** Customer: edit request details. Service type cannot be changed. */
const updateMyRequest = asyncHandler(async (req, res) => {
  const request = await prisma.customerRequest.findUnique({
    where: { id: req.params.id },
    include: {
      answers: { include: { question: true } },
      lead: { select: { id: true } },
    },
  })
  if (!request || request.customerId !== req.user.customer?.id) {
    return fail(res, 'Request not found', 404)
  }
  if (!['DRAFT', 'SUBMITTED'].includes(request.status)) {
    return fail(res, 'This request can no longer be edited', 400)
  }

  // Service is locked once the request exists
  if (req.body.serviceId && req.body.serviceId !== request.serviceId) {
    return fail(res, 'Requested service cannot be changed', 400)
  }

  const { postcode, city, address, description, answers } = req.body
  const data = {}
  if (postcode != null) {
    const next = String(postcode).trim()
    if (!next) return fail(res, 'postcode is required')
    data.postcode = next
  }
  if (city !== undefined) data.city = city ? String(city).trim() : null
  if (address !== undefined) data.address = address ? String(address).trim() : null
  if (description !== undefined) data.description = description ? String(description).trim() : null

  if (Array.isArray(answers)) {
    await upsertAnswers(request.id, answers)
  }

  await prisma.customerRequest.update({
    where: { id: request.id },
    data,
  })

  if (request.lead?.id) {
    const refreshed = await prisma.customerRequest.findUnique({
      where: { id: request.id },
      include: { answers: { include: { question: { include: { options: true } } } } },
    })
    const summary = (refreshed?.answers || [])
      .map((a) => formatAnswerValue(a.value, a.question?.options || []))
      .filter(Boolean)
      .join(' / ')
    await prisma.lead.update({
      where: { id: request.lead.id },
      data: {
        ...(data.postcode != null ? { postcode: data.postcode } : {}),
        ...(summary ? { summary } : {}),
      },
    })
  }

  const updated = await prisma.customerRequest.findUnique({
    where: { id: request.id },
    include: {
      service: true,
      answers: { include: { question: { include: { options: true } } } },
      lead: {
        include: {
          matches: {
            include: { professional: { select: { id: true, companyName: true, city: true } } },
          },
          unlocks: {
            include: {
              professional: {
                select: { id: true, companyName: true, contactName: true, phone: true },
              },
            },
          },
        },
      },
    },
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

/** Public: questionnaire finalize creates a request, reusing an existing customer account when the email already exists. */
const submitGuestRequest = asyncHandler(async (req, res) => {
  const email = req.body.email
  const firstName = req.body.firstName
  const lastName = req.body.lastName
  const phone = req.body.phone
  const serviceId = req.body.serviceId
  const postcode = req.body.postcode
  const city = req.body.city
  const address = req.body.address
  const description = req.body.description
  const title = req.body.title
  const answers = parseAnswersField(req.body.answers)

  if (!email || !firstName || !lastName) {
    return fail(res, 'firstName, lastName and email are required')
  }
  if (!serviceId || !postcode) return fail(res, 'serviceId and postcode are required')

  const emailNorm = String(email).trim().toLowerCase()
  const service = await prisma.service.findFirst({
    where: { id: serviceId, isActive: true },
  })
  if (!service) return fail(res, 'Service not found', 404)

  // Returning customers can submit without logging in again. Their request is
  // attached to the existing customer profile instead of creating a duplicate.
  let user = await prisma.user.findUnique({
    where: { email_role: { email: emailNorm, role: 'CUSTOMER' } },
    include: { customer: true },
  })
  const isExistingAccount = Boolean(user)

  if (user && user.status !== 'ACTIVE') {
    return fail(res, 'This customer account is not active. Please contact support.', 403)
  }

  if (!user) {
    const placeholderHash = await bcrypt.hash(randomToken(24), 10)
    const setPasswordToken = randomToken()

    user = await prisma.user.create({
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
  } else if (!user.customer) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
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
  } else {
    // Keep the saved profile identity/details; only fill fields that were blank.
    const profileUpdates = {}
    if (!user.customer.phone && phone) profileUpdates.phone = String(phone).trim()
    if (!user.customer.postcode && postcode) profileUpdates.postcode = String(postcode).trim()
    if (!user.customer.city && city) profileUpdates.city = String(city).trim()
    if (!user.customer.address && address) profileUpdates.address = String(address).trim()

    if (Object.keys(profileUpdates).length) {
      user.customer = await prisma.customerProfile.update({
        where: { id: user.customer.id },
        data: profileUpdates,
      })
    }
  }

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

  if (req.files?.length) {
    await saveRequestAttachments(request.id, req.files)
  }

  // Guest-created accounts hold a pending set-password token until the
  // customer chooses a password. If it was never set, the confirmation
  // email's button must go to set-password instead of the login page.
  const needsPasswordSetup =
    isExistingAccount &&
    Boolean(user.resetToken) &&
    !String(user.resetToken).startsWith('login_')

  const result = await finalizeRequest({
    requestId: request.id,
    customerUserId: user.id,
    body: { postcode, city, address, description },
    ip: req.ip,
    isNewAccount: !isExistingAccount,
    needsPasswordSetup,
  })

  if (result.error) {
    return fail(res, result.error, result.status || 400)
  }

  await logActivity({
    userId: user.id,
    action: isExistingAccount
      ? 'request.submit.guest_existing_account'
      : 'customer.register.from_request',
    ip: req.ip,
  })

  return ok(
    res,
    {
      message: isExistingAccount
        ? needsPasswordSetup
          ? 'Request submitted to your existing 123Quotes account. Check your email to set your password and view your matches.'
          : 'Request submitted to your existing 123Quotes account. Check your email for confirmation and log in anytime to view your matches.'
        : 'Request submitted. Check your email to set your password and access your dashboard.',
      existingAccount: isExistingAccount,
      needsPasswordSetup,
      request: result.request,
      matchCount: result.matchCount,
    },
    201,
  )
})

const uploadAttachments = asyncHandler(async (req, res) => {
  const request = await prisma.customerRequest.findUnique({
    where: { id: req.params.id },
    select: { id: true, customerId: true, status: true },
  })
  if (!request || request.customerId !== req.user.customer?.id) {
    return fail(res, 'Request not found', 404)
  }
  if (!['DRAFT', 'SUBMITTED'].includes(request.status)) {
    return fail(res, 'Attachments can no longer be added to this request', 400)
  }
  if (!req.files?.length) return fail(res, 'No files uploaded')

  try {
    const created = await saveRequestAttachments(request.id, req.files)
    return ok(res, { attachments: mapAttachments(created) }, 201)
  } catch (err) {
    return fail(res, err.message, err.status || 400)
  }
})

async function canAccessAttachment(user, requestId) {
  const request = await prisma.customerRequest.findUnique({
    where: { id: requestId },
    include: {
      lead: {
        include: {
          unlocks: true,
        },
      },
    },
  })
  if (!request) return { ok: false, status: 404, message: 'Request not found' }

  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') return { ok: true, request }
  if (user.role === 'CUSTOMER' && request.customerId === user.customer?.id) {
    return { ok: true, request }
  }
  if (user.role === 'PROFESSIONAL' && user.professional?.id && request.lead) {
    const unlocked = request.lead.unlocks.some((u) => u.professionalId === user.professional.id)
    if (unlocked) return { ok: true, request }
    return { ok: false, status: 403, message: 'Unlock this lead to download attachments' }
  }
  return { ok: false, status: 403, message: 'Forbidden' }
}

const downloadAttachment = asyncHandler(async (req, res) => {
  const access = await canAccessAttachment(req.user, req.params.id)
  if (!access.ok) return fail(res, access.message, access.status)

  const attachment = await prisma.requestAttachment.findFirst({
    where: { id: req.params.attachmentId, requestId: req.params.id },
  })
  if (!attachment) return fail(res, 'Attachment not found', 404)

  const abs = absolutePathFor(attachment)
  if (!fs.existsSync(abs)) return fail(res, 'File missing on server', 404)

  res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream')
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${encodeURIComponent(attachment.originalName)}"`,
  )
  return fs.createReadStream(abs).pipe(res)
})

const myRequests = asyncHandler(async (req, res) => {
  const requests = await prisma.customerRequest.findMany({
    where: { customerId: req.user.customer.id },
    include: {
      service: true,
      answers: { include: { question: { include: { options: true } } } },
      attachments: { orderBy: { createdAt: 'asc' } },
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
  const formatted = requests.map((r) => ({
    ...r,
    attachments: mapAttachments(r.attachments || []),
    answers: (r.answers || []).map((a) => ({
      ...a,
      displayValue: formatAnswerValue(a.value, a.question?.options || []),
      value: formatAnswerValue(a.value, a.question?.options || []),
      rawValue: a.value,
    })),
  }))
  return ok(res, { requests: formatted })
})

const getRequest = asyncHandler(async (req, res) => {
  const request = await prisma.customerRequest.findUnique({
    where: { id: req.params.id },
    include: {
      service: true,
      answers: { include: { question: { include: { options: true } } } },
      attachments: { orderBy: { createdAt: 'asc' } },
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

  const formatted = {
    ...request,
    attachments: mapAttachments(request.attachments || []),
    answers: (request.answers || []).map((a) => ({
      ...a,
      displayValue: formatAnswerValue(a.value, a.question?.options || []),
      value: formatAnswerValue(a.value, a.question?.options || []),
      rawValue: a.value,
    })),
  }

  return ok(res, { request: formatted })
})

const adminListRequests = asyncHandler(async (req, res) => {
  const requests = await prisma.customerRequest.findMany({
    where: req.query.status ? { status: req.query.status } : undefined,
    include: {
      customer: { include: { user: { select: { email: true } } } },
      service: true,
      lead: true,
      answers: { include: { question: { include: { options: true } } } },
      attachments: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return ok(res, {
    requests: requests.map((r) => ({
      ...r,
      attachments: mapAttachments(r.attachments || []),
      answers: (r.answers || []).map((a) => ({
        ...a,
        displayValue: formatAnswerValue(a.value, a.question?.options || []),
        value: formatAnswerValue(a.value, a.question?.options || []),
        rawValue: a.value,
      })),
    })),
  })
})

const adminUpdateRequestStatus = asyncHandler(async (req, res) => {
  const request = await prisma.customerRequest.update({
    where: { id: req.params.id },
    data: { status: req.body.status },
  })
  return ok(res, { request })
})

const deleteRequest = asyncHandler(async (req, res) => {
  const request = await prisma.customerRequest.findUnique({
    where: { id: req.params.id },
    select: { id: true, customerId: true },
  })
  if (!request) return fail(res, 'Request not found', 404)
  if (!req.user.customer?.id || request.customerId !== req.user.customer.id) {
    return fail(res, 'Forbidden', 403)
  }

  await prisma.customerRequest.delete({ where: { id: request.id } })
  return ok(res, { deleted: true, id: request.id })
})

module.exports = {
  createDraft,
  saveAnswers,
  updateMyRequest,
  submitRequest,
  submitGuestRequest,
  uploadAttachments,
  downloadAttachment,
  myRequests,
  getRequest,
  deleteRequest,
  adminListRequests,
  adminUpdateRequestStatus,
}
