const prisma = require('../config/db')
const { asyncHandler, ok, fail } = require('../utils/helpers')
const { notifyUser } = require('../services/notificationService')

function shapeMessage(row) {
  return {
    id: row.id,
    customerId: row.customerId,
    professionalId: row.professionalId,
    senderProfessionalId: row.senderProfessionalId || null,
    senderRole: row.senderRole,
    message: row.message,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    customer: row.customer
      ? {
          id: row.customer.id,
          firstName: row.customer.firstName,
          lastName: row.customer.lastName,
          phone: row.customer.phone,
          email: row.customer.user?.email,
        }
      : undefined,
    professional: row.professional
      ? {
          id: row.professional.id,
          companyName: row.professional.companyName,
          contactName: row.professional.contactName,
          phone: row.professional.phone,
          email: row.professional.user?.email,
        }
      : undefined,
    senderProfessional: row.senderProfessional
      ? {
          id: row.senderProfessional.id,
          companyName: row.senderProfessional.companyName,
          contactName: row.senderProfessional.contactName,
          phone: row.senderProfessional.phone,
          email: row.senderProfessional.user?.email,
        }
      : undefined,
  }
}

const messageInclude = {
  customer: { include: { user: { select: { email: true } } } },
  professional: { include: { user: { select: { email: true } } } },
  senderProfessional: { include: { user: { select: { email: true } } } },
}

/** Customer or professional sends a message in a customer↔pro thread. */
const createMessage = asyncHandler(async (req, res) => {
  const text = String(req.body.message || '').trim()
  if (!text) return fail(res, 'message is required')
  if (text.length > 5000) return fail(res, 'message is too long')

  let customerId = req.body.customerId
  let professionalId = req.body.professionalId
  let senderRole

  if (req.user.role === 'CUSTOMER') {
    if (!req.user.customer?.id) return fail(res, 'Customer profile required', 403)
    customerId = req.user.customer.id
    senderRole = 'CUSTOMER'
    if (!professionalId) return fail(res, 'professionalId is required')
    const pro = await prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: { id: true },
    })
    if (!pro) return fail(res, 'Professional not found', 404)
  } else if (req.user.role === 'PROFESSIONAL') {
    if (!req.user.professional?.id) return fail(res, 'Professional profile required', 403)
    senderRole = 'PROFESSIONAL'

    // Pro → pro (e.g. one-click "Request Quotation" from Available Pros):
    // body names the *target* professional and no customer.
    if (professionalId && !customerId) {
      if (professionalId === req.user.professional.id) {
        return fail(res, "You can't send a request to your own business", 400)
      }
      const target = await prisma.professionalProfile.findUnique({
        where: { id: professionalId },
        select: { id: true, userId: true },
      })
      if (!target) return fail(res, 'Professional not found', 404)

      const row = await prisma.clientMessage.create({
        data: {
          customerId: null,
          professionalId,
          senderProfessionalId: req.user.professional.id,
          senderRole,
          message: text,
          status: 'ACTIVE',
        },
        include: messageInclude,
      })

      notifyUser({
        userId: target.userId,
        type: 'QUOTATION_REQUEST',
        title: 'New quotation request',
        body: `${req.user.professional.companyName || 'A professional'} requested a quotation from you.`,
        meta: { link: '/pro/client-requests' },
      }).catch(() => {})

      return ok(res, { message: shapeMessage(row) }, 201)
    }

    professionalId = req.user.professional.id
    if (!customerId) return fail(res, 'customerId is required')
    const customer = await prisma.customerProfile.findUnique({
      where: { id: customerId },
      select: { id: true },
    })
    if (!customer) return fail(res, 'Customer not found', 404)
  } else {
    return fail(res, 'Only customers and professionals can send messages', 403)
  }

  const row = await prisma.clientMessage.create({
    data: {
      customerId,
      professionalId,
      senderRole,
      message: text,
      status: 'ACTIVE',
    },
    include: messageInclude,
  })

  return ok(res, { message: shapeMessage(row) }, 201)
})

/** Pro inbox: all threads involving this professional (legacy client_requ). */
const proInbox = asyncHandler(async (req, res) => {
  const professionalId = req.user.professional?.id
  if (!professionalId) return fail(res, 'Professional profile required', 403)

  const rows = await prisma.clientMessage.findMany({
    where: {
      professionalId,
      ...(req.query.status ? { status: req.query.status } : { status: 'ACTIVE' }),
    },
    include: messageInclude,
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  return ok(res, { messages: rows.map(shapeMessage) })
})

/** Messages the professional sent. */
const proSent = asyncHandler(async (req, res) => {
  const professionalId = req.user.professional?.id
  if (!professionalId) return fail(res, 'Professional profile required', 403)

  // ONLY messages this professional actually sent:
  // - pro → pro quotation requests (senderProfessionalId = me), or
  // - my messages in customer threads (professionalId = me and I was the sender).
  // Received quotation requests (professionalId = me, sent by another pro) must NOT appear here.
  const rows = await prisma.clientMessage.findMany({
    where: {
      OR: [
        { senderProfessionalId: professionalId },
        { professionalId, senderRole: 'PROFESSIONAL', senderProfessionalId: null },
      ],
      ...(req.query.status ? { status: req.query.status } : {}),
    },
    include: messageInclude,
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  return ok(res, { messages: rows.map(shapeMessage) })
})

/** Customer: my messages with professionals. */
const customerMessages = asyncHandler(async (req, res) => {
  const customerId = req.user.customer?.id
  if (!customerId) return fail(res, 'Customer profile required', 403)

  const rows = await prisma.clientMessage.findMany({
    where: {
      customerId,
      ...(req.query.status ? { status: req.query.status } : { status: 'ACTIVE' }),
      ...(req.query.professionalId ? { professionalId: req.query.professionalId } : {}),
    },
    include: messageInclude,
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  return ok(res, { messages: rows.map(shapeMessage) })
})

const updateStatus = asyncHandler(async (req, res) => {
  const status = req.body.status
  if (!['ACTIVE', 'ARCHIVED', 'CLOSED'].includes(status)) {
    return fail(res, 'Invalid status')
  }

  const existing = await prisma.clientMessage.findUnique({ where: { id: req.params.id } })
  if (!existing) return fail(res, 'Message not found', 404)

  const isCustomer = req.user.role === 'CUSTOMER' && existing.customerId === req.user.customer?.id
  const isPro =
    req.user.role === 'PROFESSIONAL' &&
    (existing.professionalId === req.user.professional?.id ||
      existing.senderProfessionalId === req.user.professional?.id)
  const isAdmin = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN'
  if (!isCustomer && !isPro && !isAdmin) return fail(res, 'Forbidden', 403)

  const row = await prisma.clientMessage.update({
    where: { id: existing.id },
    data: { status },
    include: messageInclude,
  })

  return ok(res, { message: shapeMessage(row) })
})

module.exports = {
  createMessage,
  proInbox,
  proSent,
  customerMessages,
  updateStatus,
}
