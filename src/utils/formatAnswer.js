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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Build branded HTML + plain-text Q&A blocks for lead notification emails.
 * @param {Array<{ question?: { label?: string, options?: any[] }, value?: any }>} answers
 */
function formatLeadAnswersForEmail(answers = []) {
  const rows = (answers || [])
    .map((a) => {
      const question = String(a.question?.label || a.question || '').trim()
      const value = formatAnswerValue(a.value, a.question?.options || []).trim()
      if (!question && !value) return null
      return { question: question || 'Question', value: value || '—' }
    })
    .filter(Boolean)

  if (!rows.length) {
    return { answersHtml: '', answersText: '' }
  }

  const answersText = rows.map((r) => `${r.question}: ${r.value}`).join('\n')

  const items = rows
    .map(
      (r, i) => `
        <tr>
          <td style="padding:12px 14px;border-top:${i === 0 ? '0' : '1px solid #e8f0f7'};">
            <p style="margin:0 0 4px;font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.02em;text-transform:uppercase;color:#64748b;">
              ${escapeHtml(r.question)}
            </p>
            <p style="margin:0;font-size:15px;line-height:1.55;font-weight:600;color:#0a3a7a;">
              ${escapeHtml(r.value)}
            </p>
          </td>
        </tr>`,
    )
    .join('')

  const answersHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;border:1px solid #d6e4f0;border-radius:10px;overflow:hidden;background:#fafcfe;">
      <tr>
        <td style="padding:12px 14px;background:#eef6fc;border-bottom:1px solid #d6e4f0;">
          <p style="margin:0;font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#0a3a7a;">
            Customer answers
          </p>
        </td>
      </tr>
      ${items}
    </table>`

  return { answersHtml, answersText }
}

module.exports = {
  formatAnswerValue,
  resolveOptionLabel,
  formatLeadAnswersForEmail,
  escapeHtml,
}
