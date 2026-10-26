const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const prisma = require('../config/db')
const { asyncHandler, ok, fail } = require('../utils/helpers')
const { slugify } = require('../utils/crypto')
const { UPLOAD_ROOT } = require('../services/attachmentService')

const IMAGE_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

function removeLocalImage(url, prefix, folder) {
  if (!url || !String(url).startsWith(prefix)) return
  // Never delete shared content-addressed files (may be referenced by others).
  if (String(url).includes('/shared/')) return
  const rel = String(url).replace(prefix, '')
  const full = path.join(UPLOAD_ROOT, folder, rel)
  try {
    if (fs.existsSync(full)) fs.unlinkSync(full)
  } catch {
    /* ignore */
  }
}

/**
 * Store once by content hash under uploads/marketplace/shared/<hash>.<ext>.
 * Same bytes → same URL (no duplicate files on disk).
 */
function storeSharedImage(buffer, ext) {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 32)
  const dir = path.join(UPLOAD_ROOT, 'marketplace', 'shared')
  fs.mkdirSync(dir, { recursive: true })
  const storedName = `${hash}.${ext}`
  const full = path.join(dir, storedName)
  if (!fs.existsSync(full)) {
    fs.writeFileSync(full, buffer)
  }
  return `/api/marketplace-images/shared/${storedName}`
}

async function imageUrlAlreadyUsed(imageUrl, except) {
  if (!imageUrl) return false
  const [svc, cat] = await Promise.all([
    prisma.service.findFirst({
      where: {
        imageUrl,
        ...(except?.serviceId ? { id: { not: except.serviceId } } : {}),
      },
      select: { id: true },
    }),
    prisma.category.findFirst({
      where: {
        imageUrl,
        ...(except?.categoryId ? { id: { not: except.categoryId } } : {}),
      },
      select: { id: true },
    }),
  ])
  return Boolean(svc || cat)
}

const listCategories = asyncHandler(async (_req, res) => {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    include: { services: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
    orderBy: { sortOrder: 'asc' },
  })
  return ok(res, { categories })
})

const listServices = asyncHandler(async (req, res) => {
  const where = { isActive: true }
  if (req.query.category) where.category = { slug: req.query.category }
  const services = await prisma.service.findMany({
    where,
    include: {
      category: true,
      questions: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: { options: { orderBy: { sortOrder: 'asc' } } },
      },
    },
    orderBy: { sortOrder: 'asc' },
  })
  return ok(res, { services })
})

const getService = asyncHandler(async (req, res) => {
  const service = await prisma.service.findFirst({
    where: {
      OR: [{ id: req.params.idOrSlug }, { slug: req.params.idOrSlug }],
      isActive: true,
    },
    include: {
      category: true,
      questions: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: {
          options: { orderBy: { sortOrder: 'asc' } },
          branchesFrom: true,
        },
      },
    },
  })
  if (!service) return fail(res, 'Service not found', 404)
  return ok(res, { service })
})

const adminListCategories = asyncHandler(async (_req, res) => {
  const categories = await prisma.category.findMany({
    // CRM table: newest first
    orderBy: [{ createdAt: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { services: true } } },
  })
  return ok(res, { categories })
})

const adminListServices = asyncHandler(async (_req, res) => {
  // Keep list payload light — questions load per-service in CRM Pro.Mgmt
  const [categories, services] = await Promise.all([
    prisma.category.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.service.findMany({
      where: { isActive: true },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        _count: { select: { questions: true, requests: true } },
      },
      // CRM table: newest first
      orderBy: [{ createdAt: 'desc' }, { name: 'asc' }],
    }),
  ])
  return ok(res, { services, categories })
})

const adminUpsertCategory = asyncHandler(async (req, res) => {
  const { id, name, description, icon, imageUrl, sortOrder, isActive } = req.body
  if (!name) return fail(res, 'Name is required')
  const slug = slugify(name)

  const existing = id
    ? await prisma.category.findUnique({ where: { id }, select: { name: true } })
    : null

  const data = {
    name,
    slug,
    description,
    icon,
    sortOrder,
    isActive,
  }
  if (imageUrl !== undefined) data.imageUrl = imageUrl || null

  const category = id
    ? await prisma.category.update({
        where: { id },
        data,
      })
    : await prisma.category.create({
        data: {
          name,
          slug,
          description,
          icon,
          imageUrl: imageUrl || null,
          sortOrder: sortOrder || 0,
          isActive: isActive !== false,
        },
      })

  // The public site mostly displays SERVICE names, and most categories have a
  // same-named service. If the category was renamed, rename those linked
  // services too, otherwise the old name keeps showing on the public site.
  if (id && existing && existing.name !== name) {
    try {
      const oldName = existing.name
      const matching = await prisma.service.findMany({
        where: { categoryId: id, name: oldName },
        select: { id: true },
      })
      if (matching.length === 1) {
        const clash = await prisma.service.findFirst({
          where: { slug, id: { not: matching[0].id } },
          select: { id: true },
        })
        if (!clash) {
          await prisma.service.update({
            where: { id: matching[0].id },
            data: { name, slug },
          })
        } else {
          await prisma.service.update({ where: { id: matching[0].id }, data: { name } })
        }
      } else if (matching.length > 1) {
        await prisma.service.updateMany({
          where: { categoryId: id, name: oldName },
          data: { name },
        })
      }
      // Legacy rows often repeat the category name as the blurb; sync those too.
      await prisma.service.updateMany({
        where: { categoryId: id, shortDesc: oldName },
        data: { shortDesc: name },
      })
      await prisma.service.updateMany({
        where: { categoryId: id, description: oldName },
        data: { description: name },
      })
    } catch (e) {
      console.error('Category rename service sync failed:', e.message)
    }
  }

  return ok(res, { category }, id ? 200 : 201)
})

