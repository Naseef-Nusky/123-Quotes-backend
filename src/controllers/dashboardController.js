const Quote = require('../models/Quote')
const Lead = require('../models/Lead')

async function getStats(_req, res) {
  const [totalQuotes, publishedQuotes, totalLeads, newLeads, recentLeads] = await Promise.all([
    Quote.countDocuments(),
    Quote.countDocuments({ published: true }),
    Lead.countDocuments(),
    Lead.countDocuments({ status: 'new' }),
    Lead.find().sort({ createdAt: -1 }).limit(5),
  ])

  return res.json({
    totalQuotes,
    publishedQuotes,
    totalLeads,
    newLeads,
    recentLeads,
  })
}

module.exports = { getStats }
