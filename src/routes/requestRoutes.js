const express = require('express')
const {
  createDraft,
  saveAnswers,
  updateMyRequest,
  submitRequest,
  submitGuestRequest,
  uploadAttachments,
  downloadAttachment,
  myRequests,
  getRequest,
  deleteRequest,
  adminListRequests,
  adminUpdateRequestStatus,
} = require('../controllers/requestController')
const { protect, authorize } = require('../middleware/auth')
const { uploadRequestFiles } = require('../middleware/upload')

const router = express.Router()

function withFiles(handler, { required = false } = {}) {
  return (req, res, next) => {
    const ct = String(req.headers['content-type'] || '')
    if (!ct.includes('multipart/form-data')) {
      if (required) {
        return res.status(400).json({ message: 'multipart/form-data required for file upload' })
      }
      return handler(req, res, next)
    }
    return uploadRequestFiles(req, res, (err) => {
      if (err) {
        return res.status(400).json({ message: err.message || 'Upload failed' })
      }
      return handler(req, res, next)
    })
  }
}

router.post('/guest', withFiles(submitGuestRequest))
router.post('/', protect, authorize('CUSTOMER'), createDraft)
router.get('/mine', protect, authorize('CUSTOMER'), myRequests)
router.get('/admin/all', protect, authorize('ADMIN'), adminListRequests)
router.patch('/admin/:id/status', protect, authorize('ADMIN'), adminUpdateRequestStatus)
router.post(
  '/:id/attachments',
  protect,
  authorize('CUSTOMER'),
  withFiles(uploadAttachments, { required: true }),
)
router.get(
  '/:id/attachments/:attachmentId/download',
  protect,
  downloadAttachment,
)
router.get('/:id', protect, getRequest)
router.put('/:id', protect, authorize('CUSTOMER'), updateMyRequest)
router.delete('/:id', protect, authorize('CUSTOMER'), deleteRequest)
router.put('/:id/answers', protect, authorize('CUSTOMER'), saveAnswers)
router.post('/:id/submit', protect, authorize('CUSTOMER'), submitRequest)

module.exports = router
