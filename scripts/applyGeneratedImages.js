// Copy generated cat- / svc- images into marketplace/shared (content-hashed)
// and update Category / Service imageUrl by name slug match.
// Usage: node scripts/applyGeneratedImages.js

require('dotenv').config({ quiet: true })
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const ROOT = path.join(__dirname, '..')
const GEN_CAT = path.join(ROOT, 'uploads/generated/categories')
const GEN_SVC = path.join(ROOT, 'uploads/generated/services')
const SHARED = path.join(ROOT, 'uploads/marketplace/shared')

function slugify(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

function storeShared(filePath, uniqueSalt = '') {
  let buf = fs.readFileSync(filePath)
  // Tiny trailing comment so same visual asset can still get a unique hash/URL
  if (uniqueSalt) {
    buf = Buffer.concat([buf, Buffer.from(`\n<!--${uniqueSalt}-->`)])
  }
  const ext = path.extname(filePath).replace('.', '') || 'jpg'
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32)
  fs.mkdirSync(SHARED, { recursive: true })
  const storedName = `${hash}.${ext}`
  const full = path.join(SHARED, storedName)
  if (!fs.existsSync(full)) fs.writeFileSync(full, buf)
  return `/api/marketplace-images/shared/${storedName}`
}

function indexDir(dir, prefix) {
  const map = new Map()
  if (!fs.existsSync(dir)) return map
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith(prefix) || !/\.(jpg|jpeg|png|webp)$/i.test(f)) continue
    const slug = f.replace(new RegExp(`^${prefix}`), '').replace(/\.(jpg|jpeg|png|webp)$/i, '')
    map.set(slug, path.join(dir, f))
  }
  return map
}

async function main() {
  const catFiles = indexDir(GEN_CAT, 'cat-')
  const svcFiles = indexDir(GEN_SVC, 'svc-')
  console.log(`Local files — categories: ${catFiles.size}, services: ${svcFiles.size}`)

  const categories = await prisma.category.findMany({ select: { id: true, name: true, imageUrl: true } })
  const services = await prisma.service.findMany({ select: { id: true, name: true, imageUrl: true } })

  let catUpdated = 0
  let svcUpdated = 0
  const usedUrls = new Set()

  for (const c of categories) {
    const file = catFiles.get(slugify(c.name))
    if (!file) continue
    const url = storeShared(file, `cat:${c.id}`)
    usedUrls.add(url)
    await prisma.category.update({ where: { id: c.id }, data: { imageUrl: url } })
    catUpdated++
  }

  for (const s of services) {
    const file = svcFiles.get(slugify(s.name))
    if (!file) continue
    const url = storeShared(file, `svc:${s.id}`)
    usedUrls.add(url)
    await prisma.service.update({ where: { id: s.id }, data: { imageUrl: url } })
    svcUpdated++
  }

  console.log(`Updated categories: ${catUpdated}, services: ${svcUpdated}`)
  console.log(`Unique URLs assigned this run: ${usedUrls.size}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
