/**
 * Import UK postal outcodes from data/uk-outcodes.csv
 * Source: https://github.com/gibbs/uk-postcodes (CC0)
 *
 * Usage: node scripts/importUkPostcodes.js
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const CSV_PATH = path.join(__dirname, '../data/uk-outcodes.csv')
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

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error('Missing file:', CSV_PATH)
    process.exit(1)
  }

  const raw = fs.readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '')
  const lines = raw.split(/\r?\n/).filter((l) => l.trim())
  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase())
  const idx = (name) => header.indexOf(name)

  const iOut = idx('postcode')
  const iLat = idx('latitude')
  const iLng = idx('longitude')
  const iTown = idx('town')
  const iRegion = idx('region')
  const iUkRegion = idx('uk_region')
  const iCountry = idx('country_string') >= 0 ? idx('country_string') : idx('country')

  if (iOut < 0) {
    console.error('CSV must include a postcode column')
    process.exit(1)
  }

  const seen = new Set()
  const rows = []
  for (let n = 1; n < lines.length; n++) {
    const cols = parseCsvLine(lines[n])
    const outcode = String(cols[iOut] || '')
      .trim()
      .toUpperCase()
    if (!outcode || seen.has(outcode)) continue
    seen.add(outcode)
    rows.push({
      outcode,
      town: iTown >= 0 ? cols[iTown] || null : null,
      region: iRegion >= 0 ? cols[iRegion] || null : null,
      ukRegion: iUkRegion >= 0 ? cols[iUkRegion] || null : null,
      country: iCountry >= 0 ? cols[iCountry] || null : null,
      latitude: iLat >= 0 && cols[iLat] ? Number(cols[iLat]) : null,
      longitude: iLng >= 0 && cols[iLng] ? Number(cols[iLng]) : null,
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
