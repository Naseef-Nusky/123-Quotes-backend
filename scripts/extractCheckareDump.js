/**
 * Extract a Checkare/Hunto MySQL dump into scripts/.import-cache JSON/JSONL.
 *
 *   node scripts/extractCheckareDump.js /path/to/dump.sql
 *   node scripts/extractCheckareDump.js /path/to/dump.sql --with-postal
 */
const fs = require('fs')
const path = require('path')
const readline = require('readline')

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')))
const DUMP =
  args[0] || path.join(process.env.HOME || '', 'Downloads/checkare_hunto.sql')
const WITH_POSTAL = flags.has('--with-postal') || flags.has('--postal')
const CACHE = path.join(__dirname, '.import-cache')

const SMALL_TABLES = [
  'category',
  'cat_ans',
  'client_requ',
  'decline_leads',
  'leads_files',
  'options',
  'orders',
  'pro_files',
  'pro_meta',
  'pro_points',
  'reviews',
  'users',
]
const BIG_JSONL = ['leads', 'leads_meta']

function parseColumns(insertLine) {
  const m = insertLine.match(/INSERT INTO `[^`]+`\s*\(([^)]+)\)/i)
  if (!m) return null
  return m[1].split(',').map((c) => c.trim().replace(/`/g, ''))
}

/** Parse MySQL VALUES tuples into arrays of raw field strings. */
function parseTuples(chunk) {
  const rows = []
  let i = 0
  const s = chunk
  while (i < s.length) {
    while (i < s.length && (s[i] === ',' || s[i] === ';' || /\s/.test(s[i]))) i += 1
    if (i >= s.length) break
    if (s[i] !== '(') {
      i += 1
      continue
    }
    i += 1 // past (
    const fields = []
    while (i < s.length && s[i] !== ')') {
      while (i < s.length && /\s/.test(s[i])) i += 1
      if (s[i] === ')') break
      if (s[i] === "'") {
        i += 1
        let val = ''
        while (i < s.length) {
          if (s[i] === '\\' && i + 1 < s.length) {
            val += s[i + 1]
            i += 2
            continue
          }
          if (s[i] === "'") {
            if (s[i + 1] === "'") {
              val += "'"
              i += 2
              continue
            }
            i += 1
            break
          }
          val += s[i]
          i += 1
        }
        fields.push(val)
      } else {
        let raw = ''
        while (i < s.length && s[i] !== ',' && s[i] !== ')') {
          raw += s[i]
          i += 1
        }
        raw = raw.trim()
        if (raw.toUpperCase() === 'NULL') fields.push(null)
        else if (/^-?\d+(\.\d+)?$/.test(raw)) fields.push(Number(raw))
        else fields.push(raw)
      }
      while (i < s.length && /\s/.test(s[i])) i += 1
      if (s[i] === ',') i += 1
    }
    if (s[i] === ')') i += 1
    rows.push(fields)
  }
  return rows
}

function rowToObject(cols, fields) {
  const o = {}
  cols.forEach((c, idx) => {
    o[c] = fields[idx] !== undefined ? fields[idx] : null
  })
  return o
}

