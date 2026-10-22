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

/** Same stats for many professionals in ONE grouped query (directory lists). */
async function reviewStatsForMany(professionalIds) {
  const stats = new Map(
    professionalIds.map((id) => [id, { reviewCount: 0, averageRating: null }]),
  )
  if (!professionalIds.length) return stats
  const rows = await prisma.review.groupBy({
    by: ['professionalId'],
    where: { professionalId: { in: professionalIds }, status: 'APPROVED' },
    _count: { _all: true },
    _avg: { rating: true },
  })
  for (const row of rows) {
    stats.set(row.professionalId, {
      reviewCount: row._count._all,
      averageRating:
        row._avg.rating != null ? Math.round(row._avg.rating * 10) / 10 : null,
    })
  }
  return stats
}

module.exports = { reviewStats, reviewStatsForMany }
