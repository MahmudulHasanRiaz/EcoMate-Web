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
  /** Units of `quantity` that came back damaged (never restocked). */
  damagedQuantity?: number;
  /** Structured damage history (`receive` = at receipt, `later` = after restock). */
  damageLog?: ReturnDamageLogEntry[];
}

export type ReturnDamagePhase = 'receive' | 'later';

export interface ReturnDamageLogEntry {
  qty: number;
  at: Date | string;
  phase: ReturnDamagePhase;
  by?: string | null;
}

export interface ParsedReturnDamage {
  lineQuantity: number;
  receiveDamaged: number;
  laterDamaged: number;
  laterEvents: Array<{ qty: number; at: Date | null }>;
}

/**
 * Damage split for one Return line. `damagedQuantity` is authoritative for the
 * total; the log supplies event dating. A legacy line with damagedQuantity but
 * no log is treated as receive-time damage (conservative: no COGS reversal).
 */
export function parseReturnDamage(line: {
  quantity: number;
  damagedQuantity?: unknown;
  damageLog?: unknown;
}): ParsedReturnDamage {
  const lineQuantity = Math.max(0, Math.floor(Number(line.quantity) || 0));
  const damagedTotal = Math.min(
    lineQuantity,
    Math.max(0, Math.floor(Number(line.damagedQuantity) || 0)),
  );
  const log = Array.isArray(line.damageLog)
    ? line.damageLog.filter(
        (e): e is Record<string, unknown> => !!e && typeof e === 'object',
      )
    : [];
  const logged = log
    .map((e) => ({
      qty: Math.max(0, Math.floor(Number(e.qty) || 0)),
      at: toDate(e.at as any),
      phase: e.phase === 'later' ? ('later' as const) : ('receive' as const),
    }))
    .filter((e) => e.qty > 0);

  if (logged.length === 0) {
    return {
      lineQuantity,
      receiveDamaged: damagedTotal,
      laterDamaged: 0,
      laterEvents: [],
    };
  }

  const loggedReceive = logged
    .filter((e) => e.phase === 'receive')
    .reduce((s, e) => s + e.qty, 0);
  const loggedLater = logged.filter((e) => e.phase === 'later');
  const loggedLaterQty = loggedLater.reduce((s, e) => s + e.qty, 0);
  // damagedQuantity is the source of truth. Any unlogged remainder is treated
  // as receive-time damage so stock is never assumed to have been restocked.
  const unlogged = Math.max(0, damagedTotal - loggedReceive - loggedLaterQty);
  const receiveDamaged = Math.min(lineQuantity, loggedReceive + unlogged);
  const laterCapacity = Math.max(0, lineQuantity - receiveDamaged);
  let laterLeft = Math.min(damagedTotal - receiveDamaged, laterCapacity);
  const laterEvents: Array<{ qty: number; at: Date | null }> = [];
  for (const e of loggedLater) {
    if (laterLeft <= 0) break;
    const take = Math.min(e.qty, laterLeft);
    laterLeft -= take;
    laterEvents.push({ qty: take, at: e.at });
  }
  return {
    lineQuantity,
    receiveDamaged,
    laterDamaged: laterEvents.reduce((s, e) => s + e.qty, 0),
    laterEvents,
  };
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
  /**
   * Customization line totals (owner Q15): the add-on sell/cost amounts
   * frozen on the order line. Spread per-unit across the line for return
   * math — customized lines are non-returnable (Q17), so this only ever
   * prices COURIER-received physical returns.
   */
  addonAmount?: number | null;
  addonCostAmount?: number | null;
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
  /** In-range units received damaged (never restocked). */
  receiveDamagedUnits: number;
  /** Cost of in-range receive-damaged units — never reversed. */
  receiveDamageCost: number;
  receiveDamageUnavailableUnits: number;
  /** Later-damaged units whose damage date falls inside the range. */
  laterDamageUnits: number;
  /** Cost re-expensed at the later damage date (event-dated). */
  laterDamageExpense: number;
  laterDamageUnavailableUnits: number;
  /** Number of later-damage log entries dated inside the range. */
  laterDamageEvents: number;
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
      damagedQuantity: Number(it.damagedQuantity ?? 0) || 0,
      damageLog: Array.isArray(it.damageLog)
        ? (it.damageLog as ReturnDamageLogEntry[])
        : [],
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
    receiveDamagedUnits: 0,
    receiveDamageCost: 0,
    receiveDamageUnavailableUnits: 0,
    laterDamageUnits: 0,
    laterDamageExpense: 0,
    laterDamageUnavailableUnits: 0,
    laterDamageEvents: 0,
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

      const damage = parseReturnDamage({
        quantity: take,
        damagedQuantity: line.damagedQuantity,
        // The persisted log may describe more units than this line contributed
        // (capped by cumulative order quantity) — parse caps at `take`.
        damageLog: line.damageLog,
      });
      const orderLine = orderItems[index];
      const price = Number(orderLine.price) || 0;
      const cost =
        orderLine.costSnapshot === null || orderLine.costSnapshot === undefined
          ? null
          : Number(orderLine.costSnapshot);
      const costKnown = cost !== null && Number.isFinite(cost);
      const goodUnits = Math.max(0, take - damage.receiveDamaged);
      // Customization add-ons (frozen line totals, spread per unit). The
      // add-on COST is a recorded figure from the order snapshot, so it
      // reverses even when the base costSnapshot is unavailable.
      const lineQty = Number(orderLine.quantity) || 0;
      const addonPerUnit =
        lineQty > 0 ? (Number(orderLine.addonAmount) || 0) / lineQty : 0;
      const addonCostPerUnit =
        lineQty > 0 ? (Number(orderLine.addonCostAmount) || 0) / lineQty : 0;

      if (inRange) {
        impact.value += price * take + addonPerUnit * take;
        impact.receiveDamagedUnits += damage.receiveDamaged;
        impact.cogsReversal += addonCostPerUnit * goodUnits;
        impact.receiveDamageCost += addonCostPerUnit * damage.receiveDamaged;
        if (costKnown) {
          impact.cogsReversal += cost * goodUnits;
          impact.receiveDamageCost += cost * damage.receiveDamaged;
        } else {
          impact.cogsUnavailableUnits += goodUnits;
          impact.receiveDamageUnavailableUnits += damage.receiveDamaged;
        }
      }

      // Later damage is dated by the damage event itself — it must land in the
      // period it happened even when the receipt belongs to an earlier period.
      for (const event of damage.laterEvents) {
        if (!event.at || !inRangeOf(event.at, range)) continue;
        impact.laterDamageEvents += 1;
        impact.laterDamageUnits += event.qty;
        if (costKnown) impact.laterDamageExpense += cost * event.qty;
        else impact.laterDamageUnavailableUnits += event.qty;
      }
    }

    if (inRange && matchedUnits > 0) {
      impact.events += 1;
      impact.units += matchedUnits;
    }
  }

  return { impact, byLine };
}

function inRangeOf(
  date: Date,
  range?: { start: Date; end: Date },
): boolean {
  if (!range) return true;
  return date >= range.start && date <= range.end;
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
