const express = require('express')
const {
  listPublic,
  getPublic,
  listAll,
  create,
  update,
  remove,
} = require('../controllers/quoteController')
const { protect } = require('../middleware/auth')

const router = express.Router()

router.get('/public', listPublic)
router.get('/public/:id', getPublic)

router.get('/', protect, listAll)
router.post('/', protect, create)
router.put('/:id', protect, update)
router.delete('/:id', protect, remove)

module.exports = router
