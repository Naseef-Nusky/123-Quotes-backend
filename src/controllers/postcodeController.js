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
    // Allow format-valid postcodes even if not in the seeded outcode list (manual entry)
    return ok(res, {
      valid: true,
      outcode,
      custom: true,
      formatted: postcode.toUpperCase().replace(/\s+/g, ' ').trim(),
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

const OUTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?$/i

function normalizeOutcode(input = '') {
  return String(input)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function parseOptionalFloat(value) {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : NaN
}

function buildOutcodePayload(body = {}) {
  const outcode = normalizeOutcode(body.outcode)
  const town = body.town != null ? String(body.town).trim() || null : undefined
  const region = body.region != null ? String(body.region).trim() || null : undefined
  const ukRegion = body.ukRegion != null ? String(body.ukRegion).trim() || null : undefined
  const country = body.country != null ? String(body.country).trim() || null : undefined
  const latitude = body.latitude !== undefined ? parseOptionalFloat(body.latitude) : undefined
  const longitude = body.longitude !== undefined ? parseOptionalFloat(body.longitude) : undefined

  return { outcode, town, region, ukRegion, country, latitude, longitude }
}

/** Admin: searchable list of UK outcodes (includes id for CRUD). */
const adminList = asyncHandler(async (req, res) => {
  let q = String(req.query.q || '')
    .trim()
    .toUpperCase()
  // Guard against clients serializing undefined into the query string
  if (q === 'UNDEFINED' || q === 'NULL') q = ''
  const take = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500)
  const skip = Math.max(Number(req.query.skip) || 0, 0)

  const where = q
    ? {
        OR: [
          { outcode: { startsWith: q } },
          { town: { contains: q, mode: 'insensitive' } },
          { region: { contains: q, mode: 'insensitive' } },
          { ukRegion: { contains: q, mode: 'insensitive' } },
          { country: { contains: q, mode: 'insensitive' } },
        ],
      }
    : undefined

  const [results, total] = await Promise.all([
    prisma.ukOutcode.findMany({
      where,
      orderBy: { outcode: 'asc' },
      take,
      skip,
    }),
    prisma.ukOutcode.count({ where }),
  ])

  return ok(res, { results, total, take, skip })
})

const adminCreate = asyncHandler(async (req, res) => {
  const payload = buildOutcodePayload(req.body)
  if (!payload.outcode) return fail(res, 'outcode is required')
  if (!OUTCODE_RE.test(payload.outcode)) {
    return fail(res, 'Invalid UK outcode format (e.g. SW1A, BN2, EC1A)')
  }
  if (Number.isNaN(payload.latitude) || Number.isNaN(payload.longitude)) {
    return fail(res, 'latitude and longitude must be valid numbers')
  }

  const existing = await prisma.ukOutcode.findUnique({ where: { outcode: payload.outcode } })
  if (existing) return fail(res, `Outcode ${payload.outcode} already exists`, 409)

  const row = await prisma.ukOutcode.create({
    data: {
      outcode: payload.outcode,
      town: payload.town ?? null,
      region: payload.region ?? null,
      ukRegion: payload.ukRegion ?? null,
      country: payload.country ?? null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null,
    },
  })

  return ok(res, { outcode: row }, 201)
})

const adminUpdate = asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim()
  if (!id) return fail(res, 'id is required')

  const existing = await prisma.ukOutcode.findUnique({ where: { id } })
  if (!existing) return fail(res, 'Outcode not found', 404)

  const payload = buildOutcodePayload(req.body)
  if (payload.outcode && !OUTCODE_RE.test(payload.outcode)) {
    return fail(res, 'Invalid UK outcode format (e.g. SW1A, BN2, EC1A)')
  }
  if (Number.isNaN(payload.latitude) || Number.isNaN(payload.longitude)) {
    return fail(res, 'latitude and longitude must be valid numbers')
  }

  if (payload.outcode && payload.outcode !== existing.outcode) {
    const clash = await prisma.ukOutcode.findUnique({ where: { outcode: payload.outcode } })
    if (clash) return fail(res, `Outcode ${payload.outcode} already exists`, 409)
  }

  const data = {}
  if (payload.outcode) data.outcode = payload.outcode
  if (payload.town !== undefined) data.town = payload.town
  if (payload.region !== undefined) data.region = payload.region
  if (payload.ukRegion !== undefined) data.ukRegion = payload.ukRegion
  if (payload.country !== undefined) data.country = payload.country
  if (payload.latitude !== undefined) data.latitude = payload.latitude
  if (payload.longitude !== undefined) data.longitude = payload.longitude

  const row = await prisma.ukOutcode.update({ where: { id }, data })
  return ok(res, { outcode: row })
})

const adminDelete = asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim()
  if (!id) return fail(res, 'id is required')

  const existing = await prisma.ukOutcode.findUnique({ where: { id } })
  if (!existing) return fail(res, 'Outcode not found', 404)

  await prisma.ukOutcode.delete({ where: { id } })
  return ok(res, { deleted: true, id })
})

module.exports = {
  suggest,
  validate,
  list,
  adminList,
  adminCreate,
  adminUpdate,
  adminDelete,
  extractOutcode,
  isValidFormat,
}
