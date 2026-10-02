require('dotenv').config()
const express = require('express')
const cors = require('cors')
const morgan = require('morgan')
const { connectDB } = require('./config/db')

const authRoutes = require('./routes/authRoutes')
const serviceRoutes = require('./routes/serviceRoutes')
const questionRoutes = require('./routes/questionRoutes')
const requestRoutes = require('./routes/requestRoutes')
const leadRoutes = require('./routes/leadRoutes')
const professionalRoutes = require('./routes/professionalRoutes')
const adminRoutes = require('./routes/adminRoutes')
const contentRoutes = require('./routes/contentRoutes')
const postcodeRoutes = require('./routes/postcodeRoutes')

const app = express()
const PORT = process.env.PORT || 5000

const allowedOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

app.use(
  cors({
    origin(origin, callback) {
      // In production, require an explicit allow-list
      if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
        return callback(new Error('CLIENT_ORIGIN is not configured'))
      }
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true)
      }
      return callback(new Error('Not allowed by CORS'))
    },
  }),
)
app.use(express.json({ limit: '2mb' }))
app.use(morgan('dev'))

// Accurate client IP behind reverse proxies (needed for auth rate limits)
if (process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1)
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: '123-quotes-backend',
    stack: 'node-express-postgres',
  })
})

app.use('/api/auth', authRoutes)
app.use('/api/services', serviceRoutes)
app.use('/api/questions', questionRoutes)
app.use('/api/requests', requestRoutes)
app.use('/api/leads', leadRoutes)
app.use('/api/professionals', professionalRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/content', contentRoutes)
app.use('/api/postcodes', postcodeRoutes)

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' })
})

async function start() {
  try {
    await connectDB()

    const server = app.listen(PORT)

    server.on('listening', () => {
      console.log(`123 Quotes API running on http://localhost:${PORT}`)
    })

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(
          `Port ${PORT} is already in use. Stop the other process (only run one "npm run dev"), then try again.`,
        )
      } else {
        console.error('Server listen error:', err.message)
      }
      process.exit(1)
    })
  } catch {
    console.error('Server not started because database is not connected.')
    process.exit(1)
  }
}

start()
