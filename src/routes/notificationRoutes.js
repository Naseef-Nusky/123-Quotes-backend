const express = require('express')
const { protect } = require('../middleware/auth')
const {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require('../controllers/adminController')

const router = express.Router()

// Any logged-in user (customer / professional) can read their own notifications.
router.get('/', protect, listNotifications)
router.patch('/read-all', protect, markAllNotificationsRead)
router.patch('/:id/read', protect, markNotificationRead)

module.exports = router
