const prisma = require('../config/db')
const { asyncHandler, ok, fail } = require('../utils/helpers')
const { purchaseTokenPackage } = require('../services/paymentService')
const { adjustTokens } = require('../services/tokenService')

const getProfile = asyncHandler(async (req, res) => {
  const profile = await prisma.professionalProfile.findUnique({
    where: { id: req.user.professional.id },
    include: {
      services: { include: { service: true } },
      serviceAreas: true,
      tokenTxns: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  })
  return ok(res, { profile })
})

const updateProfile = asyncHandler(async (req, res) => {
  const data = (({
    companyName,
    contactName,
    phone,
    website,
    bio,
    postcode,
    address,
    city,
    isAvailable,
  }) => ({
    companyName,
    contactName,
    phone,
    website,
    bio,
    postcode,
    address,
    city,
    isAvailable,
  }))(req.body)

  const profile = await prisma.professionalProfile.update({
    where: { id: req.user.professional.id },
    data,
  })
  return ok(res, { profile })
})

const setServices = asyncHandler(async (req, res) => {
  const serviceIds = Array.isArray(req.body.serviceIds) ? req.body.serviceIds : []
  const professionalId = req.user.professional.id

  await prisma.professionalService.deleteMany({ where: { professionalId } })
  if (serviceIds.length) {
    await prisma.professionalService.createMany({
      data: serviceIds.map((serviceId) => ({ professionalId, serviceId })),
    })
  }

  const services = await prisma.professionalService.findMany({
    where: { professionalId },
    include: { service: true },
  })
  return ok(res, { services })
})

const setServiceAreas = asyncHandler(async (req, res) => {
  const areas = Array.isArray(req.body.areas) ? req.body.areas : []
  const professionalId = req.user.professional.id

  await prisma.serviceArea.deleteMany({ where: { professionalId } })
  if (areas.length) {
    await prisma.serviceArea.createMany({
      data: areas.map((a) => ({
        professionalId,
        postcode: a.postcode || null,
        city: a.city || null,
        radiusMiles: a.radiusMiles || null,
        label: a.label || null,
      })),
    })
  }

  const serviceAreas = await prisma.serviceArea.findMany({ where: { professionalId } })
  return ok(res, { serviceAreas })
})

const listPackages = asyncHandler(async (_req, res) => {
  const packages = await prisma.tokenPackage.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  })
  return ok(res, { packages })
})

const buyTokens = asyncHandler(async (req, res) => {
  try {
    const result = await purchaseTokenPackage({
      user: req.user,
      packageId: req.body.packageId,
      sourceId: req.body.sourceId || 'sandbox-token',
    })
    return ok(res, result)
  } catch (err) {
    return fail(res, err.message)
  }
})

const tokenHistory = asyncHandler(async (req, res) => {
  const transactions = await prisma.tokenTransaction.findMany({
    where: { professionalId: req.user.professional.id },
    orderBy: { createdAt: 'desc' },
  })
  return ok(res, { transactions })
})

const publicDirectory = asyncHandler(async (req, res) => {
  const where = {
    user: { status: 'ACTIVE' },
    isAvailable: true,
  }
  if (req.query.service) {
    where.services = { some: { service: { slug: req.query.service } } }
  }
  if (req.query.city) {
    where.OR = [
      { city: { contains: req.query.city, mode: 'insensitive' } },
      { serviceAreas: { some: { city: { contains: req.query.city, mode: 'insensitive' } } } },
    ]
  }
  if (req.query.postcode) {
    const pc = String(req.query.postcode).trim()
    where.OR = [
      ...(where.OR || []),
      { postcode: { contains: pc, mode: 'insensitive' } },
      { serviceAreas: { some: { postcode: { contains: pc, mode: 'insensitive' } } } },
    ]
  }

  const professionals = await prisma.professionalProfile.findMany({
    where,
    select: {
      id: true,
      companyName: true,
      contactName: true,
      bio: true,
      city: true,
      postcode: true,
      website: true,
      services: { include: { service: { select: { id: true, name: true, slug: true } } } },
      serviceAreas: true,
    },
    take: 50,
  })
  return ok(res, { professionals })
})

const publicProfile = asyncHandler(async (req, res) => {
  const professional = await prisma.professionalProfile.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      companyName: true,
      contactName: true,
      phone: true,
      bio: true,
      city: true,
      postcode: true,
      website: true,
      services: { include: { service: true } },
      serviceAreas: true,
      user: { select: { email: true, status: true } },
    },
  })
  if (!professional) return fail(res, 'Professional not found', 404)
  return ok(res, {
    professional: {
      ...professional,
      email: professional.user?.email,
      user: undefined,
    },
  })
})

const adminAdjustTokens = asyncHandler(async (req, res) => {
  const { professionalId, amount, reason } = req.body
  const updated = await adjustTokens({
    professionalId,
    amount: Number(amount),
    type: Number(amount) >= 0 ? 'BONUS' : 'ADJUSTMENT',
    reference: reason || 'admin-adjust',
  })
  return ok(res, { professional: updated })
})

module.exports = {
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
}
