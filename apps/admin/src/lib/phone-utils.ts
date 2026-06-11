export function normalizePhone(input: string): string | null {
  if (!input) return null;
  let digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) {
    const num = digits.slice(1);
    if (num.startsWith('880') && num.length === 13) return digits;
    if (num.length === 11 && num.startsWith('1')) return '+880' + num.slice(1);
    if (num.length === 12 && num.startsWith('880')) return '+' + num;
    return digits;
  }
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
    if (digits.startsWith('880') && digits.length === 13) return '+' + digits;
  }
  if (digits.startsWith('880') && digits.length === 13) return '+' + digits;
  if (digits.startsWith('0') && digits.length === 11) return '+880' + digits.slice(1);
  if (digits.length === 10) return '+880' + digits;
  return null;
}

export function formatPhone(input: string, format: 'international' | 'national' | 'whatsapp' = 'international'): string {
  const normalized = normalizePhone(input);
  if (!normalized) return input;
  if (format === 'national') return '0' + normalized.slice(4);
  if (format === 'whatsapp') return normalized.slice(1);
  return normalized;
}
