const jwt = require('jsonwebtoken')
const prisma = require('../config/db')
const { fail } = require('../utils/helpers')

function signToken(user) {
  const secret = process.env.JWT_SECRET
  if (!secret || secret === 'change_me_to_a_long_random_secret' || secret.length < 16) {
    throw new Error('JWT_SECRET is missing or too weak')
  }
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  )
}

async function protect(req, res, next) {
  try {
    const secret = process.env.JWT_SECRET
    if (!secret || secret === 'change_me_to_a_long_random_secret' || secret.length < 16) {
      return fail(res, 'Server auth misconfigured', 500)
    }

    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) return fail(res, 'Not authorized', 401)

    const decoded = jwt.verify(token, secret)
    const isStaffUser = decoded.role === 'ADMIN' || decoded.role === 'SUPER_ADMIN'

    // Staff CRM calls don't need customer/professional joins (saves remote-DB latency)
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      ...(isStaffUser
        ? {}
        : { include: { customer: true, professional: true } }),
    })

    if (!user || user.status === 'SUSPENDED' || user.status === 'INACTIVE') {
      return fail(res, 'Account not available', 401)
    }

    // Reject tokens issued for a different role than the DB user (tamper / stale)
    if (decoded.role && decoded.role !== user.role) {
      return fail(res, 'Invalid or expired token', 401)
    }

    req.user = user
    return next()
  } catch {
    return fail(res, 'Invalid or expired token', 401)
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return fail(res, 'Forbidden', 403)

    const userRole = req.user.role
    const allowed =
      roles.includes(userRole) ||
      (userRole === 'SUPER_ADMIN' && roles.includes('ADMIN'))

    if (!allowed) return fail(res, 'Forbidden', 403)
    return next()
  }
}

function isStaff(role) {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
}

module.exports = { signToken, protect, authorize, isStaff }
