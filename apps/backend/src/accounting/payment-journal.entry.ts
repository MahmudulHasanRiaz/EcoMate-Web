// ── Phase 2 auto-journal — pure entry builders (no I/O, no Nest).
//
// Every RECORDED money movement posts exactly ONE balanced two-leg entry, in
// the same journal shape the COD settlement already uses
// (courier-settlement/accounting/courier-accounting.ts): the asset leaf is
// debited/credited and the SAME clearing account the settlement credits is used
// as the contra leg, so there is one receipt convention in the books, not two.
//
// Sign convention: a negative amount is the MIRROR of the positive one. That is
// what makes a refund (written as a negative Payment.amount) post the reverse
// of the original receipt without a second code path.

import {
  CASH_GATEWAY_CODE,
  COD_PAYMENT_OPTION_TYPE,
} from './payment-journal.constants';

export const MONEY_EPSILON = 0.01;

/** Logical legs; the service resolves these to chart-of-accounts ids. */
export type JournalAccountKey = 'asset' | 'contra' | 'expense' | 'payable';

export interface LedgerLeg {
  debit: number;
  credit: number;
}

export interface JournalLeg extends LedgerLeg {
  account: JournalAccountKey;
}

export function round2(n: number): number {
  return Math.round(((Number.isFinite(n) ? n : 0) + Number.EPSILON) * 100) / 100;
}

/**
 * Dr `debitAccount` / Cr `creditAccount` for `amount`. A negative amount swaps
 * the sides (the refund mirror). Amounts at/below the epsilon post NOTHING —
 * a zero entry is never written.
 */
export function twoLegEntry(
  debitAccount: JournalAccountKey,
  creditAccount: JournalAccountKey,
  amount: number,
): JournalLeg[] {
  const value = round2(amount);
  if (Math.abs(value) <= MONEY_EPSILON) return [];
  const magnitude = Math.abs(value);
  const dr = value > 0 ? debitAccount : creditAccount;
  const cr = value > 0 ? creditAccount : debitAccount;
  return [
    { account: dr, debit: magnitude, credit: 0 },
    { account: cr, debit: 0, credit: magnitude },
  ];
}

/** Swap Dr/Cr on every leg, preserving any extra fields (e.g. `accountId`).
 * Used against the ORIGINAL entry's own accounts, so a reversal can never
 * drift onto different accounts. */
export function mirrorEntry<T extends LedgerLeg>(legs: T[]): T[] {
  return legs.map((l) => ({ ...l, debit: l.credit, credit: l.debit }) as T);
}

export function entryTotals(legs: LedgerLeg[]): {
  totalDebit: number;
  totalCredit: number;
} {
  return {
    totalDebit: round2(legs.reduce((s, l) => s + l.debit, 0)),
    totalCredit: round2(legs.reduce((s, l) => s + l.credit, 0)),
  };
}

export function isBalanced(legs: LedgerLeg[]): boolean {
  if (legs.length === 0) return false;
  const { totalDebit, totalCredit } = entryTotals(legs);
  return Math.abs(totalDebit - totalCredit) <= MONEY_EPSILON;
}

/**
 * ── THE COD CLASSIFIER ────────────────────────────────────────────────────
 * An order is COD exactly when its `paymentOptionType` is cash-on-delivery.
 * COD cash is posted by the courier SETTLEMENT at finalization (Dr cash /
 * Dr courier expense / Cr COD clearing); posting it again at payment time
 * would count the same cash twice.
 *
 * The gateway code is deliberately NOT the classifier: storefront COD
 * orders stamp `gatewayCode = 'cash'` (orders.service.ts:3479) — the very
 * same code POS counter sales use — while POS orders carry
 * `paymentOptionType = NULL` (schema.prisma:896). `Order.paymentOptionType`
 * is therefore the only reliable classifier, and it is the one the
 * courier-settlement module already uses. (For the JOURNAL guard's skip,
 * see `isCourierSettledCodReceipt` below — D15 narrowed it to the payments
 * that actually are courier-collected cash.)
 */
export function isCodOrder(
  order: { paymentOptionType?: string | null } | null | undefined,
): boolean {
  return order?.paymentOptionType === COD_PAYMENT_OPTION_TYPE;
}

/**
 * ── THE JOURNAL GUARD (D15 refinement, owner-confirmed 2026-10-24) ─────────
 * The settlement-posts-it skip applies only to money the COURIER collects:
 * a payment row on a COD order whose gateway is the doorstep cash channel
 * (`gatewayCode = 'cash'`). Both halves are required, and together they are
 * precise:
 *
 * - The ORDER half keeps POS counter sales safe: they use `gatewayCode =
 *   'cash'` too, but POS orders carry `paymentOptionType = NULL`, so they
 *   never enter this branch and their receipts keep posting.
 * - The GATEWAY half rescues DIRECT receipts on COD orders. A bKash/Nagad/
 *   gateway advance on a COD order is money the merchant received through a
 *   channel the courier never touches; the settlement books only what the
 *   courier collected at the door (the order total minus recorded payments),
 *   so skipping the advance journaled it NOWHERE — the books silently lost
 *   real money (staging proof 2026-10-24: ৳50 bKash advance on a COD order
 *   produced no entry, while the identical payment on a Full Payment order
 *   posted immediately). A gateway receipt therefore posts like any other:
 *   Dr its mapped asset / Cr the same clearing the settlement credits.
 *
 * A cash ADVANCE taken at the counter on a COD order stays skipped: in the
 * data it is indistinguishable from doorstep cash, and the conservative side
 * of this guard is the one that can never double-count.
 */
export function isCourierSettledCodReceipt(
  payment: { gatewayCode?: string | null } | null | undefined,
  order: { paymentOptionType?: string | null } | null | undefined,
): boolean {
  return isCodOrder(order) && payment?.gatewayCode === CASH_GATEWAY_CODE;
}
