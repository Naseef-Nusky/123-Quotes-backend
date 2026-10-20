/**
 * Convert the single "Imported Services" umbrella category into real
 * per-service categories so the CRM Categories tab lists all 95.
 *
 *   node scripts/fixCategoriesStructure.js
 */
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  const umbrella = await prisma.category.findUnique({
    where: { slug: 'imported-checkare' },
    include: { services: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!umbrella) {
    const count = await prisma.category.count()
    console.log('No umbrella category found. Categories already:', count)
    return
  }

  console.log('Services under umbrella:', umbrella.services.length)
  let created = 0
  for (const svc of umbrella.services) {
    // Duplicate dump names share one category (name/slug are unique)
    let cat =
      (await prisma.category.findUnique({ where: { name: svc.name } })) ||
      (await prisma.category.findUnique({ where: { slug: svc.slug } }))
    if (!cat) {
      try {
        cat = await prisma.category.create({
          data: {
            name: svc.name,
            slug: svc.slug,
            description: svc.description || svc.name,
            isActive: svc.isActive,
            sortOrder: svc.sortOrder,
          },
        })
        created += 1
      } catch (e) {
        if (e.code !== 'P2002') throw e
        cat =
          (await prisma.category.findUnique({ where: { name: svc.name } })) ||
          (await prisma.category.findUnique({ where: { slug: svc.slug } }))
        if (!cat) throw e
      }
    }
    await prisma.service.update({
      where: { id: svc.id },
      data: { categoryId: cat.id },
    })
  }

  const remaining = await prisma.service.count({ where: { categoryId: umbrella.id } })
  if (remaining === 0) {
    await prisma.category.delete({ where: { id: umbrella.id } })
    console.log('Umbrella category removed.')
  }

  console.log({
    categoriesCreated: created,
    totalCategories: await prisma.category.count(),
    totalServices: await prisma.service.count(),
  })
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
