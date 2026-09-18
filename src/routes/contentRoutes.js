const express = require('express')
const prisma = require('../config/db')
const { asyncHandler, ok } = require('../utils/helpers')

const router = express.Router()

router.get(
  '/home',
  asyncHandler(async (_req, res) => {
    const setting = await prisma.setting.findUnique({ where: { key: 'home_content' } })
    return ok(res, { content: setting?.value || null })
  }),
)

module.exports = router
