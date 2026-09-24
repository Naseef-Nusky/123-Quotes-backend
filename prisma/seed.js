require('dotenv').config()
const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')
const { seedDemoData } = require('./seedDemoData')

const prisma = new PrismaClient()

async function seed() {
  const superEmail = process.env.SUPER_ADMIN_EMAIL || 'superadmin@123quotes.com'
  const superPassword = process.env.SUPER_ADMIN_PASSWORD || 'superadmin123'
  const superName = process.env.SUPER_ADMIN_NAME || 'Super Admin'

  let superAdmin = await prisma.user.findUnique({
    where: { email: superEmail },
    include: { customer: true },
  })

  if (!superAdmin) {
    superAdmin = await prisma.user.create({
      data: {
        email: superEmail,
        passwordHash: await bcrypt.hash(superPassword, 10),
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        emailVerified: true,
        customer: {
          create: {
            firstName: superName.split(' ')[0] || 'Super',
            lastName: superName.split(' ').slice(1).join(' ') || 'Admin',
          },
        },
      },
    })
    console.log('Super admin created:', superEmail)
  } else if (superAdmin.role !== 'SUPER_ADMIN') {
    superAdmin = await prisma.user.update({
      where: { id: superAdmin.id },
      data: { role: 'SUPER_ADMIN', status: 'ACTIVE', emailVerified: true },
    })
    console.log('User promoted to super admin:', superEmail)
  } else {
    console.log('Super admin exists:', superEmail)
  }

  const categories = [
    {
      name: 'Home Improvements',
      slug: 'home-improvements',
      description: 'Renovations, repairs and upgrades for your home',
      services: [
        {
          name: 'Boiler Installation',
          slug: 'boiler-installation',
          shortDesc: 'New boiler supply and install',
          description: 'Get quotes from Gas Safe engineers for boiler installation.',
          tokenCost: 2,
          questions: [
            {
              label: 'What type of boiler do you need?',
              type: 'SINGLE_CHOICE',
              options: ['Combi', 'System', 'Regular', 'Not sure'],
            },
            {
              label: 'Is this a replacement or new install?',
              type: 'SINGLE_CHOICE',
              options: ['Replacement', 'New install'],
            },
            {
              label: 'Additional details',
              type: 'TEXTAREA',
              isRequired: false,
            },
          ],
        },
        {
          name: 'Kitchen Fitting',
          slug: 'kitchen-fitting',
          shortDesc: 'Kitchen design and fitting',
          description: 'Compare kitchen fitters near you.',
          tokenCost: 3,
          questions: [
            {
              label: 'Project type',
              type: 'DROPDOWN',
              options: ['Full kitchen', 'Units only', 'Worktops only', 'Other'],
            },
            {
              label: 'Approximate budget',
              type: 'SINGLE_CHOICE',
              options: ['Under £5k', '£5k-£10k', '£10k-£20k', '£20k+'],
            },
          ],
        },
      ],
    },
    {
      name: 'Cleaning',
      slug: 'cleaning',
      description: 'Domestic and commercial cleaning services',
      services: [
        {
          name: 'End of Tenancy Cleaning',
          slug: 'end-of-tenancy-cleaning',
          shortDesc: 'Move-out cleaning quotes',
          description: 'Book professional end of tenancy cleaners.',
          tokenCost: 1,
          questions: [
            {
              label: 'Property type',
              type: 'SINGLE_CHOICE',
              options: ['Flat', 'House', 'Studio', 'Other'],
            },
            {
              label: 'Number of bedrooms',
              type: 'DROPDOWN',
              options: ['1', '2', '3', '4+'],
            },
            {
              label: 'Do you need carpet cleaning?',
              type: 'SINGLE_CHOICE',
              options: ['Yes', 'No'],
            },
          ],
        },
      ],
    },
  ]

  for (const cat of categories) {
    const category = await prisma.category.upsert({
      where: { slug: cat.slug },
      create: {
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        isActive: true,
      },
      update: { name: cat.name, description: cat.description },
    })

    for (const [sIdx, svc] of cat.services.entries()) {
      const service = await prisma.service.upsert({
        where: { slug: svc.slug },
        create: {
          categoryId: category.id,
          name: svc.name,
          slug: svc.slug,
          shortDesc: svc.shortDesc,
          description: svc.description,
          tokenCost: svc.tokenCost,
          sortOrder: sIdx,
          isActive: true,
        },
        update: {
          name: svc.name,
          shortDesc: svc.shortDesc,
          description: svc.description,
          tokenCost: svc.tokenCost,
        },
      })

      const existingQs = await prisma.question.count({ where: { serviceId: service.id } })
      if (existingQs === 0) {
        for (const [qIdx, q] of svc.questions.entries()) {
          await prisma.question.create({
            data: {
              serviceId: service.id,
              label: q.label,
              type: q.type,
              isRequired: q.isRequired !== false,
              sortOrder: qIdx,
              options: q.options
                ? {
                    create: q.options.map((label, idx) => ({
                      label,
                      value: label,
                      sortOrder: idx,
                    })),
                  }
                : undefined,
            },
          })
        }
      }
    }
  }

  const { EMAIL_TEMPLATES } = require('../src/emails/templates')
  for (const t of EMAIL_TEMPLATES) {
    await prisma.emailTemplate.upsert({
      where: { key: t.key },
      create: { ...t, isActive: true },
      update: { subject: t.subject, bodyHtml: t.bodyHtml, bodyText: t.bodyText, isActive: true },
    })
  }

  await prisma.pageContent.upsert({
    where: { slug: 'terms' },
    create: {
      slug: 'terms',
      title: 'Terms & Conditions',
      body: 'Terms and conditions for using the 123 Quotes marketplace platform.',
    },
    update: {},
  })
  await prisma.pageContent.upsert({
    where: { slug: 'privacy' },
    create: {
      slug: 'privacy',
      title: 'Privacy Policy',
      body: 'How 123 Quotes collects, uses and protects your personal data.',
    },
    update: {},
  })
  await prisma.pageContent.upsert({
    where: { slug: 'how-it-works' },
    create: {
      slug: 'how-it-works',
      title: 'How It Works',
      body: 'Customers submit requests. Professionals unlock matching leads with tokens. Everyone wins.',
    },
    update: {},
  })

  await seedDemoData(prisma, bcrypt)

  console.log('Seed complete')
}

seed()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
