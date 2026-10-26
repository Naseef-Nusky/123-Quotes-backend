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

/**
 * Delete every customer-owned request (and cascaded leads / answers /
 * attachments / matches / unlocks) for a customer profile id.
 */
async function deleteCustomerOwnedData(tx, customerId) {
  if (!customerId) return { requests: 0 }

  // Lead + matches/unlocks cascade from CustomerRequest.delete
  const requests = await tx.customerRequest.deleteMany({ where: { customerId } })
  await tx.clientMessage.deleteMany({ where: { customerId } })
  await tx.review.deleteMany({ where: { customerId } })

  return { requests: requests.count }
}

/**
 * Fully remove a CUSTOMER account AND all related details:
 * requests, leads, answers, attachments, matches, unlocks, messages, reviews.
 */
async function deleteCustomerAccount(userId) {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    include: { customer: true },
  })
  if (!existing) {
    const err = new Error('User not found')
    err.status = 404
    throw err
  }
  if (existing.role !== 'CUSTOMER') {
    const err = new Error('Not a customer account')
    err.status = 400
    throw err
  }

  let deletedRequests = 0

  await prisma.$transaction(async (tx) => {
    if (existing.customer?.id) {
      const owned = await deleteCustomerOwnedData(tx, existing.customer.id)
      deletedRequests = owned.requests
    }

    // Also remove orphan requests that only match by denormalized contact email
    // (legacy imports sometimes left customerId null).
    if (existing.email) {
      const orphan = await tx.customerRequest.deleteMany({
        where: {
          customerId: null,
          contactEmail: { equals: existing.email, mode: 'insensitive' },
        },
      })
      deletedRequests += orphan.count
    }

    await tx.payment.deleteMany({ where: { userId } })

    await tx.activityLog.updateMany({
      where: { userId },
      data: { userId: null },
    })

    // Profile + notifications cascade with the user row
    await tx.user.delete({ where: { id: userId } })
  })

  return {
    deleted: true,
    id: userId,
    email: existing.email,
    deletedRequests,
  }
}

module.exports = {
  deleteProfessionalAccount,
  deleteCustomerAccount,
  deleteCustomerOwnedData,
}
