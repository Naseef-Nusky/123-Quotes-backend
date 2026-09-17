require('dotenv').config()
const connectDB = require('./config/db')
const User = require('./models/User')
const Quote = require('./models/Quote')

async function seed() {
  await connectDB()

  const email = process.env.ADMIN_EMAIL || 'admin@123quotes.com'
  const existing = await User.findOne({ email })

  if (!existing) {
    await User.create({
      name: process.env.ADMIN_NAME || 'Admin',
      email,
      password: process.env.ADMIN_PASSWORD || 'admin123',
      role: 'admin',
    })
    console.log(`Admin created: ${email}`)
  } else {
    console.log(`Admin already exists: ${email}`)
  }

  const quoteCount = await Quote.countDocuments()
  if (quoteCount === 0) {
    await Quote.insertMany([
      {
        text: 'The only way to do great work is to love what you do.',
        author: 'Steve Jobs',
        category: 'motivation',
        published: true,
      },
      {
        text: 'Success is not final, failure is not fatal: it is the courage to continue that counts.',
        author: 'Winston Churchill',
        category: 'success',
        published: true,
      },
      {
        text: 'In the middle of every difficulty lies opportunity.',
        author: 'Albert Einstein',
        category: 'wisdom',
        published: true,
      },
      {
        text: 'Leadership is the capacity to translate vision into reality.',
        author: 'Warren Bennis',
        category: 'leadership',
        published: true,
      },
    ])
    console.log('Sample quotes inserted')
  } else {
    console.log('Quotes already exist, skipping sample data')
  }

  process.exit(0)
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
