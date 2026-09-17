const prisma = require('../config/db')

async function logActivity({ userId, action, entityType, entityId, ip, meta }) {
  try {
    await prisma.activityLog.create({
      data: {
        userId: userId || null,
        action,
        entityType: entityType || null,
        entityId: entityId || null,
        ip: ip || null,
        meta: meta || undefined,
      },
    })
  } catch (err) {
    console.error('Activity log failed:', err.message)
  }
}

module.exports = { logActivity }
