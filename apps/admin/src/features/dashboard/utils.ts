export function formatCurrency(n: number): string {
  // D19: same narrowSymbol fix as D16's journal/reports/employees
  // formatters — without it en-US + BDT renders the "BDT 500" code, which
  // is what the dashboard widgets and system alerts showed until now.
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'BDT', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

export function formatDate(d: string | Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(d))
}

export function timeAgo(d: string | Date): string {
  const seconds = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}
