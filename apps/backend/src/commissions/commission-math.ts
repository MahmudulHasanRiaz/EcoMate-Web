import { Prisma } from '@prisma/client';
import type { CommissionAmountType } from '@prisma/client';

export type ThresholdPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** Sentinel actor for transitions no human performed (webhooks, dispatch, cron). */
export const SYSTEM_ACTOR_USER_ID = 'system';

export const COMMISSIONABLE_PURPOSES = [
  'Confirmed',
  'Packed',
  'Shipping',
  'Delivered',
  'Returned',
  'Cancelled',
] as const;

export type CommissionPurpose = (typeof COMMISSIONABLE_PURPOSES)[number];

/** Canonical order figures a percentage may be measured against. */
export type ValueBasis = 'order_total' | 'subtotal';

export interface RuleLike {
  id: string;
  amountType: CommissionAmountType;
  amount: Prisma.Decimal | number | string;
  valueBasis: string;
  minOrderAmount: Prisma.Decimal | number | string | null;
  capPerOrder: Prisma.Decimal | number | string | null;
  minimumCount: number | null;
  thresholdPeriod: string | null;
}

export interface OrderLike {
  total: Prisma.Decimal | number | string;
  subtotal: Prisma.Decimal | number | string;
}

export interface CalculationResult {
  amount: Prisma.Decimal;
  sourceAmount: Prisma.Decimal;
  capApplied: boolean;
}

const dec = (v: Prisma.Decimal | number | string | null | undefined): Prisma.Decimal =>
  v === null || v === undefined ? new Prisma.Decimal(0) : new Prisma.Decimal(v);

/**
 * Read the canonical order figure for a rule's value basis.
 *
 * `order_total` is the canonical basis: it is what every existing commission
 * calculation uses (CommissionService.processOrderCommissions) and what a
 * business user means by "order amount". `subtotal` excludes shipping and is
 * available for installations that pay on goods only. A rule always names its
 * basis explicitly, so the two can never silently disagree.
 */
export function resolveBasisAmount(order: OrderLike, valueBasis: string): Prisma.Decimal {
  return valueBasis === 'subtotal' ? dec(order.subtotal) : dec(order.total);
}

/**
 * Compute one rule's commission for one order.
 *
 * Returns null when the order does not qualify, which happens for three
 * distinct reasons and each is reported so the ledger can record why:
 *   - the order is below the rule's optional per-order amount gate
 *   - the resulting amount rounds to zero
 *   - a cap applies (reported, not disqualifying)
 */
export function calculateCommission(
  rule: RuleLike,
  order: OrderLike,
): CalculationResult | null {
  const sourceAmount = resolveBasisAmount(order, rule.valueBasis);

  // Optional additional condition on the order's own amount. This is a
  // per-order gate, entirely separate from the count threshold.
  if (rule.minOrderAmount !== null && rule.minOrderAmount !== undefined) {
    if (sourceAmount.lt(dec(rule.minOrderAmount))) return null;
  }

  let amount =
    rule.amountType === 'fixed'
      ? dec(rule.amount)
      : sourceAmount.mul(dec(rule.amount)).div(100);

  let capApplied = false;
  if (rule.capPerOrder !== null && rule.capPerOrder !== undefined) {
    const cap = dec(rule.capPerOrder);
    if (amount.gt(cap)) {
      amount = cap;
      capApplied = true;
    }
  }

  // Money is stored as DECIMAL(10,2); rounding explicitly here means the
  // stored value is exactly what the arithmetic produced, rather than relying
  // on the database's implicit cast. ROUND_HALF_UP matches the convention used
  // by the reversal path and payroll's Math.round(x*100)/100.
  amount = amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  if (amount.lte(0)) return null;

  return { amount, sourceAmount, capApplied };
}

/**
 * Period bucket for a qualifying event, in the business timezone.
 *
 * The threshold counter is keyed by this string, so "50 packed per day" means
 * 50 packed on the same Dhaka calendar day. Computed from an explicit offset
 * rather than the server clock so the result does not depend on where the
 * process runs.
 */
export function periodKeyFor(
  period: ThresholdPeriod,
  at: Date,
  tzOffsetHours = 6,
): string {
  const shifted = new Date(at.getTime() + tzOffsetHours * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');

  switch (period) {
    case 'daily':
      return `${y}-${m}-${d}`;
    case 'monthly':
      return `${y}-${m}`;
    case 'yearly':
      return `${y}`;
    case 'weekly': {
      // ISO week, Monday-based, computed from the shifted calendar date.
      const date = new Date(Date.UTC(y, shifted.getUTCMonth(), shifted.getUTCDate()));
      const dayNum = (date.getUTCDay() + 6) % 7; // Monday = 0
      date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
      const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
      const week =
        1 +
        Math.round(
          ((date.getTime() - firstThursday.getTime()) / 86400000 -
            3 +
            ((firstThursday.getUTCDay() + 6) % 7)) /
            7,
        );
      return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
    }
  }
}

/**
 * Decide whether a qualifying event earns commission under a threshold rule.
 *
 * Semantics, made explicit because the order requires it:
 * the period's qualifying count is incremented by this event, and the event
 * itself is commissionable only when the resulting count is STRICTLY GREATER
 * than the minimum. So with minimum = 50, the first 50 qualifying events in the
 * period qualify the employee but pay nothing, and the 51st onward earn.
 *
 * `countBefore` is the count already recorded for the period, i.e. this event's
 * own increment has not yet been applied.
 */
export function thresholdQualifies(
  minimumCount: number,
  countBefore: number,
): { qualifies: boolean; countAfter: number } {
  const countAfter = countBefore + 1;
  return { qualifies: countAfter > minimumCount, countAfter };
}

/**
 * Human-readable summary of a rule, used by the UI preview and by the audit
 * trail so a manager can answer "why was this paid?".
 */
export function describeRule(rule: {
  employeeName?: string | null;
  purpose: string;
  amountType: CommissionAmountType;
  amount: Prisma.Decimal | number | string;
  minimumCount: number | null;
  thresholdPeriod: string | null;
  minOrderAmount?: Prisma.Decimal | number | string | null;
  capPerOrder?: Prisma.Decimal | number | string | null;
}): string {
  const who = rule.employeeName ?? 'This employee';
  const value =
    rule.amountType === 'fixed'
      ? `৳${dec(rule.amount).toFixed(2)} per qualifying ${rule.purpose} order`
      : `${dec(rule.amount).toFixed(2)}% of the order total for each qualifying ${rule.purpose} order`;

  const parts: string[] = [`${who} earns ${value}`];

  if (rule.minimumCount && rule.thresholdPeriod) {
    parts.push(
      `after completing ${rule.minimumCount} qualifying ${rule.purpose} orders each ${rule.thresholdPeriod} ` +
        `(the first ${rule.minimumCount} do not pay; from order #${rule.minimumCount + 1} onward)`,
    );
  }

  if (rule.minOrderAmount !== null && rule.minOrderAmount !== undefined) {
    parts.push(`for orders of at least ৳${dec(rule.minOrderAmount).toFixed(2)}`);
  }

  if (rule.capPerOrder !== null && rule.capPerOrder !== undefined) {
    parts.push(`(capped at ৳${dec(rule.capPerOrder).toFixed(2)} per order)`);
  }

  return parts.join(' ') + '.';
}