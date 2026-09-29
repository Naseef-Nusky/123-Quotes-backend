const prisma = require('../config/db')

/**
 * Fully remove a PROFESSIONAL / business account and related admin-visible data.
 * Cascades profile, matches, unlocks, services, areas, notifications, etc.
 */
async function deleteProfessionalAccount(userId) {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    include: { professional: true },
  })
  if (!existing) {
    const err = new Error('User not found')
    err.status = 404
    throw err
  }
  if (existing.role !== 'PROFESSIONAL') {
    const err = new Error('Not a professional account')
    err.status = 400
    throw err
  }

  await prisma.$transaction(async (tx) => {
    // Admin Business Registration + signup applications for this account
    await tx.businessApplication.deleteMany({ where: { userId } })

    // Payments have no onDelete cascade — remove first
    await tx.payment.deleteMany({ where: { userId } })

    // Activity logs keep history but drop the user link
    await tx.activityLog.updateMany({
      where: { userId },
      data: { userId: null },
    })

    await tx.user.delete({ where: { id: userId } })
  })

  return { deleted: true, id: userId, email: existing.email }
}

module.exports = { deleteProfessionalAccount }
