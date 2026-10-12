/**
 * Resolve stored answer tokens (option id / value / label) to human-readable text.
 */
function resolveOptionLabel(token, options = []) {
  const t = String(token ?? '').trim()
  if (!t) return ''
  const opt = (options || []).find(
    (o) =>
      String(o.id) === t ||
      String(o.value ?? '').trim() === t ||
      String(o.label ?? '').trim() === t,
  )
  if (!opt) return t
  return String(opt.label || opt.value || t).trim()
}

function formatAnswerValue(raw, options = []) {
  if (raw == null) return ''
  if (Array.isArray(raw)) {
    return raw
      .map((v) => resolveOptionLabel(v, options))
      .filter(Boolean)
      .join(', ')
  }

  const s = String(raw).trim()
  if (!s) return ''

  // Multi-select answers are comma-separated tokens
  if (s.includes(',')) {
    return s
      .split(',')
      .map((part) => resolveOptionLabel(part.trim(), options))
      .filter(Boolean)
      .join(', ')
  }

  return resolveOptionLabel(s, options)
}

module.exports = { formatAnswerValue, resolveOptionLabel }
