const prisma = require('../config/db')
const { asyncHandler, ok, fail } = require('../utils/helpers')
const { reviewStats } = require('../services/reviewService')
const { notifyUser } = require('../services/notificationService')

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
    reviewerName: row.reviewerName || null,
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

/**
 * Customer or professional writes / updates their review for a pro.
 * - Customers: one review per professional (updates their existing one).
 * - Professionals can review other businesses (not their own), one each.
 */
const upsertReview = asyncHandler(async (req, res) => {
  const professionalId = req.params.professionalId || req.body.professionalId
  if (!professionalId) return fail(res, 'professionalId is required')

  const title = String(req.body.title || '').trim()
  const body = String(req.body.body || req.body.review_text || '').trim()
  const rating = Number(req.body.rating ?? req.body.review_star_value)

  if (!title) return fail(res, 'review title is required', 400)
  if (!body) return fail(res, 'review text is required', 400)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return fail(res, 'rating must be an integer from 1 to 5', 400)
  }

  const pro = await prisma.professionalProfile.findUnique({
    where: { id: professionalId },
    select: { id: true },
  })
  if (!pro) return fail(res, 'Professional not found', 404)

  // Work out who is reviewing.
  let reviewerWhere
  let createData
  if (req.user.role === 'PROFESSIONAL') {
    const reviewerPro = req.user.professional
    if (!reviewerPro) return fail(res, 'Professional profile required', 403)
    if (reviewerPro.id === professionalId) {
      return fail(res, "You can't review your own business", 400)
    }
    reviewerWhere = { professionalId, reviewerProfessionalId: reviewerPro.id }
    createData = {
      reviewerProfessionalId: reviewerPro.id,
      reviewerName: reviewerPro.companyName || reviewerPro.contactName || 'Professional',
    }
  } else {
    const customerId = req.user.customer?.id
    if (!customerId) return fail(res, 'Customer profile required', 403)
    reviewerWhere = { professionalId, customerId }
    createData = { customerId }
  }

  const existing = await prisma.review.findFirst({ where: reviewerWhere })
  const include = {
    customer: { select: { firstName: true, lastName: true } },
  }
  const row = existing
    ? await prisma.review.update({
        where: { id: existing.id },
        data: { title, body, rating, status: 'APPROVED', ...createData },
        include,
      })
    : await prisma.review.create({
        data: { professionalId, title, body, rating, status: 'APPROVED', ...createData },
        include,
      })

  // Tell the business about a brand-new review (not on edits).
  if (!existing) {
    const reviewerName =
      createData.reviewerName ||
      [req.user.customer?.firstName, req.user.customer?.lastName].filter(Boolean).join(' ') ||
      'A customer'
    const proUser = await prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: { userId: true },
    })
    notifyUser({
      userId: proUser?.userId,
      type: 'NEW_REVIEW',
      title: 'New review received',
      body: `${reviewerName} rated you ${rating} star${rating === 1 ? '' : 's'}: "${title}"`,
      meta: { link: `/pro/available-pros/${professionalId}` },
    }).catch(() => {})
  }

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
