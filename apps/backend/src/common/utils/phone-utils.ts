export type PhoneFormat = 'international' | 'national' | 'whatsapp'

export function normalizePhone(input: string): string | null {
  const cleaned = input.replace(/[^\d+]/g, '')

  let digits: string
  if (cleaned.startsWith('+8801') && cleaned.length === 14) {
    digits = cleaned.slice(1)
  } else if (cleaned.startsWith('8801') && cleaned.length === 13) {
    digits = cleaned
  } else if (cleaned.startsWith('01') && cleaned.length === 11) {
    digits = '880' + cleaned
  } else if (cleaned.startsWith('1') && cleaned.length === 10) {
    digits = '880' + cleaned
  } else {
    return null
  }

  if (digits.length !== 13 || !digits.startsWith('8801')) return null

  return '+' + digits
}

export function formatPhone(input: string, format: PhoneFormat): string {
  const normalized = normalizePhone(input)
  if (!normalized) return input

  switch (format) {
    case 'international':
      return normalized
    case 'national':
      return '0' + normalized.slice(4)
    case 'whatsapp':
      return normalized.slice(1)
  }
}
