require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const hire = {
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
}

async function main() {
  const existing = await prisma.setting.findUnique({ where: { key: 'home_content' } })
  const value =
    existing?.value && typeof existing.value === 'object'
      ? { ...existing.value, hire: { ...(existing.value.hire || {}), ...hire, steps: hire.steps } }
      : { hire }
  await prisma.setting.upsert({
    where: { key: 'home_content' },
    create: { key: 'home_content', value },
    update: { value },
  })
  console.log('Hire section content updated in DB')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
