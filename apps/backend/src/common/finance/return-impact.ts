/**
 * Received-return impact — the ONE calculation for item-level partial returns.
 *
 * Locked principle D1: return flows never mutate order totals/items. Every
 * deduction is derived at calculation time from the Return rows that have
 * actually been received (RECEIVED/RESTOCKED/CLOSED) and the order line's
 * unit price + cost snapshot.
 *
 * Event dating: `Return.receivedAt` (first receipt). Undated receipts are
 * counted but never dated into a period, and they consume their line's
 * remaining quantity so a dated sibling can never double-deduct the same
 * units. Prior periods are never rewritten.
 *
 * All-time value (`receivedReturnValue`) is used by the order-due derivation;
 * it ignores the range but keeps the same quantity cap.
 */

export const RECEIVED_RETURN_STATUSES = [
  'RECEIVED',
  'RESTOCKED',
  'CLOSED',
] as const;

const RECEIVED = new Set<string>(RECEIVED_RETURN_STATUSES);

export interface ReceivedReturnLine {
  productId?: string | null;
  variantId?: string | null;
  quantity: number;
}

export interface ReceivedReturnEvent {
  id: string;
  status: string;
  receivedAt: Date | string | null;
  /** Raw Return.items JSON — parsed defensively. */
  items: unknown;
}

export interface ReturnMatchItem {
  productId?: string | null;
  variantId?: string | null;
  price: number;
  quantity: number;
  costSnapshot?: number | null;
}

export interface ReceivedReturnImpact {
  /** Dated, in-range returns that matched at least one order line. */
  events: number;
  /** Received returns with no usable date (never dated into a period). */
  undatedEvents: number;
  units: number;
  value: number;
  cogsReversal: number;
  cogsUnavailableUnits: number;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseLines(items: unknown): ReceivedReturnLine[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((it): it is Record<string, unknown> => !!it && typeof it === 'object')
    .map((it) => ({
      productId: typeof it.productId === 'string' ? it.productId : null,
      variantId: typeof it.variantId === 'string' ? it.variantId : null,
      quantity: Number(it.quantity),
    }))
    .filter((it) => it.productId !== null && Number.isFinite(it.quantity) && it.quantity > 0);
}

/** Index of the order line a return line refers to, or -1. */
function matchLine(
  returnLine: ReceivedReturnLine,
  orderItems: ReturnMatchItem[],
): number {
  const candidates = orderItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.productId === returnLine.productId);
  if (candidates.length === 0) return -1;

  if (returnLine.variantId !== null) {
    return (
      candidates.find(({ item }) => item.variantId === returnLine.variantId)
        ?.index ?? -1
    );
  }

  // No variant on the return line: an exact simple-product line wins; with a
  // single candidate there is nothing to disambiguate.
  const simple = candidates.find(({ item }) => !item.variantId);
  if (simple) return simple.index;
  return candidates.length === 1 ? candidates[0].index : -1;
}

interface WalkOptions {
  returns: ReceivedReturnEvent[];
  orderItems: ReturnMatchItem[];
  range?: { start: Date; end: Date };
}

interface WalkResult {
  impact: ReceivedReturnImpact;
  /** Cumulative received quantity per order line (all dates). */
  byLine: number[];
}

function walk({
  returns,
  orderItems,
  range,
}: WalkOptions): WalkResult {
  const remaining = orderItems.map((item) =>
    Math.max(0, Number(item.quantity) || 0),
  );
  const byLine = orderItems.map(() => 0);

  const ordered = returns
    .filter((r) => RECEIVED.has(r.status))
    .map((r) => ({ r, at: toDate(r.receivedAt) }))
    // Undated first: they consume quantity but never invent a period.
    .sort((a, b) => {
      if (!a.at && !b.at) return 0;
      if (!a.at) return -1;
      if (!b.at) return 1;
      return a.at.getTime() - b.at.getTime();
    });

  const impact: ReceivedReturnImpact = {
    events: 0,
    undatedEvents: 0,
    units: 0,
    value: 0,
    cogsReversal: 0,
    cogsUnavailableUnits: 0,
  };

  for (const { r, at } of ordered) {
    const inRange =
      !range || (at !== null && at >= range.start && at <= range.end);
    if (range && at === null) impact.undatedEvents += 1;

    let matchedUnits = 0;
    for (const line of parseLines(r.items)) {
      const index = matchLine(line, orderItems);
      if (index < 0) continue;
      const take = Math.min(line.quantity, remaining[index]);
      if (take <= 0) continue;
      remaining[index] -= take;
      byLine[index] += take;
      matchedUnits += take;

      if (!inRange) continue;
      const orderLine = orderItems[index];
      const price = Number(orderLine.price) || 0;
      impact.value += price * take;
      const cost =
        orderLine.costSnapshot === null || orderLine.costSnapshot === undefined
          ? null
          : Number(orderLine.costSnapshot);
      if (cost === null || !Number.isFinite(cost)) {
        impact.cogsUnavailableUnits += take;
      } else {
        impact.cogsReversal += cost * take;
      }
    }

    if (inRange && matchedUnits > 0) {
      impact.events += 1;
      impact.units += matchedUnits;
    }
  }

  return { impact, byLine };
}

export function computeReceivedReturnImpact(input: {
  returns: ReceivedReturnEvent[];
  orderItems: ReturnMatchItem[];
  range?: { start: Date; end: Date };
}): ReceivedReturnImpact {
  return walk(input).impact;
}

/**
 * Cumulative received-return quantity per order line (all dates) — the kept
 * quantity for partial-delivery recognition.
 */
export function receivedReturnQuantities(input: {
  returns: ReceivedReturnEvent[];
  orderItems: ReturnMatchItem[];
}): number[] {
  return walk(input).byLine;
}

/**
 * All-time received return value (status-based, no period). Used by the
 * order-due derivation: a received return reduces the customer obligation
 * regardless of which analytics period it lands in.
 */
export function receivedReturnValue(input: {
  returns: ReceivedReturnEvent[];
  orderItems: ReturnMatchItem[];
}): number {
  return walk(input).impact.value;
}
