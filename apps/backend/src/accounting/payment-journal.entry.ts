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

import { COD_PAYMENT_OPTION_TYPE } from './payment-journal.constants';

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
 * ── THE COD GUARD (directive crux) ──────────────────────────────────────────
 * A receipt is COD exactly when the ORDER is cash-on-delivery. COD cash is
 * posted by the courier SETTLEMENT at finalization (Dr cash / Dr courier
 * expense / Cr COD clearing); posting it again at payment time would count the
 * same cash twice. So COD receipts post NOTHING here.
 *
 * The gateway code is deliberately NOT used as the signal: storefront COD
 * orders stamp `gatewayCode = 'cash'` (orders.service.ts:3479) — the very same
 * code POS counter sales use — while POS orders carry `paymentOptionType = NULL`
 * (schema.prisma:896). `Order.paymentOptionType` is therefore the only reliable
 * classifier, and it is the one the courier-settlement module already uses.
 */
export function isCodOrder(
  order: { paymentOptionType?: string | null } | null | undefined,
): boolean {
  return order?.paymentOptionType === COD_PAYMENT_OPTION_TYPE;
}
