const crypto = require('crypto')

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex')
}

module.exports = { slugify, randomToken }
