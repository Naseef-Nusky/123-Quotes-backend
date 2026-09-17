const express = require('express')
const {
  professionalLeads,
  unlock,
  adminListLeads,
  adminRematch,
} = require('../controllers/leadController')
const { protect, authorize } = require('../middleware/auth')

const router = express.Router()

router.get('/mine', protect, authorize('PROFESSIONAL'), professionalLeads)
router.post('/:id/unlock', protect, authorize('PROFESSIONAL'), unlock)
router.get('/admin/all', protect, authorize('ADMIN'), adminListLeads)
router.post('/admin/:id/rematch', protect, authorize('ADMIN'), adminRematch)

module.exports = router
