const prisma = require('../config/db')
const { asyncHandler, ok, fail } = require('../utils/helpers')
const { reviewStats } = require('../services/reviewService')

function shapeReview(row) {
  return {
    id: row.id,
    professionalId: row.professionalId,
    customerId: row.customerId,
    title: row.title,
    body: row.body,
    rating: row.rating,
    status: row.status,
    createdAt: row.createdAt,
    customer: row.customer
      ? {
          firstName: row.customer.firstName,
          lastName: row.customer.lastName?.[0] ? `${row.customer.lastName[0]}.` : '',
        }
      : undefined,
  }
}

/** Public: list approved reviews for a professional. */
const listForProfessional = asyncHandler(async (req, res) => {
  const professionalId = req.params.professionalId
  const pro = await prisma.professionalProfile.findUnique({
    where: { id: professionalId },
    select: { id: true },
  })
  if (!pro) return fail(res, 'Professional not found', 404)

  const reviews = await prisma.review.findMany({
    where: { professionalId, status: 'APPROVED' },
    include: {
      customer: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  const stats = await reviewStats(professionalId)
  return ok(res, { reviews: reviews.map(shapeReview), ...stats })
})

/** Customer writes / updates their review for a pro. */
const upsertReview = asyncHandler(async (req, res) => {
  const customerId = req.user.customer?.id
  if (!customerId) return fail(res, 'Customer profile required', 403)

  const professionalId = req.params.professionalId || req.body.professionalId
  if (!professionalId) return fail(res, 'professionalId is required')

  const title = String(req.body.title || '').trim()
  const body = String(req.body.body || req.body.review_text || '').trim()
  const rating = Number(req.body.rating ?? req.body.review_star_value)

  if (!title) return fail(res, 'title is required')
  if (!body) return fail(res, 'review text is required')
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return fail(res, 'rating must be an integer from 1 to 5')
  }

  const pro = await prisma.professionalProfile.findUnique({
    where: { id: professionalId },
    select: { id: true },
  })
  if (!pro) return fail(res, 'Professional not found', 404)

  const row = await prisma.review.upsert({
    where: {
      professionalId_customerId: { professionalId, customerId },
    },
    create: {
      professionalId,
      customerId,
      title,
      body,
      rating,
      status: 'APPROVED',
    },
    update: {
      title,
      body,
      rating,
      status: 'APPROVED',
    },
    include: {
      customer: { select: { firstName: true, lastName: true } },
    },
  })

  const stats = await reviewStats(professionalId)
  return ok(res, { review: shapeReview(row), ...stats }, 201)
})

/** Admin: change review status. */
const adminUpdateStatus = asyncHandler(async (req, res) => {
  const status = req.body.status
  if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
    return fail(res, 'Invalid status')
  }
  const row = await prisma.review.update({
    where: { id: req.params.id },
    data: { status },
    include: {
      customer: { select: { firstName: true, lastName: true } },
    },
  })
  return ok(res, { review: shapeReview(row) })
})

module.exports = {
  listForProfessional,
  upsertReview,
  adminUpdateStatus,
}
