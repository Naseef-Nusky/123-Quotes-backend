/**
 * Import UK postal outcodes from data/uk-outcodes.csv
 *
 * Supported sources:
 * - https://github.com/academe/UK-Postcodes (postcodes.csv)
 * - https://github.com/gibbs/uk-postcodes (CC0)
 *
 * Usage: node scripts/importUkPostcodes.js [path/to.csv]
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const CSV_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '../data/uk-outcodes.csv')
const BATCH = 500

function parseCsvLine(line) {
  const cols = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (ch === ',' && !inQuotes) {
      cols.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  cols.push(cur.trim())
  return cols
}

function firstIdx(header, names) {
  for (const name of names) {
    const i = header.indexOf(name)
    if (i >= 0) return i
  }
  return -1
}

function cell(cols, index) {
  if (index < 0) return null
  const v = String(cols[index] ?? '').trim()
  return v || null
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error('Missing file:', CSV_PATH)
    process.exit(1)
  }

  const raw = fs.readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '')
  const lines = raw.split(/\r?\n/).filter((l) => l.trim())
  // Skip Cursor/download metadata lines until the real CSV header
  let headerLine = 0
  while (
    headerLine < lines.length &&
    !parseCsvLine(lines[headerLine])
      .map((h) => h.toLowerCase())
      .includes('postcode')
  ) {
    headerLine++
  }
  if (headerLine >= lines.length) {
    console.error('CSV must include a postcode column')
    process.exit(1)
  }

  const header = parseCsvLine(lines[headerLine]).map((h) => h.toLowerCase())
  const iOut = firstIdx(header, ['postcode', 'outcode'])
  const iLat = firstIdx(header, ['latitude', 'lat'])
  const iLng = firstIdx(header, ['longitude', 'lng', 'lon'])
  // academe: city/county/region_name/country_name — gibbs: town/region/uk_region/country_string
  const iTown = firstIdx(header, ['town', 'city'])
  const iRegion = firstIdx(header, ['region', 'county'])
  const iUkRegion = firstIdx(header, ['uk_region', 'region_name', 'ukregion'])
  const iCountry = firstIdx(header, ['country_string', 'country_name', 'country'])

  if (iOut < 0) {
    console.error('CSV must include a postcode column')
    process.exit(1)
  }

  console.log(`Reading ${CSV_PATH}`)
  console.log(
    `Columns: outcode=${header[iOut]}, town=${header[iTown] || '-'}, region=${header[iRegion] || '-'}, ukRegion=${header[iUkRegion] || '-'}, country=${header[iCountry] || '-'}`,
  )

  const seen = new Set()
  const rows = []
  for (let n = headerLine + 1; n < lines.length; n++) {
    const cols = parseCsvLine(lines[n])
    const outcode = String(cols[iOut] || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
    if (!outcode || seen.has(outcode)) continue
    // Outcodes only (e.g. SW1A, BN2) — skip full unit postcodes if present
    if (!/^[A-Z]{1,2}\d[A-Z\d]?$/.test(outcode)) continue
    seen.add(outcode)
    const lat = cell(cols, iLat)
    const lng = cell(cols, iLng)
    rows.push({
      outcode,
      town: cell(cols, iTown),
      region: cell(cols, iRegion),
      ukRegion: cell(cols, iUkRegion),
      country: cell(cols, iCountry),
      latitude: lat != null && !Number.isNaN(Number(lat)) ? Number(lat) : null,
      longitude: lng != null && !Number.isNaN(Number(lng)) ? Number(lng) : null,
    })
  }

  console.log(`Clearing existing outcodes…`)
  await prisma.ukOutcode.deleteMany()

  console.log(`Importing ${rows.length} UK outcodes…`)
  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const result = await prisma.ukOutcode.createMany({
      data: chunk,
      skipDuplicates: true,
    })
    inserted += result.count
    process.stdout.write(`\r  ${Math.min(i + chunk.length, rows.length)}/${rows.length}`)
  }

  const total = await prisma.ukOutcode.count()
  console.log(`\nDone. Inserted ${inserted}. UkOutcode rows in DB: ${total}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
