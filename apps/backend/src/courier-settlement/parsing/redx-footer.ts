// ── RedX footer row detection (PRD §10 / plan §10).
// RedX_966809.csv has no data rows: after a leading blank line and a quoted header,
// the sheet is composed of footer-like summary blocks whose first cell is one of:
//   Total | Credit Used | Loan Collections | Total Cash Paid
// The footer total (1454.00) does NOT reconcile to the column math
// (1308 − 130 − 16 = 1162), which is exactly why RedX is structure-only/fail-closed.

const REDX_FOOTER_LABELS = new Set([
  'total',
  'credit used',
  'loan collections',
  'total cash paid',
]);

export function redxFooterDetect(firstCellValue: string): boolean {
  if (!firstCellValue) return false;
  return REDX_FOOTER_LABELS.has(firstCellValue.trim().toLowerCase());
}