const adminUpsertService = asyncHandler(async (req, res) => {
  const { id, categoryId, name, description, shortDesc, imageUrl, tokenCost, sortOrder, isActive } =
    req.body
  if (!categoryId || !name) return fail(res, 'categoryId and name are required')
  const slug = slugify(name)

  const data = {
    categoryId,
    name,
    slug,
    description,
    shortDesc,
    tokenCost,
    sortOrder,
    isActive,
  }
  if (imageUrl !== undefined) data.imageUrl = imageUrl || null

  const service = id
    ? await prisma.service.update({
        where: { id },
        data,
      })
    : await prisma.service.create({
        data: {
          categoryId,
          name,
          slug,
          description,
          shortDesc,
          imageUrl: imageUrl || null,
          tokenCost: tokenCost || 1,
          sortOrder: sortOrder || 0,
          isActive: isActive !== false,
        },
      })

  return ok(res, { service }, id ? 200 : 201)
})

const adminUploadServiceImage = asyncHandler(async (req, res) => {
  const service = await prisma.service.findUnique({ where: { id: req.params.id } })
  if (!service) return fail(res, 'Service not found', 404)
  if (!req.file?.buffer?.length) return fail(res, 'Image file is required')

  const ext = IMAGE_EXT[req.file.mimetype]
  if (!ext) return fail(res, 'Unsupported image type', 400)

  const imageUrl = storeSharedImage(req.file.buffer, ext)

  // Same file already set on this service — no DB write / no duplicate storage.
  if (service.imageUrl === imageUrl) {
    return ok(res, { service, imageUrl, deduped: true })
  }

  // Block assigning an image already used by another service/category.
  if (await imageUrlAlreadyUsed(imageUrl, { serviceId: service.id })) {
    return fail(
      res,
      'This image is already used by another service or category. Choose a different image.',
      409,
    )
  }

  removeLocalImage(service.imageUrl, '/api/service-images/', 'services')
  removeLocalImage(service.imageUrl, '/api/marketplace-images/', 'marketplace')

  const updated = await prisma.service.update({
    where: { id: service.id },
    data: { imageUrl },
  })
  return ok(res, { service: updated, imageUrl })
})

const adminUploadCategoryImage = asyncHandler(async (req, res) => {
  const category = await prisma.category.findUnique({ where: { id: req.params.id } })
  if (!category) return fail(res, 'Category not found', 404)
  if (!req.file?.buffer?.length) return fail(res, 'Image file is required')

  const ext = IMAGE_EXT[req.file.mimetype]
  if (!ext) return fail(res, 'Unsupported image type', 400)

  const imageUrl = storeSharedImage(req.file.buffer, ext)

  if (category.imageUrl === imageUrl) {
    return ok(res, { category, imageUrl, deduped: true })
  }

  if (await imageUrlAlreadyUsed(imageUrl, { categoryId: category.id })) {
    return fail(
      res,
      'This image is already used by another service or category. Choose a different image.',
      409,
    )
  }

  removeLocalImage(category.imageUrl, '/api/category-images/', 'categories')
  removeLocalImage(category.imageUrl, '/api/marketplace-images/', 'marketplace')

  const updated = await prisma.category.update({
    where: { id: category.id },
    data: { imageUrl },
  })
  return ok(res, { category: updated, imageUrl })
})

const adminDeleteCategory = asyncHandler(async (req, res) => {
  const category = await prisma.category.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { services: true } } },
  })
  if (!category) return fail(res, 'Category not found', 404)

  // Soft-delete category + its services
  await prisma.$transaction([
    prisma.service.updateMany({
      where: { categoryId: category.id },
      data: { isActive: false },
    }),
    prisma.category.update({
      where: { id: category.id },
      data: { isActive: false },
    }),
  ])

  return ok(res, { deleted: true, id: category.id, soft: true })
})

const adminDeleteService = asyncHandler(async (req, res) => {
  const service = await prisma.service.findUnique({ where: { id: req.params.id } })
  if (!service) return fail(res, 'Service not found', 404)

  await prisma.$transaction([
    prisma.question.updateMany({
      where: { serviceId: service.id },
      data: { isActive: false },
    }),
    prisma.service.update({
      where: { id: service.id },
      data: { isActive: false },
    }),
  ])

  return ok(res, { deleted: true, id: service.id, soft: true })
})

module.exports = {
  listCategories,
  listServices,
  getService,
  adminListCategories,
  adminListServices,
  adminUpsertCategory,
  adminUpsertService,
  adminUploadServiceImage,
  adminUploadCategoryImage,
  adminDeleteCategory,
  adminDeleteService,
}
