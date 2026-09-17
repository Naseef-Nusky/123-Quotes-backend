require('dotenv').config()
const express = require('express')
const cors = require('cors')
const morgan = require('morgan')
const connectDB = require('./config/db')

const authRoutes = require('./routes/authRoutes')
const quoteRoutes = require('./routes/quoteRoutes')
const leadRoutes = require('./routes/leadRoutes')
const dashboardRoutes = require('./routes/dashboardRoutes')

const app = express()
const PORT = process.env.PORT || 5000

const allowedOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
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
app.use(express.json())
app.use(morgan('dev'))

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: '123-quotes-backend' })
})

app.use('/api/auth', authRoutes)
app.use('/api/quotes', quoteRoutes)
app.use('/api/leads', leadRoutes)
app.use('/api/dashboard', dashboardRoutes)

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(err.status || 500).json({
    message: err.message || 'Internal server error',
  })
})

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`API running on http://localhost:${PORT}`)
    })
  })
  .catch((err) => {
    console.error('Failed to start server:', err.message)
    process.exit(1)
  })
