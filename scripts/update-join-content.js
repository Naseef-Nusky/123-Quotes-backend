require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const join = {
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
}

async function main() {
  const existing = await prisma.setting.findUnique({ where: { key: 'home_content' } })
  const value =
    existing?.value && typeof existing.value === 'object'
      ? { ...existing.value, join }
      : { join }
  await prisma.setting.upsert({
    where: { key: 'home_content' },
    create: { key: 'home_content', value },
    update: { value },
  })
  console.log('Join section updated in DB')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
