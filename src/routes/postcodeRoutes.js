const express = require('express')
const { suggest, validate, list } = require('../controllers/postcodeController')

const router = express.Router()

router.get('/list', list)
router.get('/suggest', suggest)
router.get('/validate', validate)
router.post('/validate', validate)

module.exports = router
