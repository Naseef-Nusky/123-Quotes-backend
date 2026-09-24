const prisma = require('../config/db')
const { asyncHandler, ok, fail } = require('../utils/helpers')

/** Extract outward code from a full or partial UK postcode (e.g. SW1A 1AA → SW1A). */
function extractOutcode(input = '') {
  const cleaned = String(input)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
  if (!cleaned) return ''
  const parts = cleaned.split(' ')
  if (parts.length >= 2) return parts[0]
  // Unit postcode without space: last 3 chars are inward
  if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(cleaned)) {
    return cleaned.slice(0, -3)
  }
  return cleaned
}

const UK_POSTCODE_RE =
  /^(GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}|[A-Z]{1,2}\d[A-Z\d]?)$/i

function isValidFormat(postcode) {
  return UK_POSTCODE_RE.test(String(postcode).trim())
}

const suggest = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '')
    .trim()
    .toUpperCase()
  const take = Math.min(Number(req.query.limit) || 40, 100)

  const results = await prisma.ukOutcode.findMany({
    where: q
      ? {
          OR: [
            { outcode: { startsWith: q } },
            { town: { contains: q, mode: 'insensitive' } },
          ],
        }
      : undefined,
    orderBy: { outcode: 'asc' },
    take: q ? take : 80,
    select: {
      outcode: true,
      town: true,
      region: true,
      ukRegion: true,
      country: true,
      latitude: true,
      longitude: true,
    },
  })

  return ok(res, { results })
})

/** Full outcode list for selectable dropdown (cached on client). */
const list = asyncHandler(async (_req, res) => {
  const results = await prisma.ukOutcode.findMany({
    orderBy: { outcode: 'asc' },
    select: {
      outcode: true,
      town: true,
      region: true,
    },
  })
  return ok(res, { results })
})

const validate = asyncHandler(async (req, res) => {
  const postcode = String(req.query.postcode || req.body?.postcode || '').trim()
  if (!postcode) return fail(res, 'postcode is required')

  if (!isValidFormat(postcode)) {
    return ok(res, { valid: false, reason: 'Invalid UK postcode format' })
  }

  const outcode = extractOutcode(postcode)
  const row = await prisma.ukOutcode.findUnique({ where: { outcode } })

  if (!row) {
    return ok(res, {
      valid: false,
      reason: 'Postcode area not found',
      outcode,
    })
  }

  return ok(res, {
    valid: true,
    outcode: row.outcode,
    town: row.town,
    region: row.region,
    ukRegion: row.ukRegion,
    country: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
    formatted: postcode.toUpperCase().replace(/\s+/g, ' ').trim(),
  })
})

module.exports = { suggest, validate, list, extractOutcode, isValidFormat }
