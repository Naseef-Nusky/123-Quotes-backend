const express = require('express')
const {
  dashboard,
  listUsers,
  updateUserStatus,
  createAdmin,
  updateSystemUser,
  deleteSystemUser,
  updateProfessional,
  deleteProfessional,
  listPackagesAdmin,
  upsertPackage,
  listPayments,
  listActivity,
  listTemplates,
  upsertTemplate,
  getSettings,
  upsertSetting,
  getPages,
  upsertPage,
} = require('../controllers/adminController')
const { protect, authorize } = require('../middleware/auth')

const router = express.Router()

router.use(protect, authorize('ADMIN'))

router.get('/dashboard', dashboard)
router.get('/users', listUsers)
router.post('/users', createAdmin)
router.put('/users/:id', updateSystemUser)
router.delete('/users/:id', deleteSystemUser)
router.patch('/users/:id/status', updateUserStatus)
router.put('/professionals/:id', updateProfessional)
router.delete('/professionals/:id', deleteProfessional)
router.get('/packages', listPackagesAdmin)
router.post('/packages', upsertPackage)
router.put('/packages/:id', (req, res, next) => {
  req.body.id = req.params.id
  return upsertPackage(req, res, next)
})
router.get('/payments', listPayments)
router.get('/activity', listActivity)
router.get('/templates', listTemplates)
router.post('/templates', upsertTemplate)
router.get('/settings', getSettings)
router.post('/settings', upsertSetting)
router.get('/pages', getPages)
router.post('/pages', upsertPage)

module.exports = router
