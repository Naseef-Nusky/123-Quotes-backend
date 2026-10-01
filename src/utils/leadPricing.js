const prisma = require('../config/db')

const DEFAULT_UNLOCK_TOKEN_COST_KEY = 'default_unlock_token_cost'
const MAX_UNLOCKS_PER_LEAD_KEY = 'max_unlocks_per_lead'
const UNLOCK_TOKEN_TIERS_KEY = 'unlock_token_tiers'

async function getSettingNumber(key, fallback) {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null)
  if (!row || row.value == null || row.value === '') return fallback
  const n = Number(row.value)
  return Number.isFinite(n) ? n : fallback
}

async function getDefaultUnlockTokenCost() {
  const n = await getSettingNumber(DEFAULT_UNLOCK_TOKEN_COST_KEY, 1)
  return Math.max(1, Math.floor(n))
}

/** 0 = unlimited unlocks per lead */
async function getMaxUnlocksPerLead() {
  const n = await getSettingNumber(MAX_UNLOCKS_PER_LEAD_KEY, 0)
  return Math.max(0, Math.floor(n))
}

/**
 * Normalize CRM tier rows.
 * Preferred:
 *  [{ fromViews: 0, toViews: 4, tokenCost: 2 }, { fromViews: 5, toViews: null, tokenCost: 3 }]
 * Legacy:
 *  [{ afterViews: 0, tokenCost: 2 }, { afterViews: 5, tokenCost: 3 }]
 */
function normalizeUnlockTiers(raw, fallbackFreshCost = 1) {
  let list = raw
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list)
    } catch {
      list = null
    }
  }

  const fresh = Math.max(1, Math.floor(Number(fallbackFreshCost) || 1))
  if (!Array.isArray(list) || !list.length) {
    return [{ fromViews: 0, toViews: null, tokenCost: fresh, afterViews: 0 }]
  }

  // Legacy afterViews only
  if (list.some((t) => t.afterViews != null && t.fromViews == null)) {
    const points = list
      .map((t) => ({
        afterViews: Math.max(0, Math.floor(Number(t.afterViews) || 0)),
        tokenCost: Math.max(1, Math.floor(Number(t.tokenCost) || 1)),
      }))
      .sort((a, b) => a.afterViews - b.afterViews)
    const byView = new Map()
    for (const t of points) byView.set(t.afterViews, t)
    const sorted = [...byView.values()].sort((a, b) => a.afterViews - b.afterViews)
    if (!sorted.some((t) => t.afterViews === 0)) {
      sorted.unshift({ afterViews: 0, tokenCost: fresh })
    }
    return sorted.map((t, i) => {
      const next = sorted[i + 1]
      return {
        fromViews: t.afterViews,
        toViews: next ? next.afterViews - 1 : null,
        tokenCost: t.tokenCost,
        afterViews: t.afterViews,
      }
    })
  }

  const tiers = list
    .map((t) => {
      const fromViews = Math.max(0, Math.floor(Number(t.fromViews ?? t.afterViews) || 0))
      let toViews = t.toViews
      if (toViews === '' || toViews == null) toViews = null
      else toViews = Math.max(fromViews, Math.floor(Number(toViews) || 0))
      return {
        fromViews,
        toViews,
        tokenCost: Math.max(1, Math.floor(Number(t.tokenCost) || 1)),
        afterViews: fromViews,
      }
    })
    .sort((a, b) => a.fromViews - b.fromViews)

  if (!tiers.some((t) => t.fromViews === 0)) {
    tiers.unshift({ fromViews: 0, toViews: null, tokenCost: fresh, afterViews: 0 })
  }

  // Dedupe by fromViews (keep last)
  const byFrom = new Map()
  for (const t of tiers) byFrom.set(t.fromViews, t)
  return [...byFrom.values()].sort((a, b) => a.fromViews - b.fromViews)
}

async function getUnlockTokenTiers() {
  const defaultCost = await getDefaultUnlockTokenCost()
  const row = await prisma.setting.findUnique({ where: { key: UNLOCK_TOKEN_TIERS_KEY } }).catch(() => null)
  return normalizeUnlockTiers(row?.value, defaultCost)
}

/** Cost for the next unlock given how many professionals already unlocked. */
function costFromUnlockTiers(unlockedCount, tiers) {
  const count = Math.max(0, Math.floor(Number(unlockedCount) || 0))
  const list = normalizeUnlockTiers(tiers, 1)
  let matched = list[0].tokenCost
  for (const tier of list) {
    const inRange =
      count >= tier.fromViews && (tier.toViews == null || count <= tier.toViews)
    if (inRange) matched = tier.tokenCost
  }
  // If no inclusive match (gap), use last tier whose fromViews <= count
  if (!list.some((t) => count >= t.fromViews && (t.toViews == null || count <= t.toViews))) {
    for (const tier of list) {
      if (count >= tier.fromViews) matched = tier.tokenCost
    }
  }
  return matched
}

/** True when lead has its own saved unlock tiers (not using platform defaults). */
function getLeadCustomUnlockTiers(lead) {
  let raw = lead?.unlockTiers
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      raw = null
    }
  }
  if (!Array.isArray(raw) || !raw.length) return null
  return normalizeUnlockTiers(raw, 1)
}

function resolveLeadTokenCost({ leadTokenCost, serviceTokenCost, defaultCost = 1 } = {}) {
  const fromLead = Number(leadTokenCost)
  if (Number.isFinite(fromLead) && fromLead > 0) return Math.floor(fromLead)

  const fromService = Number(serviceTokenCost)
  if (Number.isFinite(fromService) && fromService > 0) return Math.floor(fromService)

  const fromDefault = Number(defaultCost)
  if (Number.isFinite(fromDefault) && fromDefault > 0) return Math.floor(fromDefault)

  return 1
}

/**
 * Unlock charge:
 * 1. If this lead has individual unlockTiers → use those
 * 2. Else use common Default Token Adjust (platform unlock_token_tiers)
 */
async function resolveUnlockCostForLead(lead, { forceFixed = false } = {}) {
  const unlockedCount = lead?.unlockedCount || 0

  if (forceFixed) {
    const defaultCost = await getDefaultUnlockTokenCost()
    return resolveLeadTokenCost({
      leadTokenCost: lead?.tokenCost,
      serviceTokenCost: lead?.service?.tokenCost,
      defaultCost,
    })
  }

  const leadTiers = getLeadCustomUnlockTiers(lead)
  if (leadTiers) {
    return costFromUnlockTiers(unlockedCount, leadTiers)
  }

  const tiers = await getUnlockTokenTiers()
  return costFromUnlockTiers(unlockedCount, tiers)
}

module.exports = {
  DEFAULT_UNLOCK_TOKEN_COST_KEY,
  MAX_UNLOCKS_PER_LEAD_KEY,
  UNLOCK_TOKEN_TIERS_KEY,
  getDefaultUnlockTokenCost,
  getMaxUnlocksPerLead,
  getUnlockTokenTiers,
  normalizeUnlockTiers,
  costFromUnlockTiers,
  getLeadCustomUnlockTiers,
  resolveLeadTokenCost,
  resolveUnlockCostForLead,
}