async function main() {
  if (!fs.existsSync(DUMP)) {
    throw new Error(`Dump not found: ${DUMP}`)
  }
  fs.mkdirSync(CACHE, { recursive: true })

  const buffers = Object.fromEntries(SMALL_TABLES.map((t) => [t, []]))
  const jsonlStreams = {}
  for (const t of BIG_JSONL) {
    const fp = path.join(CACHE, `${t}.jsonl`)
    fs.writeFileSync(fp, '')
    jsonlStreams[t] = fs.createWriteStream(fp, { flags: 'a' })
  }

  let currentTable = null
  let columns = null
  let inInsert = false
  let pending = ''
  const counts = Object.fromEntries([...SMALL_TABLES, ...BIG_JSONL].map((t) => [t, 0]))

  const rl = readline.createInterface({
    input: fs.createReadStream(DUMP, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  function flushPending(force = false) {
    if (!currentTable || !columns || !pending) return
    // complete tuples end with ), or );
    if (!force && !/\);\s*$/.test(pending) && !pending.includes('),(') && !/\),\s*$/.test(pending)) {
      // keep buffering until we see closing
      if (!pending.includes(')')) return
    }
    // take complete part
    let data = pending
    if (data.trim().toUpperCase().startsWith('VALUES')) {
      data = data.replace(/^\s*VALUES\s*/i, '')
    }
    // If still mid-tuple, keep incomplete suffix
    let cut = data
    const lastSemi = cut.lastIndexOf(';')
    if (lastSemi !== -1 && force) {
      cut = cut.slice(0, lastSemi)
      pending = ''
    } else if (!force) {
      // find last complete tuple end
      const lastClose = cut.lastIndexOf(')')
      if (lastClose === -1) return
      // keep remainder after last ),
      const complete = cut.slice(0, lastClose + 1)
      pending = cut.slice(lastClose + 1)
      cut = complete
    } else {
      pending = ''
    }

    const tuples = parseTuples(cut)
    for (const fields of tuples) {
      if (fields.length < columns.length) continue
      const obj = rowToObject(columns, fields)
      counts[currentTable] += 1
      if (SMALL_TABLES.includes(currentTable)) {
        buffers[currentTable].push(obj)
      } else if (jsonlStreams[currentTable]) {
        jsonlStreams[currentTable].write(`${JSON.stringify(obj)}\n`)
      }
    }
  }

  for await (const line of rl) {
    const create = line.match(/^CREATE TABLE `([^`]+)`/)
    if (create) {
      if (inInsert) flushPending(true)
      currentTable = create[1]
      columns = null
      inInsert = false
      pending = ''
      continue
    }

    if (!currentTable) continue
    if (![...SMALL_TABLES, ...BIG_JSONL].includes(currentTable)) continue

    if (line.startsWith('INSERT INTO')) {
      if (inInsert) flushPending(true)
      columns = parseColumns(line)
      inInsert = Boolean(columns)
      pending = ''
      const idx = line.indexOf('VALUES')
      if (idx !== -1) {
        pending = line.slice(idx)
        if (pending.includes(');') || pending.trim().endsWith('),') || pending.includes('),(')) {
          flushPending(false)
        }
      }
      continue
    }

    if (inInsert) {
      if (
        line.startsWith('--') ||
        line.startsWith('CREATE TABLE') ||
        line.startsWith('ALTER TABLE') ||
        line.startsWith('UNLOCK TABLES')
      ) {
        flushPending(true)
        inInsert = false
        continue
      }
      pending += (pending ? '\n' : '') + line
      if (line.includes(');') || line.trim().endsWith(',') || line.includes('),(')) {
        flushPending(line.includes(');'))
      }
    }
  }
  flushPending(true)

  for (const t of SMALL_TABLES) {
    fs.writeFileSync(path.join(CACHE, `${t}.json`), JSON.stringify(buffers[t], null, 0))
  }
  for (const s of Object.values(jsonlStreams)) {
    await new Promise((resolve) => s.end(resolve))
  }

  let postalSubsetCount = 0
  let outcodesCount = 0
  let postalScanned = 0

  if (WITH_POSTAL) {
    console.log('Extracting postal_codes (this can take a few minutes)…')
    const postalIds = new Set()
    const leadsPath = path.join(CACHE, 'leads.jsonl')
    if (fs.existsSync(leadsPath)) {
      for (const line of fs.readFileSync(leadsPath, 'utf8').split('\n')) {
        if (!line.trim()) continue
        const row = JSON.parse(line)
        if (row.postalcode_id) postalIds.add(String(row.postalcode_id))
      }
    }

    const postalMap = {}
    const outcodeSet = new Map()
    let postalMode = false
    let postalCols = null
    let postalPending = ''

    function flushPostal(force = false) {
      if (!postalCols || !postalPending) return
      let data = postalPending
      if (data.trim().toUpperCase().startsWith('VALUES')) {
        data = data.replace(/^\s*VALUES\s*/i, '')
      }
      let cut = data
      if (!force) {
        const lastClose = cut.lastIndexOf(')')
        if (lastClose === -1) return
        cut = cut.slice(0, lastClose + 1)
        postalPending = data.slice(lastClose + 1)
      } else {
        postalPending = ''
        const lastSemi = cut.lastIndexOf(';')
        if (lastSemi !== -1) cut = cut.slice(0, lastSemi)
      }
      for (const fields of parseTuples(cut)) {
        if (fields.length < postalCols.length) continue
        const obj = rowToObject(postalCols, fields)
        postalScanned += 1
        const id = String(obj.postal_id)
        if (postalIds.has(id)) postalMap[id] = obj
        const code = String(obj.code || obj.code2 || '')
          .trim()
          .toUpperCase()
        const outcode = code.split(/\s+/)[0] || code.slice(0, 4)
        if (outcode && !outcodeSet.has(outcode)) {
          outcodeSet.set(outcode, {
            outcode,
            town: obj.district || null,
            region: obj.ward || null,
            country: obj.Country || 'UK',
            latitude: obj.latitude != null ? Number(obj.latitude) : null,
            longitude: obj.longitude != null ? Number(obj.longitude) : null,
          })
        }
      }
      if (postalScanned % 200000 === 0) console.log('  postal rows scanned', postalScanned)
    }

    const rl2 = readline.createInterface({
      input: fs.createReadStream(DUMP, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    })

    for await (const line of rl2) {
      if (line.startsWith('CREATE TABLE `postal_codes`')) {
        postalMode = 'wait'
        continue
      }
      if (postalMode === 'wait' && line.startsWith('INSERT INTO `postal_codes`')) {
        postalMode = 'data'
        postalCols = parseColumns(line)
        const idx = line.indexOf('VALUES')
        if (idx !== -1) postalPending = line.slice(idx)
        continue
      }
      if (postalMode === 'data') {
        if (
          line.startsWith('CREATE TABLE') ||
          line.startsWith('-- Indexes') ||
          line.startsWith('ALTER TABLE')
        ) {
          flushPostal(true)
          postalMode = false
          continue
        }
        if (line.startsWith('INSERT INTO `postal_codes`')) {
          flushPostal(true)
          postalCols = parseColumns(line)
          const idx = line.indexOf('VALUES')
          postalPending = idx !== -1 ? line.slice(idx) : ''
          continue
        }
        postalPending += `\n${line}`
        if (line.includes(');') || line.trim().endsWith(',')) flushPostal(line.includes(');'))
      }
    }
    flushPostal(true)

    const outcodes = [...outcodeSet.values()]
    fs.writeFileSync(path.join(CACHE, 'postal_codes_subset.json'), JSON.stringify(postalMap))
    fs.writeFileSync(path.join(CACHE, 'uk_outcodes_full.json'), JSON.stringify(outcodes))
    postalSubsetCount = Object.keys(postalMap).length
    outcodesCount = outcodes.length
  } else {
    const postalSubsetPath = path.join(CACHE, 'postal_codes_subset.json')
    const outcodesPath = path.join(CACHE, 'uk_outcodes_full.json')
    postalSubsetCount = fs.existsSync(postalSubsetPath)
      ? Object.keys(JSON.parse(fs.readFileSync(postalSubsetPath, 'utf8'))).length
      : 0
    outcodesCount = fs.existsSync(outcodesPath)
      ? JSON.parse(fs.readFileSync(outcodesPath, 'utf8')).length
      : 0
  }

  const summary = {
    dump: DUMP,
    counts: {
      ...counts,
      postal_scanned: postalScanned,
      postal_subset: postalSubsetCount,
      outcodes: outcodesCount,
    },
  }
  fs.writeFileSync(path.join(CACHE, 'extract-summary.json'), JSON.stringify(summary, null, 2))
  console.log('Extract done →', CACHE)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
