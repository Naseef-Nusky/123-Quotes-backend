const express = require('express')
const { createPublic, listAll, update, remove } = require('../controllers/leadController')
const { protect } = require('../middleware/auth')

const router = express.Router()

router.post('/', createPublic)
router.get('/', protect, listAll)
router.put('/:id', protect, update)
router.delete('/:id', protect, remove)

module.exports = router
