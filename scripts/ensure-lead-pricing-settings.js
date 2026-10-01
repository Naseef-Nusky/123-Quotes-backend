require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

const DEFAULT_TIERS = [
  { afterViews: 0, tokenCost: 1 },
  { afterViews: 5, tokenCost: 2 },
]

async function main() {
  await p.setting.upsert({
    where: { key: 'default_unlock_token_cost' },
    create: { key: 'default_unlock_token_cost', value: 1 },
    update: {},
  })
  await p.setting.upsert({
    where: { key: 'max_unlocks_per_lead' },
    create: { key: 'max_unlocks_per_lead', value: 0 },
    update: {},
  })
  await p.setting.upsert({
    where: { key: 'unlock_token_tiers' },
    create: { key: 'unlock_token_tiers', value: DEFAULT_TIERS },
    update: {},
  })
  const rows = await p.setting.findMany({
    where: {
      key: {
        in: [
          'default_unlock_token_cost',
          'max_unlocks_per_lead',
          'unlock_token_tiers',
          'lead_view_locked',
        ],
      },
    },
  })
  console.log(JSON.stringify(rows, null, 2))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => p.$disconnect())
