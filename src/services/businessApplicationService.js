const prisma = require('../config/db')

async function resolveServiceId({ serviceIds = [], serviceSlug, serviceName }) {
  let resolved = Array.isArray(serviceIds) ? [...serviceIds] : []
  if (!resolved.length && (serviceSlug || serviceName)) {
    const service = await prisma.service.findFirst({
      where: {
        OR: [
          serviceSlug ? { slug: String(serviceSlug) } : undefined,
          serviceName
            ? { name: { equals: String(serviceName), mode: 'insensitive' } }
            : undefined,
        ].filter(Boolean),
        isActive: true,
      },
    })
    if (service) resolved = [service.id]
  }
  return {
    serviceIds: resolved,
    serviceId: resolved[0] || null,
  }
}

async function applyApplicationToProfile(application, { activateUser = false } = {}) {
  if (!application.userId) return null

  const user = await prisma.user.findUnique({
    where: { id: application.userId },
    include: { professional: true },
  })
  if (!user) return null

  let professional = user.professional
  if (!professional) {
    professional = await prisma.professionalProfile.create({
      data: {
        userId: user.id,
        companyName: application.companyName,
        contactName: application.contactName,
        phone: application.phone,
        website: application.website,
        postcode: application.postcode,
        isAvailable: activateUser || user.status === 'ACTIVE',
      },
    })
  } else if (application.isAdditional) {
    // Only after admin approval — apply the new application details + services
    await prisma.professionalProfile.update({
      where: { id: professional.id },
      data: {
        contactName: application.contactName || undefined,
        companyName: application.companyName || undefined,
        ...(application.phone ? { phone: application.phone } : {}),
        ...(application.website ? { website: application.website } : {}),
        ...(application.postcode ? { postcode: application.postcode } : {}),
      },
    })
  }

  if (application.serviceId) {
    await prisma.professionalService.upsert({
      where: {
        professionalId_serviceId: {
          professionalId: professional.id,
          serviceId: application.serviceId,
        },
      },
      create: {
        professionalId: professional.id,
        serviceId: application.serviceId,
      },
      update: {},
    })
  }

  const areaPostcode = application.nationwide
    ? 'NATIONWIDE'
    : application.postcode || null
  if (areaPostcode) {
    const existingArea = await prisma.serviceArea.findFirst({
      where: {
        professionalId: professional.id,
        postcode: { equals: areaPostcode, mode: 'insensitive' },
        ...(application.nationwide
          ? {}
          : { radiusMiles: application.radiusMiles || 50 }),
      },
    })
    if (!existingArea) {
      await prisma.serviceArea.create({
        data: {
          professionalId: professional.id,
          postcode: areaPostcode,
          radiusMiles: application.nationwide ? null : application.radiusMiles || 50,
          label: application.nationwide ? 'Nationwide' : undefined,
        },
      })
    }
  }

  if (activateUser && user.status !== 'ACTIVE') {
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'ACTIVE', emailVerified: true },
    })
    await prisma.professionalProfile.update({
      where: { id: professional.id },
      data: { isAvailable: true },
    })
  }

  return professional
}

module.exports = { resolveServiceId, applyApplicationToProfile }
