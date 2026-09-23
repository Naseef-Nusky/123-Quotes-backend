/** Idempotent demo marketplace data (~4 records per entity). */

async function upsertCustomer(prisma, bcrypt, { email, password, firstName, lastName, phone, postcode, city }) {
  const existing = await prisma.user.findUnique({ where: { email }, include: { customer: true } })
  if (existing) return existing
  return prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 10),
      role: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerified: true,
      customer: {
        create: { firstName, lastName, phone, postcode, city },
      },
    },
    include: { customer: true },
  })
}

async function upsertProfessional(
  prisma,
  bcrypt,
  {
    email,
    password,
    companyName,
    contactName,
    phone,
    postcode,
    city,
    bio,
    tokenBalance,
    status,
    serviceSlugs,
    areaPostcode,
  },
) {
  const existing = await prisma.user.findUnique({
    where: { email },
    include: { professional: { include: { services: true, serviceAreas: true } } },
  })
  if (existing?.professional) {
    if (existing.status !== status) {
      await prisma.user.update({ where: { id: existing.id }, data: { status } })
    }
    return existing
  }

  const services = []
  for (const slug of serviceSlugs || []) {
    const svc = await prisma.service.findUnique({ where: { slug } })
    if (svc) services.push(svc)
  }

  return prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 10),
      role: 'PROFESSIONAL',
      status: status || 'ACTIVE',
      emailVerified: true,
      professional: {
        create: {
          companyName,
          contactName,
          phone,
          postcode,
          city,
          bio,
          tokenBalance: tokenBalance ?? 20,
          isAvailable: status === 'ACTIVE',
          services: services.length
            ? { create: services.map((s) => ({ serviceId: s.id })) }
            : undefined,
          serviceAreas: {
            create: [
              {
                postcode: areaPostcode || (postcode || '').split(' ')[0],
                city,
                radiusMiles: 25,
              },
            ],
          },
        },
      },
    },
    include: { professional: true },
  })
}

async function ensureExtraCategories(prisma) {
  const extras = [
    {
      name: 'Digital & Creative',
      slug: 'digital-creative',
      description: 'Web, design and digital services',
      services: [
        {
          name: 'Web Development',
          slug: 'web-development',
          shortDesc: 'Websites and web apps',
          description: 'Get quotes from web developers near you.',
          tokenCost: 2,
          questions: [
            {
              label: "What's your Website requirement?",
              type: 'SINGLE_CHOICE',
              options: ['Create A New Website', 'Update Existing', 'E-commerce', 'Other'],
            },
            {
              label: 'How quickly do you want the website updated or launched?',
              type: 'SINGLE_CHOICE',
              options: ['As Soon As Possible', 'Flexible', 'Within a month'],
            },
            {
              label: "What's your budget?",
              type: 'SINGLE_CHOICE',
              options: ['Less Than £300', '£300 – £500', '£500 – £2,000', '£2,000+'],
            },
          ],
        },
      ],
    },
    {
      name: 'Photography',
      slug: 'photography',
      description: 'Event and commercial photography',
      services: [
        {
          name: 'Event Photography',
          slug: 'event-photography',
          shortDesc: 'Weddings, corporate and parties',
          description: 'Compare photographers for your event.',
          tokenCost: 2,
          questions: [
            {
              label: 'What type of event?',
              type: 'DROPDOWN',
              options: ['Wedding', 'Corporate', 'Birthday', 'Other'],
            },
            {
              label: 'Approximate guest count',
              type: 'SINGLE_CHOICE',
              options: ['Under 50', '50-100', '100-200', '200+'],
            },
          ],
        },
      ],
    },
  ]

  for (const cat of extras) {
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
              isRequired: true,
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
}

async function seedLead(
  prisma,
  {
    customer,
    serviceSlug,
    postcode,
    city,
    summary,
    status,
    answerValues,
    professionalEmails,
    daysAgo,
  },
) {
  const existing = await prisma.lead.findFirst({ where: { summary } })
  if (existing) return existing

  const service = await prisma.service.findUnique({
    where: { slug: serviceSlug },
    include: { questions: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!service || !customer.customer) return null

  const createdAt = new Date(Date.now() - (daysAgo || 1) * 24 * 60 * 60 * 1000)

  const request = await prisma.customerRequest.create({
    data: {
      customerId: customer.customer.id,
      serviceId: service.id,
      status: 'MATCHED',
      title: summary,
      description: summary,
      postcode,
      city,
      submittedAt: createdAt,
      createdAt,
      answers: {
        create: service.questions.slice(0, answerValues.length).map((q, i) => ({
          questionId: q.id,
          value: answerValues[i],
        })),
      },
    },
  })

  const lead = await prisma.lead.create({
    data: {
      requestId: request.id,
      serviceId: service.id,
      status: status || 'OPEN',
      summary,
      postcode,
      city,
      tokenCost: service.tokenCost,
      matchedCount: professionalEmails?.length || 0,
      createdAt,
    },
  })

  for (const email of professionalEmails || []) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { professional: true },
    })
    if (!user?.professional) continue
    await prisma.leadMatch.create({
      data: {
        leadId: lead.id,
        professionalId: user.professional.id,
        status: 'AVAILABLE',
        score: 80,
      },
    })
  }

  return lead
}

