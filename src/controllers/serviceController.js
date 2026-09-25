const prisma = require('../config/db')
const { asyncHandler, ok, fail } = require('../utils/helpers')
const { slugify } = require('../utils/crypto')

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

const adminListServices = asyncHandler(async (_req, res) => {
  const [categories, services] = await Promise.all([
    prisma.category.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.service.findMany({
      where: { isActive: true },
      include: {
        category: true,
        questions: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          include: { options: { orderBy: { sortOrder: 'asc' } } },
        },
        _count: { select: { questions: true, requests: true } },
      },
      orderBy: { sortOrder: 'asc' },
    }),
  ])
  return ok(res, { services, categories })
})

const adminUpsertCategory = asyncHandler(async (req, res) => {
  const { id, name, description, icon, sortOrder, isActive } = req.body
  if (!name) return fail(res, 'Name is required')
  const slug = slugify(name)

  const category = id
    ? await prisma.category.update({
        where: { id },
        data: { name, slug, description, icon, sortOrder, isActive },
      })
    : await prisma.category.create({
        data: { name, slug, description, icon, sortOrder: sortOrder || 0, isActive: isActive !== false },
      })

  return ok(res, { category }, id ? 200 : 201)
})

const adminUpsertService = asyncHandler(async (req, res) => {
  const { id, categoryId, name, description, shortDesc, tokenCost, sortOrder, isActive } = req.body
  if (!categoryId || !name) return fail(res, 'categoryId and name are required')
  const slug = slugify(name)

  const service = id
    ? await prisma.service.update({
        where: { id },
        data: { categoryId, name, slug, description, shortDesc, tokenCost, sortOrder, isActive },
      })
    : await prisma.service.create({
        data: {
          categoryId,
          name,
          slug,
          description,
          shortDesc,
          tokenCost: tokenCost || 1,
          sortOrder: sortOrder || 0,
          isActive: isActive !== false,
        },
      })

  return ok(res, { service }, id ? 200 : 201)
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
  adminListServices,
  adminUpsertCategory,
  adminUpsertService,
  adminDeleteCategory,
  adminDeleteService,
}
