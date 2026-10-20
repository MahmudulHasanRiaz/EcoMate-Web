/**
 * The ONE derived order-due formula.
 *
 * due = total − Σ(PAID customer payments) − applied customer credit
 *       − received return value
 *
 * Courier-settlement gateway rows are settlement bookkeeping, not customer
 * money, so they are never subtracted here (including in the COD-mismatch
 * alert's expected collectable). Received return value comes from
 * `receivedReturnValue()` over received Return rows (D1: totals unchanged).
 */

export const COURIER_SETTLEMENT_GATEWAY = 'courier_settlement';

const PAID_STATUSES = new Set(['PAID']);

export interface DuePayment {
  amount: number | string;
  status: string;
  gatewayCode?: string | null;
  appliedCreditAmount?: number | string | null;
}

export interface OrderDueResult {
  paid: number;
  credit: number;
  receivedReturnValue: number;
  due: number;
}

function money(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function deriveOrderDue(input: {
  total: number | string;
  payments?: DuePayment[] | null;
  receivedReturnValue?: number | string | null;
  cancelled?: boolean;
}): OrderDueResult {
  const rows = Array.isArray(input.payments) ? input.payments : [];
  let paid = 0;
  let credit = 0;

  for (const p of rows) {
    if (!PAID_STATUSES.has(String(p.status))) continue;
    if (p.gatewayCode === COURIER_SETTLEMENT_GATEWAY) continue;
    paid += money(p.amount);
    credit += money(p.appliedCreditAmount);
  }

  const returns = money(input.receivedReturnValue);
  const due = input.cancelled
    ? 0
    : Math.max(0, money(input.total) - paid - credit - returns);

  return { paid, credit, receivedReturnValue: returns, due };
}
