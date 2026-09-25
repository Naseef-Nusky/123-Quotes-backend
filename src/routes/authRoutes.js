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

const router = express.Router()

router.post('/register/professional', registerProfessional)
router.post('/login', login)
router.post('/login-link', requestLoginLink)
router.post('/login-link/verify', loginWithLink)
router.get('/me', protect, me)
router.post('/verify-email', verifyEmail)
router.post('/forgot-password', forgotPassword)
router.post('/reset-password', resetPassword)

module.exports = router
