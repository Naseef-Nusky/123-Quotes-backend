const express = require('express')
const {
  registerCustomer,
  registerProfessional,
  login,
  me,
  verifyEmail,
  forgotPassword,
  resetPassword,
} = require('../controllers/authController')
const { protect } = require('../middleware/auth')

const router = express.Router()

router.post('/register/customer', registerCustomer)
router.post('/register/professional', registerProfessional)
router.post('/login', login)
router.get('/me', protect, me)
router.post('/verify-email', verifyEmail)
router.post('/forgot-password', forgotPassword)
router.post('/reset-password', resetPassword)

module.exports = router
