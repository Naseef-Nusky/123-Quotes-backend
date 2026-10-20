const express = require('express')
const {
  listForProfessional,
  upsertReview,
  adminUpdateStatus,
} = require('../controllers/reviewController')
const { protect, authorize } = require('../middleware/auth')

const router = express.Router()

router.get('/professional/:professionalId', listForProfessional)
router.post(
  '/professional/:professionalId',
  protect,
  authorize('CUSTOMER'),
  upsertReview,
)
router.patch('/:id/status', protect, authorize('ADMIN'), adminUpdateStatus)

module.exports = router
