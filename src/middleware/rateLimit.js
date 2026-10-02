/**
 * Simple in-memory rate limiter for auth endpoints.
 * Not shared across processes — fine for single-node; use Redis in multi-instance prod.
 */
function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 20, message } = {}) {
  const hits = new Map()

  function keyFor(req) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown'
    const email = String(req.body?.email || '')
      .toLowerCase()
      .trim()
      .slice(0, 120)
    return `${ip}|${email}|${req.path}`
  }

  return function rateLimit(req, res, next) {
    const now = Date.now()
    const key = keyFor(req)
    let entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs }
      hits.set(key, entry)
    }
    entry.count += 1

    // Opportunistic cleanup
    if (hits.size > 5000) {
      for (const [k, v] of hits) {
        if (v.resetAt <= now) hits.delete(k)
      }
    }

    res.setHeader('X-RateLimit-Limit', String(max))
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)))

    if (entry.count > max) {
      return res.status(429).json({
        message: message || 'Too many attempts. Please try again later.',
      })
    }
    return next()
  }
}

module.exports = { createRateLimiter }
