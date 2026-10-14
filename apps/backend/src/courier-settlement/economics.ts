// ── Courier Settlement economics (PRD §2, §3) — pure, side-effect free.
//
// The 8 money concepts are distinct financial facts. This module never reads
// the database: callers pass already-loaded, effective values. Every formula
// here is the canonical one from the plan (§2 table, §3 decomposition) and is
// covered by the Financial Truth Table tests.

export const MONEY_EPSILON = 0.01;
export const RESIDUAL_TOLERANCE = 0.05;

export type ExpectedCodSource = 'cash_payments' | 'order_total_fallback' | 'not_cod';

export interface ExpectedCodPaymentInput {
  amount: number;
  gatewayCode: string;
  status: string;
  /** credit applied against the order — mirrors the cod-mismatch systemDue formula. */
  appliedCreditAmount?: number | null;
}

export interface ExpectedCodOrderInput {
  paymentOptionType?: string | null;
  trashedAt?: Date | null;
  statusName?: string | null;
  total: number;
  payments: ExpectedCodPaymentInput[];
}

export interface ExpectedCodResult {
  /** §2.1 — 0 unless COD, non-trashed, non-cancelled. */
  value: number;
  source: ExpectedCodSource;
  /** true when a cash-payment sum and Order.total both exist but disagree (§2.3). */
  divergence: boolean;
  /** the two candidates when divergence is possible (for the exception context). */
  cashPaymentSum: number | null;
  orderTotal: number;
}

const CANCELLED_STATUS = 'Cancelled';

/**
 * D-C actuals-only ledger: the derived due shared by `expectedCod` and every
 * reader — `total − ΣPAID − ΣappliedCredit`, floored at 0. Only received
 * money reduces what the courier collects; PENDING/FAILED/CANCELLED/VOID
 * rows never do. Mirrors `CodMismatchService` systemDue exactly.
 */
export function derivedDue(
  total: number,
  payments: { amount: number; status: string; appliedCreditAmount?: number | null }[],
): number {
  const paid = payments
    .filter((p) => p.status === 'PAID')
    .reduce((sum, p) => sum + numberOr(p.amount, 0), 0);
  const applied = payments.reduce(
    (sum, p) => sum + numberOr(p.appliedCreditAmount ?? 0, 0),
    0,
  );
  return Math.max(0, round2(numberOr(total, 0) - paid - applied));
}

/**
 * §2.1 `expectedCod(order)` — the gross COD the courier is expected to collect.
 * D-C actuals-only ledger: placeholder rows are gone (VOID-marked, never
 * counted), so the expectation is the DERIVED due, not a cash-row sum.
 * `Order.total` stays the flagged fallback only for COD orders that carry no
 * payment row at all yet (identical value to the derived formula).
 */
export function expectedCod(order: ExpectedCodOrderInput): ExpectedCodResult {
  const orderTotal = numberOr(order.total, 0);
  if (order.paymentOptionType !== 'CASH_ON_DELIVERY') {
    return { value: 0, source: 'not_cod', divergence: false, cashPaymentSum: null, orderTotal };
  }
  if (order.trashedAt) {
    return { value: 0, source: 'not_cod', divergence: false, cashPaymentSum: null, orderTotal };
  }
  if (order.statusName === CANCELLED_STATUS) {
    return { value: 0, source: 'not_cod', divergence: false, cashPaymentSum: null, orderTotal };
  }

  if (order.payments.length === 0) {
    // COD order with no payment row yet — flagged fallback (== derived due).
    return {
      value: orderTotal,
      source: 'order_total_fallback',
      divergence: false,
      cashPaymentSum: null,
      orderTotal,
    };
  }

  return {
    value: derivedDue(orderTotal, order.payments),
    source: 'cash_payments',
    divergence: false,
    cashPaymentSum: null,
    orderTotal,
  };
}

/** §2 identity: gross − charges − net = residual. */
export function residualOf(collected: number, charges: number, net: number): number {
  return round2(numberOr(collected, 0) - numberOr(charges, 0) - numberOr(net, 0));
}

export interface CodPositionInput {
  expectedCod: number;
  /** Σ declared charge components (courierChargesDeducted). */
  charges: number;
  /** signed net cash movement: Σ netSettlement (may be negative). */
  netCashMovement: number;
}

/** §3 signed position: > 0 the courier owes us; < 0 we owe the courier. */
export function codPosition(input: CodPositionInput): number {
  return round2(
    numberOr(input.expectedCod, 0) -
      numberOr(input.charges, 0) -
      numberOr(input.netCashMovement, 0),
  );
}

/** §3 actionable balance owed to us. */
export function outstandingCod(position: number): number {
  return round2(Math.max(numberOr(position, 0), 0));
}

/** §3 actionable balance we owe the courier. */
export function payableToCourier(position: number): number {
  return round2(Math.max(-numberOr(position, 0), 0));
}

/** §3 courier has not collected the full COD. */
export function collectionShortfall(expectedCodValue: number, grossCollected: number): number {
  return round2(Math.max(numberOr(expectedCodValue, 0) - numberOr(grossCollected, 0), 0));
}

/** §3 collected but not remitted. */
export function remittanceShortfall(
  grossCollected: number,
  charges: number,
  netCashMovement: number,
): number {
  return round2(
    Math.max(numberOr(grossCollected, 0) - numberOr(charges, 0) - numberOr(netCashMovement, 0), 0),
  );
}

/** §2.5 cash received = Σ max(net, 0). */
export function cashReceived(net: number): number {
  return round2(Math.max(numberOr(net, 0), 0));
}

/** §2.6 cash disbursed = Σ max(−net, 0). */
export function cashDisbursed(net: number): number {
  return round2(Math.max(-numberOr(net, 0), 0));
}

export function residualSeverity(residual: number, threshold: number): 'none' | 'yellow' | 'red' {
  const abs = Math.abs(numberOr(residual, 0));
  if (abs <= RESIDUAL_TOLERANCE) return 'none';
  if (abs > numberOr(threshold, 0)) return 'red';
  return 'yellow';
}

export function round2(n: number): number {
  return Math.round((numberOr(n, 0) + Number.EPSILON) * 100) / 100;
}

function numberOr(n: number | null | undefined, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}