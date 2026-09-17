const jwt = require('jsonwebtoken')
const User = require('../models/User')

async function protect(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Not authorized' })
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(decoded.id).select('-password')

    if (!user) {
      return res.status(401).json({ message: 'User not found' })
    }

    req.user = user
    return next()
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
}

module.exports = { protect }
