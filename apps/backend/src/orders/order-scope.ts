import type { Prisma } from '@prisma/client';

/**
 * The revenue scope: orders that represent money actually sold.
 *
 * WHY THIS EXISTS — `Order.kind` was never consulted by the revenue paths, so
 * return orders stayed out of reports only because nothing ever marked them
 * PAID. That is an accident, not a rule: the day a return or exchange row gains
 * a paid payment (a POS return, a backfill, an API-created return), it would be
 * counted as revenue next to the original sale it was derived from.
 *
 * `OrderKind` is the discriminator:
 *   - SALE     — a real sale. Counts.
 *   - RETURN   — an RTN. Product lines only; never revenue, never a second
 *                collection. The original keeps its own financials.
 *   - EXCHANGE — a replacement sale. It IS a sale and must be counted, but it
 *                is settled against the original's already-paid amount, so its
 *                `settlementDelta` is what gets collected, never its total.
 *
 * Every revenue/adjustment aggregation must go through this so the rule lives in
 * exactly one place instead of being re-derived per query.
 */
export const SALE_ORDER_KIND = 'SALE' as const;

/** Predicate for Prisma queries: only real sales. */
export function saleOrderOnlyWhere(): Prisma.OrderWhereInput {
  return { kind: SALE_ORDER_KIND };
}

/**
 * Raw-SQL fragment for the hand-written aggregates (dashboard / legacy
 * analytics) that join "Order" directly. `{o}` is the Order table alias.
 *
 * `kind` is compared as text, not as the enum type, so the fragment works in
 * both a plain SELECT and a WHERE that also filters other Order columns.
 */
export const SALE_ORDER_SQL_FILTER = `o."kind" = '${SALE_ORDER_KIND}'`;