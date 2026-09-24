const express = require('express')
const {
  createDraft,
  saveAnswers,
  submitRequest,
  submitGuestRequest,
  myRequests,
  getRequest,
  adminListRequests,
  adminUpdateRequestStatus,
} = require('../controllers/requestController')
const { protect, authorize } = require('../middleware/auth')

const router = express.Router()

router.post('/guest', submitGuestRequest)
router.post('/', protect, authorize('CUSTOMER'), createDraft)
router.get('/mine', protect, authorize('CUSTOMER'), myRequests)
router.get('/admin/all', protect, authorize('ADMIN'), adminListRequests)
router.patch('/admin/:id/status', protect, authorize('ADMIN'), adminUpdateRequestStatus)
router.get('/:id', protect, getRequest)
router.put('/:id/answers', protect, authorize('CUSTOMER'), saveAnswers)
router.post('/:id/submit', protect, authorize('CUSTOMER'), submitRequest)

module.exports = router
