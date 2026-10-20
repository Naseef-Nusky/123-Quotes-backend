const express = require('express')
const {
  createMessage,
  proInbox,
  proSent,
  customerMessages,
  updateStatus,
} = require('../controllers/messageController')
const { protect, authorize } = require('../middleware/auth')

const router = express.Router()

router.post('/', protect, authorize('CUSTOMER', 'PROFESSIONAL'), createMessage)
router.get('/inbox', protect, authorize('PROFESSIONAL'), proInbox)
router.get('/sent', protect, authorize('PROFESSIONAL'), proSent)
router.get('/mine', protect, authorize('CUSTOMER'), customerMessages)
router.patch('/:id/status', protect, authorize('CUSTOMER', 'PROFESSIONAL', 'ADMIN'), updateStatus)

module.exports = router
