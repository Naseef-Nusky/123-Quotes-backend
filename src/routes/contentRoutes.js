const express = require('express')
const prisma = require('../config/db')
const { asyncHandler, ok, fail } = require('../utils/helpers')
const { logActivity } = require('../services/activityService')

const router = express.Router()

router.get(
  '/home',
  asyncHandler(async (_req, res) => {
    const setting = await prisma.setting.findUnique({ where: { key: 'home_content' } })
    return ok(res, { content: setting?.value || null })
  }),
)

router.get(
  '/contact',
  asyncHandler(async (_req, res) => {
    const setting = await prisma.setting.findUnique({ where: { key: 'contact_info' } })
    return ok(res, {
      contact: setting?.value || {
        email: 'info@123quotes.co.uk',
        phone: '+44 20 0000 0000',
        address: '1st Floor, 239 Kensington High St, London W8 6SN',
      },
    })
  }),
)

router.post(
  '/contact',
  asyncHandler(async (req, res) => {
    const { name, email, message } = req.body
    if (!name || !email || !message) return fail(res, 'name, email and message are required')

    const existing = await prisma.setting.findUnique({ where: { key: 'contact_messages' } })
    const list = Array.isArray(existing?.value) ? existing.value : []
    list.unshift({
      id: `cm-${Date.now()}`,
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      message: String(message).trim(),
      createdAt: new Date().toISOString(),
    })

    await prisma.setting.upsert({
      where: { key: 'contact_messages' },
      create: { key: 'contact_messages', value: list.slice(0, 200) },
      update: { value: list.slice(0, 200) },
    })

    await logActivity({
      action: 'contact.submit',
      entityType: 'Contact',
      meta: { email: String(email).trim().toLowerCase() },
      ip: req.ip,
    })

    return ok(res, { message: 'Thanks — we received your message.' }, 201)
  }),
)

module.exports = router
