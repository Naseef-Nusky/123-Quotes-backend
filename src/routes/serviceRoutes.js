const express = require('express')
const {
  listCategories,
  listServices,
  getService,
  adminListCategories,
  adminListServices,
  adminUpsertCategory,
  adminUpsertService,
  adminUploadServiceImage,
  adminUploadCategoryImage,
  adminDeleteCategory,
  adminDeleteService,
} = require('../controllers/serviceController')
const { protect, authorize } = require('../middleware/auth')
const { uploadServiceImage } = require('../middleware/upload')

const router = express.Router()

function withImageUpload(handler) {
  return (req, res, next) => {
    uploadServiceImage(req, res, (err) => {
      if (err) return res.status(400).json({ message: err.message || 'Upload failed' })
      return handler(req, res, next)
    })
  }
}

router.get('/categories', listCategories)
router.get('/', listServices)

router.get('/manage/all', protect, authorize('ADMIN'), adminListServices)
router.get('/manage/categories', protect, authorize('ADMIN'), adminListCategories)
router.post('/manage/categories', protect, authorize('ADMIN'), adminUpsertCategory)
router.put('/manage/categories/:id', protect, authorize('ADMIN'), (req, res, next) => {
  req.body.id = req.params.id
  return adminUpsertCategory(req, res, next)
})
router.delete('/manage/categories/:id', protect, authorize('ADMIN'), adminDeleteCategory)
router.post(
  '/manage/categories/:id/image',
  protect,
  authorize('ADMIN'),
  withImageUpload(adminUploadCategoryImage),
)
router.post('/manage', protect, authorize('ADMIN'), adminUpsertService)
router.put('/manage/:id', protect, authorize('ADMIN'), (req, res, next) => {
  req.body.id = req.params.id
  return adminUpsertService(req, res, next)
})
router.post(
  '/manage/:id/image',
  protect,
  authorize('ADMIN'),
  withImageUpload(adminUploadServiceImage),
)
router.delete('/manage/:id', protect, authorize('ADMIN'), adminDeleteService)

router.get('/:idOrSlug', getService)

module.exports = router
