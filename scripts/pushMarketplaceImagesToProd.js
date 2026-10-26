/**
 * Push local marketplace image files to production disk via existing admin
 * upload endpoints (same content hash → same /api/marketplace-images URL).
 *
 * Usage:
 *   PROD_API_URL=https://app.123quotes.co.uk/api \
 *   node scripts/pushMarketplaceImagesToProd.js
 *
 * Auth falls back to ADMIN_EMAIL / ADMIN_PASSWORD from .env
 */
require('dotenv').config({ quiet: true })
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const API = (process.env.PROD_API_URL || 'https://app.123quotes.co.uk/api').replace(/\/$/, '')
const EMAIL = process.env.PROD_ADMIN_EMAIL || process.env.SUPER_ADMIN_EMAIL || process.env.ADMIN_EMAIL
const PASSWORD =
  process.env.PROD_ADMIN_PASSWORD || process.env.SUPER_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD
const SHARED = path.join(__dirname, '../uploads/marketplace/shared')
const ORIGIN = API.replace(/\/api$/, '')

const prisma = new PrismaClient()

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || `Login failed (${res.status})`)
  const token = data.token || data.data?.token
  if (!token) throw new Error('No token in login response')
  return token
}

function localPathFor(imageUrl) {
  if (!imageUrl || !imageUrl.includes('/marketplace-images/shared/')) return null
  const name = imageUrl.split('/').pop()
  if (!name) return null
  const full = path.join(SHARED, name)
  return fs.existsSync(full) ? full : null
}

async function uploadOne(token, kind, id, filePath) {
  const buf = fs.readFileSync(filePath)
  const form = new FormData()
  const blob = new Blob([buf], { type: 'image/jpeg' })
  form.append('image', blob, path.basename(filePath))

  const url =
    kind === 'service'
      ? `${API}/services/manage/${id}/image`
      : `${API}/services/manage/categories/${id}/image`

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || `Upload failed (${res.status}) for ${kind} ${id}`)
  return data
}

async function main() {
  if (!EMAIL || !PASSWORD) throw new Error('Missing ADMIN_EMAIL / ADMIN_PASSWORD')
  if (!fs.existsSync(SHARED)) throw new Error(`Missing ${SHARED}`)

  console.log(`Target API: ${API}`)
  const token = await login()
  console.log('Logged in as admin')

  const [services, categories] = await Promise.all([
    prisma.service.findMany({ select: { id: true, name: true, imageUrl: true } }),
    prisma.category.findMany({ select: { id: true, name: true, imageUrl: true } }),
  ])

  let okCount = 0
  let miss = 0
  let fail = 0

  for (const s of services) {
    const file = localPathFor(s.imageUrl)
    if (!file) {
      if (s.imageUrl?.includes('/marketplace-images/')) miss++
      continue
    }
    try {
      await uploadOne(token, 'service', s.id, file)
      okCount++
      process.stdout.write('.')
    } catch (e) {
      fail++
      console.log(`\nFAIL service ${s.name}: ${e.message}`)
    }
  }

  for (const c of categories) {
    const file = localPathFor(c.imageUrl)
    if (!file) {
      if (c.imageUrl?.includes('/marketplace-images/')) miss++
      continue
    }
    try {
      await uploadOne(token, 'category', c.id, file)
      okCount++
      process.stdout.write('.')
    } catch (e) {
      fail++
      console.log(`\nFAIL category ${c.name}: ${e.message}`)
    }
  }

  console.log(`\nUploaded/ensured: ${okCount}  missing local file: ${miss}  failed: ${fail}`)

  const sample = services.find((s) => s.imageUrl?.includes('/marketplace-images/shared/'))
  if (sample?.imageUrl) {
    const check = await fetch(`${ORIGIN}${sample.imageUrl}`)
    console.log(`Verify ${sample.imageUrl}: HTTP ${check.status}`)
  }
}

main()
  .catch((e) => {
    console.error(e.message || e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