async function seedPayment(prisma, { userId, packageName, amountCents, provider, status, daysAgo, reference }) {
  const existing = await prisma.payment.findFirst({
    where: { providerPaymentId: reference },
  })
  if (existing) return existing

  const pkg = packageName
    ? await prisma.tokenPackage.findFirst({ where: { name: packageName } })
    : null

  return prisma.payment.create({
    data: {
      userId,
      packageId: pkg?.id || null,
      amountCents,
      currency: 'GBP',
      status: status || 'COMPLETED',
      provider,
      providerPaymentId: reference,
      meta: pkg ? { tokens: pkg.tokens, packageName: pkg.name } : undefined,
      createdAt: new Date(Date.now() - (daysAgo || 1) * 24 * 60 * 60 * 1000),
    },
  })
}

async function seedDemoData(prisma, bcrypt) {
  await ensureExtraCategories(prisma)

  const packages = [
    { name: 'Starter', tokens: 10, priceCents: 2500, description: '10 tokens to unlock leads', sortOrder: 1 },
    { name: 'Growth', tokens: 30, priceCents: 6500, description: '30 tokens – best for active pros', sortOrder: 2 },
    { name: 'Pro', tokens: 75, priceCents: 14000, description: '75 tokens with best value', sortOrder: 3 },
    { name: 'Enterprise', tokens: 200, priceCents: 32000, description: '200 tokens for high-volume teams', sortOrder: 4 },
  ]
  for (const pkg of packages) {
    const existing = await prisma.tokenPackage.findFirst({ where: { name: pkg.name } })
    if (!existing) {
      await prisma.tokenPackage.create({ data: { ...pkg, currency: 'GBP', isActive: true } })
    }
  }

  const customers = await Promise.all([
    upsertCustomer(prisma, bcrypt, {
      email: 'customer@123quotes.com',
      password: 'customer123',
      firstName: 'Alex',
      lastName: 'Customer',
      phone: '07000000001',
      postcode: 'SW1A 1AA',
      city: 'London',
    }),
    upsertCustomer(prisma, bcrypt, {
      email: 'john.customer@123quotes.com',
      password: 'customer123',
      firstName: 'John',
      lastName: 'Miller',
      phone: '07100000011',
      postcode: 'BN2 1AA',
      city: 'Brighton',
    }),
    upsertCustomer(prisma, bcrypt, {
      email: 'eleanor@123quotes.com',
      password: 'customer123',
      firstName: 'Eleanor',
      lastName: 'Cutler',
      phone: '07700001111',
      postcode: 'W8 5SA',
      city: 'London',
    }),
    upsertCustomer(prisma, bcrypt, {
      email: 'priya.customer@123quotes.com',
      password: 'customer123',
      firstName: 'Priya',
      lastName: 'Shah',
      phone: '07800002222',
      postcode: 'M1 1AE',
      city: 'Manchester',
    }),
  ])

  const activePros = [
    {
      email: 'pro@123quotes.com',
      password: 'pro12345',
      companyName: 'Prime Heat Engineers',
      contactName: 'Sam Professional',
      phone: '07000000002',
      postcode: 'SW1A 1AA',
      city: 'London',
      bio: 'Gas Safe registered engineers covering Central London.',
      tokenBalance: 40,
      status: 'ACTIVE',
      serviceSlugs: ['boiler-installation', 'kitchen-fitting'],
    },
    {
      email: 'pixel@123quotes.com',
      password: 'pro12345',
      companyName: 'Pixel Forge Studios',
      contactName: 'Jordan Lee',
      phone: '07000000003',
      postcode: 'EC1A 1BB',
      city: 'London',
      bio: 'Full-stack web development and UX for SMEs.',
      tokenBalance: 55,
      status: 'ACTIVE',
      serviceSlugs: ['web-development'],
    },
    {
      email: 'virtualtours@123quotes.com',
      password: 'pro12345',
      companyName: 'Virtualtours',
      contactName: 'Mia Chen',
      phone: '07000000004',
      postcode: 'BN1 1AA',
      city: 'Brighton',
      bio: 'Event photography and virtual tour packages.',
      tokenBalance: 25,
      status: 'ACTIVE',
      serviceSlugs: ['event-photography'],
    },
    {
      email: 'creations@123quotes.com',
      password: 'pro12345',
      companyName: 'Creations Arena',
      contactName: 'Omar Hassan',
      phone: '07000000005',
      postcode: 'M2 3AQ',
      city: 'Manchester',
      bio: 'End of tenancy and commercial cleaning specialists.',
      tokenBalance: 30,
      status: 'ACTIVE',
      serviceSlugs: ['end-of-tenancy-cleaning'],
    },
  ]

  for (const pro of activePros) {
    await upsertProfessional(prisma, bcrypt, pro)
  }

  const pendingPros = [
    {
      email: 'pending1@123quotes.com',
      password: 'pro12345',
      companyName: 'Bright Build Co',
      contactName: 'Nina Patel',
      phone: '07900000001',
      postcode: 'B1 1AA',
      city: 'Birmingham',
      bio: 'Awaiting approval – kitchen fitting.',
      tokenBalance: 0,
      status: 'PENDING',
      serviceSlugs: ['kitchen-fitting'],
    },
    {
      email: 'pending2@123quotes.com',
      password: 'pro12345',
      companyName: 'North Clean Ltd',
      contactName: 'Chris Evans',
      phone: '07900000002',
      postcode: 'LS1 1BA',
      city: 'Leeds',
      bio: 'Awaiting approval – cleaning services.',
      tokenBalance: 0,
      status: 'PENDING',
      serviceSlugs: ['end-of-tenancy-cleaning'],
    },
  ]

  for (const pro of pendingPros) {
    await upsertProfessional(prisma, bcrypt, pro)
  }

  const [c1, c2, c3, c4] = customers

  await seedLead(prisma, {
    customer: c1,
    serviceSlug: 'web-development',
    postcode: 'SW1A 1AA',
    city: 'London',
    summary: 'Create a new website / As soon as possible / Less than £300',
    status: 'OPEN',
    answerValues: ['Create A New Website', 'As Soon As Possible', 'Less Than £300'],
    professionalEmails: ['pixel@123quotes.com', 'pro@123quotes.com'],
    daysAgo: 1,
  })

  await seedLead(prisma, {
    customer: c2,
    serviceSlug: 'web-development',
    postcode: 'BN2 1AA',
    city: 'Brighton',
    summary: 'Create a new website / Flexible / £500 – £2,000',
    status: 'CLOSED',
    answerValues: ['Create A New Website', 'Flexible', '£500 – £2,000'],
    professionalEmails: ['pixel@123quotes.com'],
    daysAgo: 300,
  })

  await seedLead(prisma, {
    customer: c3,
    serviceSlug: 'boiler-installation',
    postcode: 'W8 5SA',
    city: 'London',
    summary: 'Combi boiler replacement / Replacement',
    status: 'MATCHED',
    answerValues: ['Combi', 'Replacement'],
    professionalEmails: ['pro@123quotes.com'],
    daysAgo: 5,
  })

  await seedLead(prisma, {
    customer: c4,
    serviceSlug: 'end-of-tenancy-cleaning',
    postcode: 'M1 1AE',
    city: 'Manchester',
    summary: 'Flat / 2 bedrooms / Carpet cleaning yes',
    status: 'OPEN',
    answerValues: ['Flat', '2', 'Yes'],
    professionalEmails: ['creations@123quotes.com', 'pro@123quotes.com'],
    daysAgo: 2,
  })

  const pixel = await prisma.user.findUnique({ where: { email: 'pixel@123quotes.com' } })
  const prime = await prisma.user.findUnique({ where: { email: 'pro@123quotes.com' } })
  const virtual = await prisma.user.findUnique({ where: { email: 'virtualtours@123quotes.com' } })
  const creations = await prisma.user.findUnique({ where: { email: 'creations@123quotes.com' } })

  if (pixel) {
    await seedPayment(prisma, {
      userId: pixel.id,
      packageName: 'Growth',
      amountCents: 6500,
      provider: 'square',
      reference: 'demo-pay-online-001',
      daysAgo: 2,
    })
  }
  if (prime) {
    await seedPayment(prisma, {
      userId: prime.id,
      packageName: 'Starter',
      amountCents: 2500,
      provider: 'square',
      reference: 'demo-pay-online-002',
      daysAgo: 4,
    })
  }
  if (virtual) {
    await seedPayment(prisma, {
      userId: virtual.id,
      packageName: 'Pro',
      amountCents: 14000,
      provider: 'square',
      reference: 'demo-pay-square-003',
      daysAgo: 7,
    })
  }
  if (creations) {
    await seedPayment(prisma, {
      userId: creations.id,
      packageName: 'Enterprise',
      amountCents: 32000,
      provider: 'square',
      reference: 'demo-pay-square-004',
      daysAgo: 1,
    })
  }

  await prisma.setting.upsert({
    where: { key: 'lead_view_locked' },
    create: { key: 'lead_view_locked', value: false },
    update: {},
  })

  await prisma.setting.upsert({
    where: { key: 'contact_info' },
    create: {
      key: 'contact_info',
      value: {
        email: 'info@123quotes.co.uk',
        phone: '+44 20 0000 0000',
        address: '1st Floor, 239 Kensington High St, London W8 6SN',
      },
    },
    update: {},
  })

  await prisma.setting.upsert({
    where: { key: 'home_content' },
    create: {
      key: 'home_content',
      value: {
        hero: {
          title: 'The Contemporary Method Of Locating The Professional Service You Need',
          subtitle: '',
          needPlaceholder: 'Tell us what you need?',
          postcodePlaceholder: 'Postcode',
          buttonText: 'SEARCH',
          searchPlaceholder: 'Web Development',
        },
        popularTitle: 'Popular Services',
        popularServices: [
          {
            id: 'ps-1',
            title: 'Web Development',
            description:
              'Here at 123Quotes, you can find the best web developers. Start your search, receive free quotes right away!',
            link: '/services/web-development',
            buttonText: 'Find More',
          },
          {
            id: 'ps-2',
            title: 'Event Photography',
            description:
              '123Quotes provides quotes from top photographers! Please enquire today to receive free quotes straight away!',
            link: '/services/event-photography',
            buttonText: 'Find More',
          },
          {
            id: 'ps-3',
            title: 'Boiler Installation',
            description:
              'Get free quotes from Gas Safe engineers near you for boiler installation and replacement.',
            link: '/services/boiler-installation',
            buttonText: 'Find More',
          },
          {
            id: 'ps-4',
            title: 'End of Tenancy Cleaning',
            description:
              'On 123Quotes, you can receive free quotes from great cleaners near you!',
            link: '/services/end-of-tenancy-cleaning',
            buttonText: 'Find More',
          },
        ],
        hire: {
          title: 'Hire A Professional',
          subtitle: 'Search, Compare, And Book In Minutes.',
          body: 'Hunting for a local or virtual service professional has never been easier. 123Quotes helps you narrow your results with helpful search functions, provides a lengthy list of reviewed and verified providers, and allows you to enquire, receive free quotes, and book a service in a few simple steps!',
          image: '/images/hire-professional.png',
          cta: 'Start your search today.',
          steps: [
            {
              id: 'hs-1',
              title: 'Start Your Service Search',
              description:
                "Working on a landscaping project, building an app, or improving health and wellness? No matter your task or goals, 123Quotes has the professional services you're searching for and the tools to help you find them fast. Let us know your needs, such as budget, schedule, location, and any specific preferences or requirements, so we can find your perfect match.",
            },
            {
              id: 'hs-2',
              title: 'Compare Service Offerings',
              description:
                'Search and find a list of Service Offerings that meet your needs. Compare and contrast reviews, prices, availability, and more in minutes. Highly rated professionals are waiting and ready to help.',
            },
            {
              id: 'hs-3',
              title: 'Book a Service',
              description:
                'Make arrangements in an instant for your next project or service. 123Quotes makes it safe and secure to contact, hire, and book a professional.',
            },
          ],
        },
        join: {
          title: 'Join 123Quotes',
          subtitle: 'Do you want to get hired? Say hello to 123Quotes!',
          body: 'Join thousands of professional Service providers that are growing there business and sharing their expertise with the world!',
          buttonText: 'Business Signup',
          cards: [
            {
              id: 'jc-1',
              title: 'Message And Manage',
              description:
                'Get in contact with customers quick and easy! Offer quotes and discuss all information required! Message customers and manage your customers! Negotiate deals & discuss terms etc.',
              image: '/images/join-message.png',
            },
            {
              id: 'jc-2',
              title: 'Showcase Your Skills',
              description:
                'Make yourself searchable and build a solid online business presence with a profile that shows off your best projects and expertise.',
              image: '/images/join-showcase.png',
            },
            {
              id: 'jc-3',
              title: 'Business Booming',
              description:
                "Whether starting a new side hustle or expanding your existing client list, 123Quotes makes it simple to gain more momentum. With helpful business tools, customer support, speedy notifications, and much more, we're ready to help boost your business.",
              image: '/images/join-booming.png',
            },
          ],
        },
      },
    },
    update: {},
  })

  await prisma.setting.upsert({
    where: { key: 'category_errors' },
    create: {
      key: 'category_errors',
      value: [
        {
          id: 'ce-1',
          category: 'Wrong – Plumber',
          user: 'Alex Customer',
          contact: '07000000001',
          email: 'customer@123quotes.com',
          recDate: '2026-09-10',
        },
        {
          id: 'ce-2',
          category: 'Misc / Other',
          user: 'John Miller',
          contact: '07100000011',
          email: 'john.customer@123quotes.com',
          recDate: '2026-09-12',
        },
        {
          id: 'ce-3',
          category: 'Uncategorised',
          user: 'Eleanor Cutler',
          contact: '07700001111',
          email: 'eleanor@123quotes.com',
          recDate: '2026-09-14',
        },
        {
          id: 'ce-4',
          category: 'General enquiry',
          user: 'Priya Shah',
          contact: '07800002222',
          email: 'priya.customer@123quotes.com',
          recDate: '2026-09-16',
        },
      ],
    },
    update: {},
  })

  console.log('Demo data ready:')
  console.log('  Customers: customer@ / john.customer@ / eleanor@ / priya.customer@  (customer123)')
  console.log('  Pros: pro@ / pixel@ / virtualtours@ / creations@  (pro12345)')
  console.log('  Pending regs: pending1@ / pending2@  (pro12345)')
}

module.exports = { seedDemoData }
