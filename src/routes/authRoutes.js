const express = require('express')
const {
  registerProfessional,
  login,
  me,
  verifyEmail,
  forgotPassword,
  requestLoginLink,
  loginWithLink,
  resetPassword,
} = require('../controllers/authController')
const { protect } = require('../middleware/auth')
const { createRateLimiter } = require('../middleware/rateLimit')

const router = express.Router()

const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many auth attempts. Please try again in a few minutes.',
})
const strictAuthLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 12,
  message: 'Too many attempts. Please try again later.',
})

router.post('/register/professional', authLimiter, registerProfessional)
router.post('/login', strictAuthLimiter, login)
router.post('/login-link', strictAuthLimiter, requestLoginLink)
router.post('/login-link/verify', strictAuthLimiter, loginWithLink)
router.get('/me', protect, me)
router.post('/verify-email', authLimiter, verifyEmail)
router.post('/forgot-password', strictAuthLimiter, forgotPassword)
router.post('/reset-password', strictAuthLimiter, resetPassword)

module.exports = router
