const express = require('express')
const {
  getProfile,
  updateProfile,
  setServices,
  setServiceAreas,
  listPackages,
  buyTokens,
  tokenHistory,
  publicDirectory,
  publicProfile,
  adminAdjustTokens,
} = require('../controllers/professionalController')
const { protect, authorize } = require('../middleware/auth')

const router = express.Router()

router.get('/directory', publicDirectory)
router.get('/directory/:id', publicProfile)
router.get('/packages', listPackages)

router.get('/me', protect, authorize('PROFESSIONAL'), getProfile)
router.put('/me', protect, authorize('PROFESSIONAL'), updateProfile)
router.put('/me/services', protect, authorize('PROFESSIONAL'), setServices)
router.put('/me/areas', protect, authorize('PROFESSIONAL'), setServiceAreas)
router.get('/me/tokens', protect, authorize('PROFESSIONAL'), tokenHistory)
router.post('/me/tokens/purchase', protect, authorize('PROFESSIONAL'), buyTokens)

router.post('/admin/tokens/adjust', protect, authorize('ADMIN'), adminAdjustTokens)

module.exports = router
