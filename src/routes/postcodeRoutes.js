const express = require('express')
const {
  suggest,
  validate,
  list,
  adminList,
  adminCreate,
  adminUpdate,
  adminDelete,
} = require('../controllers/postcodeController')
const { protect, authorize } = require('../middleware/auth')

const router = express.Router()

router.get('/list', list)
router.get('/suggest', suggest)
router.get('/validate', validate)
router.post('/validate', validate)

router.get('/manage', protect, authorize('ADMIN'), adminList)
router.post('/manage', protect, authorize('ADMIN'), adminCreate)
router.put('/manage/:id', protect, authorize('ADMIN'), adminUpdate)
router.delete('/manage/:id', protect, authorize('ADMIN'), adminDelete)

module.exports = router
