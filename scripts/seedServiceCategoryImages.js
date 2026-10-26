/**
 * Separate unique related images for EVERY service and EVERY category.
 * Service and category never share a URL (even with the same name).
 *
 * Usage: node scripts/seedServiceCategoryImages.js
 */
const prisma = require('../src/config/db')

const u = (id) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=80`

/** Large unique Unsplash ID bank (will be live-validated; bad ones skipped). */
const BANK = [
  // trades / home
  'photo-1473968512647-3e447244af8f',
  'photo-1436491865332-7a61a109cc05',
  'photo-1558002038-1055907df827',
  'photo-1487754180451-c456f719a1fc',
  'photo-1584622650111-993a426fbf0a',
  'photo-1560250097-0b93528c311a',
  'photo-1503387762-592deb58ef4e',
  'photo-1570125909232-eb263c188f7e',
  'photo-1601362840469-51e4d8d58785',
  'photo-1504148455328-c376907d081c',
  'photo-1558618666-fcd25c85cd64',
  'photo-1557597774-9d273605dfa9',
  'photo-1581578731548-c64695cc6952',
  'photo-1517694712202-14dd9538aa97',
  'photo-1586281380349-632531db7ed4',
  'photo-1558494949-ef010cbdcc31',
  'photo-1554224155-6726b3ff858f',
  'photo-1561070791-2526d30994b5',
  'photo-1589829545856-d10d557cf95f',
  'photo-1552053831-71594a27632d',
  'photo-1544568100-847a948585b9',
  'photo-1607472586893-edb57bdc0e39',
  'photo-1600585154340-be6161a56a0c',
  'photo-1455390582262-044cdead277a',
  'photo-1621905251189-08b45d6a269e',
  'photo-1450101499163-c8848c66ca85',
  'photo-1521791136064-7986c2920216',
  'photo-1554224155-8d04cb21cd6c',
  'photo-1490750967868-88aa4486c946',
  'photo-1416879595882-3373a0480b5b',
  'photo-1621905252507-b35492cc74b4',
  'photo-1558655146-9f40138edfeb',
  'photo-1560066984-138dadb4c035',
  'photo-1504328345606-18bbc8c9d7d1',
  'photo-1563986768609-322da13575f3',
  'photo-1529156069898-49953e39b3ac',
  'photo-1551836022-d5d88e9218df',
  'photo-1454165804606-c3d57bc86b40',
  'photo-1486406146926-c627a92ad1ab',
  'photo-1556909114-f6e7ad7d3136',
  'photo-1570172619644-dfd03ed5d881',
  'photo-1517245386807-bb43f82c33c4',
  'photo-1549317661-bd32c8ce0db2',
  'photo-1553062407-98eeb64c6a62',
  'photo-1516589178581-6cd7833ae3b2',
  'photo-1511707171634-5f897ff02aa9',
  'photo-1451187580459-43490279c0fa',
  'photo-1562259949-e8e7689d7828',
  'photo-1534438327276-14e5300c3a48',
  'photo-1509099836639-18ba1795216d',
  'photo-1516734212186-a967f81ad0d7',
  'photo-1585771724684-38269d6639fd',
  'photo-1502920917128-1aa500764cbd',
  'photo-1504307651254-35680f356dfd',
  'photo-1581092918056-0c4c3acd3789',
  'photo-1497366216548-37526070297c',
  'photo-1560518883-ce09059eeffa',
  'photo-1573497019940-1c28c88b4f3e',
  'photo-1600518464441-9154a4dea21b',
  'photo-1632778149955-e80f8ceca2e8',
  'photo-1504917595217-d4dc5ebe6122',
  'photo-1549298916-b41d501d3772',
  'photo-1461749280684-dccba630e2f6',
  'photo-1517842645767-c639042777db',
  'photo-1598371839696-5c5bb00bdc28',
  'photo-1423666639041-f56000c27a9a',
  'photo-1581858726788-75bc0f6a952d',
  'photo-1434030216411-0b793f4b4173',
  'photo-1542601906990-b4d3fb778b09',
  'photo-1619642751034-765dfdf7c58e',
  'photo-1449965408869-eaa3f722e40d',
  'photo-1486262715619-67b85e0b08d3',
  'photo-1492144534655-ae79c964c9d7',
  'photo-1450778869180-41d0601e046e',
  'photo-1498050108023-c5249f4df085',
  'photo-1486312338219-ce68d2c6f44d',
  'photo-1471107340929-a87cd0f5b5f3',
  'photo-1493809842364-78817add7ffb',
  'photo-1516414447565-b14be0adf13e',
  // more unique related / lifestyle / trade extras
  'photo-1552321554-5fefe8c9ef14',
  'photo-1507652313519-d4e9174996dd',
  'photo-1541888946425-d81bb19240f5',
  'photo-1486006920555-c77dcf18193c',
  'photo-1452860606245-08befc0ff44b',
  'photo-1586023492125-27b2c045efd7',
  'photo-1527515637462-cff94eecc1ac',
  'photo-1519389950473-47ba0277781c',
  'photo-1587300003388-59208cc962cb',
  'photo-1530281700549-e82e7bf110d6',
  'photo-1600566753086-00f18fb6b3ea',
  'photo-1487530817652-a8ca5c9b9d5d',
  'photo-1466692476866-aef1dfb1e735',
  'photo-1581092160562-40aa08e78837',
  'photo-1522335789203-aabd1fc54bc9',
  'photo-1550751827-4bd374c3f58b',
  'photo-1556911220-bff31c812dba',
  'photo-1484154218962-a197022b5858',
  'photo-1515377905703-c4788e51af15',
  'photo-1520607162513-77705c0f0d4a',
  'photo-1512941937669-90a1b58e7e9c',
  'photo-1517836357463-d25dfeac3438',
  'photo-1601758228041-f3b2795255f1',
  'photo-1492691527719-9d1e07e534b4',
  'photo-1600585154526-990dced4db0d',
  'photo-1573496359142-b8d87734a5a2',
  'photo-1600880292203-757bb62b4baf',
  'photo-1600607687644-c7171b42498f',
  'photo-1460353581641-37baddab0fa2',
  'photo-1516321318423-f06f85e504b3',
  'photo-1600607687939-ce8a6c25118c',
  'photo-1441974231531-c6227db76b6e',
  'photo-1503376780353-7e6692767b70',
  'photo-1497366754035-f200968a6e72',
  'photo-1497215728101-856f4ea42174',
  'photo-1560179707-f14e90ef3623',
  'photo-1556761175-5973dc0f32e7',
  'photo-1522071820081-009f0129c71c',
  'photo-1552664730-d307ca884978',
  'photo-1542744173-8e2bd11589fe',
  'photo-1573164713714-d95e436ab8d6',
  'photo-1460925895917-afdab827c52f',
  'photo-1559136555-9303baea8ebd',
  'photo-1470225620780-dba8ba36b745',
  'photo-1566576721346-d4a3b4eaeb55',
  'photo-1503454537195-1dcabb73ffb9',
  'photo-1555041469-a586c61ea9bc',
  'photo-1509391366360-2e959784a276',
  'photo-1556761175-4b46a572b786',
  'photo-1556761175-b413da4baf72',
  'photo-1600210492486-724fe5c67fb0',
  'photo-1600573472591-ee6981cf4217',
  'photo-1600566752355-35792bedcfea',
  'photo-1600585154363-67eb9e2e2099',
  'photo-1613490493576-7fde63acd811',
  'photo-1615874959474-d609969a20ed',
  'photo-1618221195710-dd6b41faaea6',
  'photo-1616486338812-3dadae4b4ace',
  'photo-1617806118233-18e1de247200',
  'photo-1615529328331-f8917597711f',
  'photo-1616046229478-9901c5536a45',
  'photo-1618220179428-22790b461013',
  'photo-1620626011761-996317b8d101',
  'photo-1622372738946-100db90181df',
  'photo-1631679706909-1844bbd07221',
  'photo-1632829882891-5047ccc421bc',
  'photo-1631049307264-da0ec9d70304',
  'photo-1488521787991-ed7bbaae773c',
  'photo-1521737711867-e3b97375f902',
  'photo-1553877522-43269d4ea984',
  'photo-1556155092-490a1ba16284',
  'photo-1560264280-88b68371db39',
  'photo-1497215842964-222b430dc094',
  'photo-1432888622747-4eb9a8f2c293',
  'photo-1507003211169-0a1dd7228f2d',
  'photo-1515378791036-0648a3ef77b2',
  'photo-1556740749-887f6717d7e4',
  'photo-1556745757-8d76bdb6984b',
  'photo-1542744094-3a31f272c490',
  'photo-1560264280-88b68371db39',
  'photo-1557804506-669a709abc7d',
  'photo-1522202176988-66273c2fd55f',
  'photo-1556761175-b413da4baf72',
  'photo-1507679799987-4e66965b9e63',
  'photo-1436076863939-06870fe779c0',
  'photo-1540962351504-3440a1869792',
  'photo-1508610048659-a06b669e3321',
  'photo-1557324232-b8917d3c3dcb',
  'photo-1517836357463-d25dfeac3438',
]

/** Ranked keyword themes → preferred photo IDs (subset of BANK). */
const THEME_PREFS = [
  [/drone|aerial/i, ['photo-1473968512647-3e447244af8f', 'photo-1508610048659-a06b669e3321']],
  [/airport|limousine|chauffeur/i, ['photo-1436491865332-7a61a109cc05', 'photo-1540962351504-3440a1869792', 'photo-1549317661-bd32c8ce0db2']],
  [/alarm|cctv|security/i, ['photo-1558002038-1055907df827', 'photo-1557597774-9d273605dfa9', 'photo-1557324232-b8917d3dcb']],
  [/investigat|detective|fraud|cheating|following/i, ['photo-1497366216548-37526070297c', 'photo-1557597774-9d273605dfa9', 'photo-1563986768609-322da13575f3']],
  [/bodyguard|protection/i, ['photo-1560250097-0b93528c311a', 'photo-1507003211169-0a1dd7228f2d']],
  [/auto.?electric|mechanic|bodyshop|tint|car.?trac|vehicle/i, ['photo-1486262715619-67b85e0b08d3', 'photo-1487754180451-c456f719a1fc', 'photo-1619642751034-765dfdf7c58e', 'photo-1492144534655-ae79c964c9d7', 'photo-1449965408869-eaa3f722e40d']],
  [/bathroom/i, ['photo-1584622650111-993a426fbf0a', 'photo-1552321554-5fefe8c9ef14', 'photo-1507652313519-d4e9174996dd']],
  [/plumb|drain/i, ['photo-1581092918056-0c4c3acd3789', 'photo-1607472586893-edb57bdc0e39']],
  [/build|scaffold|plaster|roof|tiler|handyman/i, ['photo-1503387762-592deb58ef4e', 'photo-1504307651254-35680f356dfd', 'photo-1541888946425-d81bb19240f5', 'photo-1632778149955-e80f8ceca2e8', 'photo-1504917595217-d4dc5ebe6122', 'photo-1581858726788-75bc0f6a952d', 'photo-1504328345606-18bbc8c9d7d1']],
  [/bus|coach/i, ['photo-1570125909232-eb263c188f7e', 'photo-1449965408869-eaa3f722e40d']],
  [/valet|car.?clean/i, ['photo-1601362840469-51e4d8d58785', 'photo-1486006920555-c77dcf18193c']],
  [/carpenter|joiner/i, ['photo-1504148455328-c376907d081c', 'photo-1452860606245-08befc0ff44b']],
  [/carpet|clean/i, ['photo-1558618666-fcd25c85cd64', 'photo-1581578731548-c64695cc6952', 'photo-1527515637462-cff94eecc1ac', 'photo-1586023492125-27b2c045efd7']],
  [/computer|software|web|network|data|phone|tablet|it/i, ['photo-1517694712202-14dd9538aa97', 'photo-1498050108023-c5249f4df085', 'photo-1461749280684-dccba630e2f6', 'photo-1558494949-ef010cbdcc31', 'photo-1451187580459-43490279c0fa', 'photo-1511707171634-5f897ff02aa9', 'photo-1585771724684-38269d6639fd', 'photo-1519389950473-47ba0277781c']],
  [/cv|writ|edit|translat|copywrit/i, ['photo-1586281380349-632531db7ed4', 'photo-1455390582262-044cdead277a', 'photo-1486312338219-ce68d2c6f44d', 'photo-1516414447565-b14be0adf13e', 'photo-1471107340929-a87cd0f5b5f3', 'photo-1434030216411-0b793f4b4173']],
  [/solicitor|lawyer|law|will|estate|divorce|immigration|patent|court/i, ['photo-1589829545856-d10d557cf95f', 'photo-1450101499163-c8848c66ca85', 'photo-1521791136064-7986c2920216', 'photo-1529156069898-49953e39b3ac', 'photo-1454165804606-c3d57bc86b40', 'photo-1486406146926-c627a92ad1ab']],
  [/dog.?train/i, ['photo-1552053831-71594a27632d', 'photo-1587300003388-59208cc962cb']],
  [/dog.?walk/i, ['photo-1544568100-847a948585b9', 'photo-1530281700549-e82e7bf110d6']],
  [/pet|vet|groom/i, ['photo-1450778869180-41d0601e046e', 'photo-1516734212186-a967f81ad0d7', 'photo-1601758228041-f3b2795255f1']],
  [/driveway|patio|garden|tree/i, ['photo-1600585154340-be6161a56a0c', 'photo-1416879595882-3373a0480b5b', 'photo-1542601906990-b4d3fb778b09', 'photo-1466692476866-aef1dfb1e735', 'photo-1441974231531-c6227db76b6e']],
  [/electric/i, ['photo-1621905251189-08b45d6a269e', 'photo-1621905252507-b35492cc74b4']],
  [/gas|boiler|heat/i, ['photo-1621905252507-b35492cc74b4', 'photo-1581092160562-40aa08e78837']],
  [/financial|advisor|debt/i, ['photo-1554224155-6726b3ff858f', 'photo-1554224155-8d04cb21cd6c']],
  [/florist/i, ['photo-1490750967868-88aa4486c946', 'photo-1487530817652-a8ca5c9b9d5d']],
  [/graphic|design|print|brand|stationer/i, ['photo-1561070791-2526d30994b5', 'photo-1558655146-9f40138edfeb', 'photo-1517842645767-c639042777db']],
  [/hair|tattoo|laser|beauty/i, ['photo-1560066984-138dadb4c035', 'photo-1598371839696-5c5bb00bdc28', 'photo-1570172619644-dfd03ed5d881', 'photo-1522335789203-aabd1fc54bc9']],
  [/kitchen/i, ['photo-1556909114-f6e7ad7d3136', 'photo-1556911220-bff31c812dba', 'photo-1484154218962-a197022b5858']],
  [/coach|life.?coach|psycholog|therapist|counsel/i, ['photo-1517245386807-bb43f82c33c4', 'photo-1551836022-d5d88e9218df', 'photo-1573497019940-1c28c88b4f3e', 'photo-1516589178581-6cd7833ae3b2']],
  [/locksmith/i, ['photo-1553062407-98eeb64c6a62', 'photo-1520607162513-77705c0f0d4a']],
  [/painter|decorat/i, ['photo-1562259949-e8e7689d7828']],
  [/train|fitness|gym/i, ['photo-1534438327276-14e5300c3a48', 'photo-1517836357463-d25dfeac3438']],
  [/pest/i, ['photo-1509099836639-18ba1795216d']],
  [/photograph|wedding/i, ['photo-1502920917128-1aa500764cbd', 'photo-1492691527719-9d1e07e534b4']],
  [/removal|mover/i, ['photo-1600518464441-9154a4dea21b']],
  [/property|window.?fit/i, ['photo-1560518883-ce09059eeffa', 'photo-1493809842364-78817add7ffb', 'photo-1600585154526-990dced4db0d']],
  [/shoe/i, ['photo-1549298916-b41d501d3772', 'photo-1460353581641-37baddab0fa2']],
  [/telephone/i, ['photo-1423666639041-f56000c27a9a', 'photo-1516321318423-f06f85e504b3']],
  [/cyber|identity.?theft/i, ['photo-1563986768609-322da13575f3', 'photo-1550751827-4bd374c3f58b']],
]

function preferredIdsFor(name) {
  const n = String(name || '')
  const out = []
  for (const [re, ids] of THEME_PREFS) {
    if (re.test(n)) out.push(...ids)
  }
  return out
}

function picsum(key) {
  return `https://picsum.photos/seed/${encodeURIComponent(String(key).slice(0, 80))}/900/560`
}

