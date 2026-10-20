const prisma = require('../config/db')

async function reviewStats(professionalId) {
  const approved = await prisma.review.findMany({
    where: { professionalId, status: 'APPROVED' },
    select: { rating: true },
  })
  const count = approved.length
  const average =
    count > 0 ? Math.round((approved.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10 : null
  return { reviewCount: count, averageRating: average }
}

module.exports = { reviewStats }
