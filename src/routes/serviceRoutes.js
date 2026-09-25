const express = require('express')
const {
  listCategories,
  listServices,
  getService,
  adminListServices,
  adminUpsertCategory,
  adminUpsertService,
  adminDeleteCategory,
  adminDeleteService,
} = require('../controllers/serviceController')
const { protect, authorize } = require('../middleware/auth')

const router = express.Router()

router.get('/categories', listCategories)
router.get('/', listServices)

router.get('/manage/all', protect, authorize('ADMIN'), adminListServices)
router.post('/manage/categories', protect, authorize('ADMIN'), adminUpsertCategory)
router.put('/manage/categories/:id', protect, authorize('ADMIN'), (req, res, next) => {
  req.body.id = req.params.id
  return adminUpsertCategory(req, res, next)
})
router.delete('/manage/categories/:id', protect, authorize('ADMIN'), adminDeleteCategory)
router.post('/manage', protect, authorize('ADMIN'), adminUpsertService)
router.put('/manage/:id', protect, authorize('ADMIN'), (req, res, next) => {
  req.body.id = req.params.id
  return adminUpsertService(req, res, next)
})
router.delete('/manage/:id', protect, authorize('ADMIN'), adminDeleteService)

router.get('/:idOrSlug', getService)

module.exports = router