async function liveOk(url) {
  if (url.includes('picsum.photos')) return true
  try {
    const res = await fetch(url.replace('w=900', 'w=60').replace('q=80', 'q=40'), {
      redirect: 'follow',
    })
    return res.ok
  } catch {
    return false
  }
}

async function main() {
  // Validate bank once
  console.log('Validating image bank…')
  const goodUrls = []
  const seenId = new Set()
  for (const id of BANK) {
    if (seenId.has(id)) continue
    seenId.add(id)
    const url = u(id)
    if (await liveOk(url)) goodUrls.push(url)
  }
  console.log(`Usable Unsplash images: ${goodUrls.length}/${seenId.size}`)

  const available = new Set(goodUrls)

  function takeRelated(name, key) {
    const prefs = preferredIdsFor(name).map(u)
    for (const url of prefs) {
      if (available.has(url)) {
        available.delete(url)
        return url
      }
    }
    // any remaining related-ish from bank
    for (const url of available) {
      available.delete(url)
      return url
    }
    // picsum last resort (always unique by key)
    return picsum(key)
  }

  const [services, categories] = await Promise.all([
    prisma.service.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.category.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ])

  // Services first, then categories — separate takes → never share
  const svcMap = new Map()
  for (const s of services) {
    svcMap.set(s.id, takeRelated(s.name, `svc-${s.id}`))
  }
  const catMap = new Map()
  for (const c of categories) {
    catMap.set(c.id, takeRelated(c.name, `cat-${c.id}`))
  }

  for (const s of services) {
    await prisma.service.update({ where: { id: s.id }, data: { imageUrl: svcMap.get(s.id) } })
  }
  for (const c of categories) {
    await prisma.category.update({ where: { id: c.id }, data: { imageUrl: catMap.get(c.id) } })
  }

  // Verify
  const [sRows, cRows] = await Promise.all([
    prisma.service.findMany({
      where: { isActive: true },
      select: { name: true, imageUrl: true },
      orderBy: { name: 'asc' },
    }),
    prisma.category.findMany({
      where: { isActive: true },
      select: { name: true, imageUrl: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const owners = new Map()
  for (const r of sRows) {
    const list = owners.get(r.imageUrl) || []
    list.push(`S:${r.name}`)
    owners.set(r.imageUrl, list)
  }
  for (const r of cRows) {
    const list = owners.get(r.imageUrl) || []
    list.push(`C:${r.name}`)
    owners.set(r.imageUrl, list)
  }
  const dupes = [...owners.entries()].filter(([, list]) => list.length > 1)

  let sameNameDifferent = 0
  let sameNameSame = 0
  for (const s of sRows) {
    const c = cRows.find((x) => x.name.trim().toLowerCase() === s.name.trim().toLowerCase())
    if (!c) continue
    if (s.imageUrl === c.imageUrl) sameNameSame++
    else sameNameDifferent++
  }

  console.log(`Services updated: ${services.length}`)
  console.log(`Categories updated: ${categories.length}`)
  console.log(`Active unique URLs: ${owners.size} / ${sRows.length + cRows.length}`)
  console.log(`Duplicate groups: ${dupes.length}`)
  console.log(`Same-name pairs with SEPARATE images: ${sameNameDifferent}`)
  console.log(`Same-name pairs still sharing: ${sameNameSame}`)
  if (dupes.length) {
    for (const [url, list] of dupes.slice(0, 20)) console.log(' DUPE', list.join(' | '))
    process.exitCode = 1
  } else {
    console.log('OK: services and categories each have separate unique related images.')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
