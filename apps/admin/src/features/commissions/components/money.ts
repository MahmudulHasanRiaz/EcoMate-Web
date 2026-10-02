/** Shared money formatter for commission views. */
export function money(n: number | null | undefined): string {
  const v = Number(n ?? 0)
  return `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ৳`
}