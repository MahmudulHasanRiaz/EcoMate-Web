// Fix 5: thread the backend's shaped dispatch error
// ({courier, status, message, errors, orderId}) into toasts that name the
// EXACT field+rule — e.g. "Pathao: recipient_name must be 3–100 chars".
// The backend already embeds `field 'x' <rule>` segments in `message`
// (`Head — field 'a' ruleA; field 'b' ruleB`); this splits them into
// readable lines and appends bulk code lists, without duplicating lines.

export interface CourierDispatchFailure {
  id?: string
  orderId?: string
  message?: string
  courier?: string
  status?: number
  errors?: Record<string, unknown>
}

function ruleText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const first = value[0]
    if (typeof first === 'string') return first
    if (first && typeof first === 'object')
      return (
        (first as Record<string, unknown>)['type'] as string ??
        JSON.stringify(first).slice(0, 160)
      )
    return String(first ?? '')
  }
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    return (rec['type'] as string) ?? JSON.stringify(value).slice(0, 160)
  }
  return String(value ?? '')
}

/** One line per fact: head message, then each `field 'x' <rule>`, then codes. */
export function formatCourierFieldLines(
  r: CourierDispatchFailure,
): string[] {
  const msg = (r.message || '').trim()
  const lines: string[] = []
  if (msg) {
    const sep = msg.indexOf(' — ')
    if (sep >= 0) {
      lines.push(msg.slice(0, sep).trim())
      for (const seg of msg.slice(sep + 3).split(';')) {
        const s = seg.trim()
        if (s) lines.push(s)
      }
    } else {
      lines.push(msg)
    }
  } else {
    lines.push('Dispatch failed')
  }
  const errors = r.errors
  if (errors && typeof errors === 'object') {
    const codes = (errors as Record<string, unknown>)['codes']
    if (Array.isArray(codes) && codes.length > 0)
      lines.push(`codes: ${codes.map(String).join(', ')}`)
    // An errors object the message did not already name → name each
    // field+rule. Meta keys (codes/invoice/type/code) are not fields.
    if (!lines.some((l) => l.includes('field '))) {
      for (const [field, rule] of Object.entries(errors)) {
        if (field === 'codes' || field === 'invoice' || field === 'type' || field === 'code')
          continue
        lines.push(`field '${field}' ${ruleText(rule)}`)
      }
    }
  }
  return lines
}

/** Multi-line toast body (sonner renders \n). Caller sets the duration. */
export function formatCourierDispatchToast(
  r: CourierDispatchFailure,
): string {
  return formatCourierFieldLines(r).join('\n')
}
