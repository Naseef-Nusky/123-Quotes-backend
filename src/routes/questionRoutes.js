const express = require('express')
const {
  getQuestionnaire,
  adminListQuestions,
  adminCreateQuestion,
  adminUpdateQuestion,
  adminDeleteQuestion,
  adminCreateBranch,
} = require('../controllers/questionController')
const { protect, authorize } = require('../middleware/auth')

const router = express.Router()

router.get('/service/:serviceId', getQuestionnaire)

router.get('/', protect, authorize('ADMIN'), adminListQuestions)
router.post('/', protect, authorize('ADMIN'), adminCreateQuestion)
router.put('/:id', protect, authorize('ADMIN'), adminUpdateQuestion)
router.delete('/:id', protect, authorize('ADMIN'), adminDeleteQuestion)
router.post('/branches', protect, authorize('ADMIN'), adminCreateBranch)

module.exports = router
