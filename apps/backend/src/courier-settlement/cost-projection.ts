// ── Cost semantics + finalized effective projection (PRD §7) — pure.
//
// `Order.shippingCost` is an ABSOLUTE RECOMPUTE over the union of all
// contributing finalized rows. It is authoritative in full — INCLUDING when it
// is 0. A zero never silently preserves an older manual value; the change is
// audited and the suspicion is expressed as the ZERO_COST_REVIEW exception,
// never by overriding financial truth.

export const FINALIZED_INVOICE_STATES = [
  'ACCOUNTING_POSTED',
  'FINALIZED_PENDING_ACCOUNTING',
  'ACCOUNTING_SKIPPED_ACCOUNTING_DISABLED',
  // §5 post-finalize states remain financially finalized; their rows still
  // contribute to the cost projection.
  'ADJUSTED',
  'RECONCILED',
] as const;
export type FinalizedInvoiceState = (typeof FINALIZED_INVOICE_STATES)[number];

const FINALIZED = new Set<string>(FINALIZED_INVOICE_STATES);

export interface ProjectionRowInput {
  invoiceState: string;
  rowClass: string;
  orderId: string | null;
  supersededByRowId: string | null;
  /** effective courier cost of the row = adjustmentOverride ?? normalizedCharges */
  effectiveCharges: number;
  /** provider-declared charges (used for the zero-charge suspicion) */
  declaredCharges: number;
}

export interface CostProjectionResult {
  /** true when the order has ≥ 1 contributing finalized row. */
  hasContributingRows: boolean;
  /** absolute sum of effective charges over contributing rows. */
  projection: number;
  /** contributing rows whose declared charges are all zero. */
  zeroDeclaredChargeRows: number;
  /** true when projection is 0 while (a) the order is covered and (b) every
   * contributing row declares zero charges → ZERO_COST_REVIEW. */
  zeroCostReview: boolean;
}

/** A row contributes iff its invoice is finalized, it is a DATA row, it belongs
 * to the order, and it has not been superseded by a revision. */
export function isContributingRow(row: ProjectionRowInput, orderId: string): boolean {
  return (
    FINALIZED.has(row.invoiceState) &&
    row.rowClass === 'DATA' &&
    row.orderId === orderId &&
    row.supersededByRowId == null
  );
}

/** §7 projection: absolute recompute (never an increment). */
export function projectOrderCost(orderId: string, rows: ProjectionRowInput[]): CostProjectionResult {
  const contributing = rows.filter((r) => isContributingRow(r, orderId));
  if (contributing.length === 0) {
    return { hasContributingRows: false, projection: 0, zeroDeclaredChargeRows: 0, zeroCostReview: false };
  }
  const projection = round2(
    contributing.reduce((sum, r) => sum + numberOr(r.effectiveCharges, 0), 0),
  );
  const zeroDeclaredChargeRows = contributing.filter(
    (r) => Math.abs(numberOr(r.declaredCharges, 0)) <= 0.005,
  ).length;
  return {
    hasContributingRows: true,
    projection,
    zeroDeclaredChargeRows,
    zeroCostReview: projection === 0 && zeroDeclaredChargeRows > 0,
  };
}

export interface ShippingCostWrite {
  shippingCost: number;
  shippingCostSource: 'courier_invoice';
}

/**
 * The write decision for `Order.shippingCost`. Returns null when the order has
 * no contributing rows (no invoice evidence ⇒ no write).
 */
export function shippingCostWrite(result: CostProjectionResult): ShippingCostWrite | null {
  if (!result.hasContributingRows) return null;
  return { shippingCost: result.projection, shippingCostSource: 'courier_invoice' };
}

/** §7 effectiveCourierCost = adjustmentOverride ?? normalizedCourierCost. */
export function effectiveCourierCost(
  normalizedCharges: number,
  adjustmentOverride?: number | null,
): number {
  return round2(adjustmentOverride == null ? numberOr(normalizedCharges, 0) : adjustmentOverride);
}

function round2(n: number): number {
  return Math.round((numberOr(n, 0) + Number.EPSILON) * 100) / 100;
}
function numberOr(n: number | null | undefined, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}