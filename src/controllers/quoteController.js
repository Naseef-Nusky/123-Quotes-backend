const Quote = require('../models/Quote')

async function listPublic(req, res) {
  const filter = { published: true }
  if (req.query.category) {
    filter.category = req.query.category
  }

  const quotes = await Quote.find(filter).sort({ createdAt: -1 })
  return res.json({ quotes })
}

async function getPublic(req, res) {
  const quote = await Quote.findOne({ _id: req.params.id, published: true })
  if (!quote) {
    return res.status(404).json({ message: 'Quote not found' })
  }
  return res.json({ quote })
}

async function listAll(_req, res) {
  const quotes = await Quote.find().sort({ createdAt: -1 })
  return res.json({ quotes })
}

async function create(req, res) {
  const { text, author, category, published } = req.body
  if (!text || !author) {
    return res.status(400).json({ message: 'Text and author are required' })
  }

  const quote = await Quote.create({
    text,
    author,
    category,
    published: published !== undefined ? published : true,
  })

  return res.status(201).json({ quote })
}

async function update(req, res) {
  const quote = await Quote.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  })

  if (!quote) {
    return res.status(404).json({ message: 'Quote not found' })
  }

  return res.json({ quote })
}

async function remove(req, res) {
  const quote = await Quote.findByIdAndDelete(req.params.id)
  if (!quote) {
    return res.status(404).json({ message: 'Quote not found' })
  }
  return res.json({ message: 'Quote deleted' })
}

module.exports = {
  listPublic,
  getPublic,
  listAll,
  create,
  update,
  remove,
}
