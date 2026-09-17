const Lead = require('../models/Lead')

async function createPublic(req, res) {
  const { name, email, phone, company, message } = req.body

  if (!name || !email || !message) {
    return res.status(400).json({ message: 'Name, email, and message are required' })
  }

  const lead = await Lead.create({ name, email, phone, company, message })
  return res.status(201).json({ lead, message: 'Lead submitted' })
}

async function listAll(_req, res) {
  const leads = await Lead.find().sort({ createdAt: -1 })
  return res.json({ leads })
}

async function update(req, res) {
  const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  })

  if (!lead) {
    return res.status(404).json({ message: 'Lead not found' })
  }

  return res.json({ lead })
}

async function remove(req, res) {
  const lead = await Lead.findByIdAndDelete(req.params.id)
  if (!lead) {
    return res.status(404).json({ message: 'Lead not found' })
  }
  return res.json({ message: 'Lead deleted' })
}

module.exports = {
  createPublic,
  listAll,
  update,
  remove,
}
