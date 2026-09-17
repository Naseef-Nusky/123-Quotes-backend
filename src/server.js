require('dotenv').config()
const express = require('express')
const cors = require('cors')
const morgan = require('morgan')

const authRoutes = require('./routes/authRoutes')
const serviceRoutes = require('./routes/serviceRoutes')
const questionRoutes = require('./routes/questionRoutes')
const requestRoutes = require('./routes/requestRoutes')
const leadRoutes = require('./routes/leadRoutes')
const professionalRoutes = require('./routes/professionalRoutes')
const adminRoutes = require('./routes/adminRoutes')

const app = express()
const PORT = process.env.PORT || 5000

const allowedOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true)
      }
      return callback(new Error('Not allowed by CORS'))
    },
  }),
)
app.use(express.json({ limit: '2mb' }))
app.use(morgan('dev'))

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

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`123 Quotes API running on http://localhost:${PORT}`)
})
