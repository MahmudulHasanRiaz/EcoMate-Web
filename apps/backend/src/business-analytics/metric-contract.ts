/**
 * Business analytics metric & financial contract (P1).
 *
 * The ONLY home for: lifecycle status sets, the Delivered recognition gate,
 * the return/refund crossover predicate (D7), cost states, movement
 * thresholds, shipping-refund inference, the TBC bridge formula (D12) and
 * COD/marketing strictness (D10, D11).
 *
 * Pure functions only. No Prisma, no DB access, no Nest wiring (P2).
 * All date input is explicit; Dhaka bucketing lives in analytics-range.util.
 */

export const ORDER_STATUSES = [
  'Pending',
  'Payment Pending',
  'Payment Verifying',
  'Hold',
  'Confirmed',
  'Packed',
  'Packing Hold',
  'Shipping',
  'Delivered',
  'Partial',
  'Return Pending',
  'Returned',
  'Damaged',
  'Cancelled',
] as const;

export type OrderStatusName = (typeof ORDER_STATUSES)[number];

/** Recognition group per §1.3. `conditional` resolves via prior delivery. */
export type RecognitionGroup =
  | 'pre_fulfilment'
  | 'in_fulfilment'
  | 'recognised'
  | 'unrecognised_flagged'
  | 'conditional'
  | 'never';

export const STATUS_META: Readonly<
  Record<OrderStatusName, { isFinal: boolean; group: RecognitionGroup }>
> = Object.freeze({
  Pending: { isFinal: false, group: 'pre_fulfilment' },
  'Payment Pending': { isFinal: false, group: 'pre_fulfilment' },
  'Payment Verifying': { isFinal: false, group: 'pre_fulfilment' },
  Hold: { isFinal: false, group: 'pre_fulfilment' },
  Confirmed: { isFinal: false, group: 'in_fulfilment' },
  Packed: { isFinal: false, group: 'in_fulfilment' },
  'Packing Hold': { isFinal: false, group: 'in_fulfilment' },
  Shipping: { isFinal: false, group: 'in_fulfilment' },
  Delivered: { isFinal: true, group: 'recognised' },
  Partial: { isFinal: false, group: 'unrecognised_flagged' },
  'Return Pending': { isFinal: false, group: 'conditional' },
  Returned: { isFinal: true, group: 'conditional' },
  Damaged: { isFinal: true, group: 'conditional' },
  Cancelled: { isFinal: true, group: 'never' },
});

// Deep-freeze: the outer Object.freeze alone leaves nested entries mutable.
for (const key of Object.keys(STATUS_META) as OrderStatusName[]) {
  Object.freeze(STATUS_META[key]);
}

function lookupStatus(status: string): OrderStatusName | null {
  return (ORDER_STATUSES as readonly string[]).includes(status)
    ? (status as OrderStatusName)
    : null;
}

export function isFinalStatus(status: string): boolean {
  const known = lookupStatus(status);
  if (!known) throw new Error(`Unknown order status: ${status}`);
  return STATUS_META[known].isFinal;
}

export function recognitionGroup(status: string): RecognitionGroup {
  const known = lookupStatus(status);
  if (!known) throw new Error(`Unknown order status: ${status}`);
  return STATUS_META[known].group;
}

export type ConditionalRecognition = 'recognised' | 'reversed' | 'unrecognised';

export function resolveConditionalRecognition(
  status: string,
  hasPriorDelivery: boolean,
): ConditionalRecognition {
  if (status === 'Return Pending') {
    return hasPriorDelivery ? 'recognised' : 'unrecognised';
  }
  if (status === 'Returned' || status === 'Damaged') {
    return hasPriorDelivery ? 'reversed' : 'unrecognised';
  }
  return isRevenueRecognised(status, hasPriorDelivery)
    ? 'recognised'
    : 'unrecognised';
}

/** D4: revenue is recognised at Delivered (or via a recognised conditional). */
export function isRevenueRecognised(
  status: string,
  hasPriorDelivery = false,
): boolean {
  const known = lookupStatus(status);
  if (!known) throw new Error(`Unknown order status: ${status}`);
  const group = STATUS_META[known].group;
  if (group === 'recognised') return true;
  if (group === 'conditional') {
    return (
      resolveConditionalRecognition(known, hasPriorDelivery) !== 'unrecognised'
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Revenue event (§2.1): Delivered transition date, Dispatch fallback, undated.
// Canonical timeline entry shape mirrors Order.timeline ({ status, timestamp }).
//
// Date-input policy: row/event dates accept Date|string|null — unparseable
// strings and Invalid Dates coerce to null (undated), never Invalid Date.
// Range/period bounds accept Date only.
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  status: string;
  timestamp: string | Date;
  note?: string;
}

/** Parse an event timestamp; null when missing or unparseable (never Invalid Date). */
function validTime(e: TimelineEntry): number | null {
  const d = e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Latest-timestamp-wins among matching transitions; ties break toward the
 * later timeline entry. Entries with unparseable timestamps are ignored.
 */
function latestTransition(
  timeline: TimelineEntry[],
  statuses: readonly string[],
): TimelineEntry | null {
  let best: TimelineEntry | null = null;
  let bestTime = -Infinity;
  for (const e of timeline) {
    if (!statuses.includes(e.status)) continue;
    const t = validTime(e);
    if (t === null) continue;
    if (t >= bestTime) {
      best = e;
      bestTime = t;
    }
  }
  return best;
}

/** Revenue event date = the LATEST Delivered transition timestamp. */
export function findDeliveredTransition(
  timeline: TimelineEntry[],
): TimelineEntry | null {
  return latestTransition(timeline, ['Delivered']);
}

/** Return transition = the LATEST Returned/Damaged transition. */
export function findReturnTransition(
  timeline: TimelineEntry[],
): TimelineEntry | null {
  return latestTransition(timeline, ['Returned', 'Damaged']);
}

/** Statuses whose presence claims a delivery happened (undated if no date). */
const DELIVERY_CLAIMING_STATUSES: readonly string[] = [
  'Delivered',
  'Returned',
  'Damaged',
];

export type RevenueDateSource = 'timeline' | 'dispatch' | null;

export interface RevenueEvent {
  recognised: boolean;
  revenueDate: Date | null;
  revenueDateSource: RevenueDateSource;
  undatedDelivery: boolean;
}

export interface RevenueEventInput {
  timeline?: TimelineEntry[];
  dispatchDeliveredAt?: Date | string | null;
  currentStatus?: string;
}

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function resolveRevenueEvent(input: RevenueEventInput): RevenueEvent {
  const timeline = input.timeline ?? [];
  const viaTimeline = findDeliveredTransition(timeline);
  if (viaTimeline) {
    // findDeliveredTransition only returns entries with parseable timestamps.
    const at = toDateOrNull(viaTimeline.timestamp);
    if (at) {
      return {
        recognised: true,
        revenueDate: at,
        revenueDateSource: 'timeline',
        undatedDelivery: false,
      };
    }
  }
  const viaDispatch = toDateOrNull(input.dispatchDeliveredAt);
  if (viaDispatch) {
    return {
      recognised: true,
      revenueDate: viaDispatch,
      revenueDateSource: 'dispatch',
      undatedDelivery: false,
    };
  }
  const claimsDelivery =
    (input.currentStatus !== undefined &&
      DELIVERY_CLAIMING_STATUSES.includes(input.currentStatus)) ||
    timeline.some((e) => DELIVERY_CLAIMING_STATUSES.includes(e.status));
  return {
    recognised: false,
    revenueDate: null,
    revenueDateSource: null,
    undatedDelivery: claimsDelivery,
  };
}

// ---------------------------------------------------------------------------
// Returns (§2.2, F9): reversal only when a delivery was recognised first.
// ---------------------------------------------------------------------------

export interface ReturnResolution {
  hasReturn: boolean;
  returnAt: Date | null;
  reversesRevenue: boolean;
}

export function resolveReturn(
  timeline: TimelineEntry[],
  deliveredAt: Date | string | null | undefined,
): ReturnResolution {
  const transition = findReturnTransition(timeline);
  if (!transition) {
    // A Returned/Damaged entry with an unparseable timestamp still claims
    // the return (undated) — counted, never dated, never a reversal.
    const claimsReturn = timeline.some(
      (e) => e.status === 'Returned' || e.status === 'Damaged',
    );
    return { hasReturn: claimsReturn, returnAt: null, reversesRevenue: false };
  }
  // Unparseable return timestamps coerce to null (undated): no reversal.
  const returnAt = toDateOrNull(transition.timestamp);
  const delivered = toDateOrNull(deliveredAt);
  return {
    hasReturn: true,
    returnAt,
    reversesRevenue:
      delivered !== null && returnAt !== null && returnAt >= delivered,
  };
}

// ---------------------------------------------------------------------------
// Return/refund crossover predicate (D7). Single home for the ladder rule.
// ---------------------------------------------------------------------------

export type RefundTreatment = 'reversal' | 'informational' | 'not_a_reversal';

export function classifyRefund(input: {
  wasDelivered: boolean;
  wasReturned: boolean;
}): RefundTreatment {
  if (input.wasDelivered && input.wasReturned) return 'informational';
  if (input.wasDelivered && !input.wasReturned) return 'reversal';
  return 'not_a_reversal';
}

/**
 * Each refund on an order classifies independently (multi/partial refunds).
 * Length-only contract: refund elements are never inspected — only the array
 * length determines the output length. Callers pass the order's refund rows.
 */
export function classifyRefunds(
  orderCase: { wasDelivered: boolean; wasReturned: boolean },
  refunds: readonly unknown[],
): RefundTreatment[] {
  return refunds.map(() => classifyRefund(orderCase));
}

/** R12 guard: true when an order would reverse twice. */
export function hasDoubleReversal(input: {
  inReturns: boolean;
  treatment: RefundTreatment;
}): boolean {
  return input.inReturns && input.treatment === 'reversal';
}

// ---------------------------------------------------------------------------
// Discount allocation (§2 single definition).
// ---------------------------------------------------------------------------

export interface AllocatedLine {
  allocated: number;
  net: number;
}

/**
 * Discount allocation (§2 single definition).
 *
 * Rounding policy: proportional shares round to 2dp (paisa); leftover cents
 * distribute largest-remainder, so Σ allocated == min(discount, Σ gross) to
 * the cent. Per-line clamp to lineGross (discount overflow allocates full
 * gross to every line). Negative/non-finite grosses count as 0.
 */
export function allocateDiscount(
  lineGrosses: number[],
  discount: number,
): AllocatedLine[] {
  const grosses = lineGrosses.map((g) =>
    Number.isFinite(g) && g > 0 ? g : 0,
  );
  const grossCents = grosses.map((g) => Math.round(g * 100));
  const grossSumCents = grossCents.reduce((s, c) => s + c, 0);
  if (!(grossSumCents > 0) || !(discount > 0)) {
    return grosses.map((g) => ({ allocated: 0, net: Math.round(g * 100) / 100 }));
  }
  // +Infinity discount (finite guard): every line allocates in full.
  const discountCents = Number.isFinite(discount)
    ? Math.round(discount * 100)
    : grossSumCents;
  if (discountCents >= grossSumCents) {
    return grossCents.map((c) => ({ allocated: c / 100, net: 0 }));
  }
  const raws = grossCents.map((c) => (c * discountCents) / grossSumCents);
  const floors = raws.map((r) => Math.floor(r + 1e-9));
  const order = raws
    .map((r, i) => ({ i, frac: r - Math.floor(r + 1e-9) }))
    .sort((a, b) => b.frac - a.frac);
  let leftover = discountCents - floors.reduce((s, f) => s + f, 0);
  const bonus = new Array<number>(grossCents.length).fill(0);
  // Cycle largest-remainder-first; capped so float dust can't loop forever.
  for (let k = 0; leftover > 0 && k < order.length * 2; k++) {
    const { i } = order[k % order.length];
    // discountCents < grossSumCents ⇒ raw < gross ⇒ floor+1 never exceeds gross.
    if (floors[i] + bonus[i] < grossCents[i]) {
      bonus[i] += 1;
      leftover -= 1;
    }
  }
  return grossCents.map((c, i) => {
    const allocatedCents = Math.min(floors[i] + bonus[i], c);
    return {
      allocated: allocatedCents / 100,
      net: (c - allocatedCents) / 100,
    };
  });
}

// ---------------------------------------------------------------------------
// Cost states (§2.3). COGS is never back-filled from current standardCost:
// a NULL snapshot is `unavailable`, full stop.
// ---------------------------------------------------------------------------

export type CostState =
  | 'actual'
  | 'estimated'
  | 'unavailable'
  | 'not_applicable';

export const COGS_COST_TYPES = ['actual', 'estimated'] as const;
export type CogsCostType = (typeof COGS_COST_TYPES)[number];

export const FULFILLMENT_COST_SOURCES = ['manual', 'courier_default'] as const;
export type FulfillmentCostSource =
  (typeof FULFILLMENT_COST_SOURCES)[number];

export function cogsLineState(input: {
  costSnapshot: number | null | undefined;
  costType: CogsCostType | null | undefined;
}): CostState {
  if (input.costSnapshot === null || input.costSnapshot === undefined) {
    return 'unavailable';
  }
  if (input.costType === 'actual') return 'actual';
  if (input.costType === 'estimated') return 'estimated';
  return 'unavailable';
}

export function fulfillmentCostState(input: {
  shippingCost: number | null | undefined;
  shippingCostSource: FulfillmentCostSource | null | undefined;
}): CostState {
  if (input.shippingCost === null || input.shippingCost === undefined) {
    return 'unavailable';
  }
  if (input.shippingCostSource === 'manual') return 'actual';
  if (input.shippingCostSource === 'courier_default') return 'estimated';
  return 'unavailable';
}

export function paymentFeeState(input: {
  feeAmount: number | null | undefined;
}): CostState {
  return input.feeAmount === null || input.feeAmount === undefined
    ? 'unavailable'
    : 'actual';
}

/** Other Costs has no data source (§2.5, limitation 5). */
export const OTHER_COSTS_STATE: CostState = 'not_applicable';

// ---------------------------------------------------------------------------
// Marketing cost — spend date only (D5, D10).
// NOTE: there is deliberately no date input here other than spendDate.
// ---------------------------------------------------------------------------

export interface MarketingConsumptionRow {
  calculatedCost: number;
  spendDate: Date | string | null;
}

export interface MarketingPeriodCost {
  /** Sum of dated rows inside [periodStart, periodEnd]. Undated rows: 0. */
  total: number;
  datedAmount: number;
  undatedAmount: number;
  datedRows: number;
  undatedRows: number;
  state: CostState;
  /** Informational pointer to the fix-list. Excluded from every sum. */
  estimatedReference: { label: string; excludedFromTotal: true } | null;
}

export interface MarketingIdentity {
  allTimeCost: number;
  datedCost: number;
  undatedCost: number;
}

export function marketingPeriodCost(
  rows: MarketingConsumptionRow[],
  periodStart: Date,
  periodEnd: Date,
): MarketingPeriodCost {
  if (periodEnd < periodStart) {
    throw new Error(
      `marketing period end precedes period start: ` +
        `periodStart=${periodStart.toISOString()} periodEnd=${periodEnd.toISOString()}`,
    );
  }
  let datedAmount = 0;
  let datedRows = 0;
  let undatedAmount = 0;
  let undatedRows = 0;
  for (const row of rows) {
    if (row.spendDate === null || row.spendDate === undefined) {
      undatedRows += 1;
      undatedAmount += row.calculatedCost;
      continue;
    }
    const at = toDateOrNull(row.spendDate);
    if (at === null) {
      // Invalid spendDate strings are undated: counted, contribute 0 to total.
      undatedRows += 1;
      undatedAmount += row.calculatedCost;
      continue;
    }
    if (at >= periodStart && at <= periodEnd) {
      datedRows += 1;
      datedAmount += row.calculatedCost;
    }
  }
  const undated = undatedRows > 0;
  return {
    total: datedAmount,
    datedAmount,
    undatedAmount,
    datedRows,
    undatedRows,
    state: undated ? 'unavailable' : 'actual',
    estimatedReference: undated
      ? {
          label: 'spend-date fix-list reference only — not a financial period date',
          excludedFromTotal: true,
        }
      : null,
  };
}

/** R17: all-time == dated + undated (date-independent identity). */
export function marketingIdentityTotals(
  rows: MarketingConsumptionRow[],
): MarketingIdentity {
  let datedCost = 0;
  let undatedCost = 0;
  for (const row of rows) {
    if (
      row.spendDate === null ||
      row.spendDate === undefined ||
      toDateOrNull(row.spendDate) === null
    ) {
      undatedCost += row.calculatedCost;
    } else {
      datedCost += row.calculatedCost;
    }
  }
  return { allTimeCost: datedCost + undatedCost, datedCost, undatedCost };
}

// ---------------------------------------------------------------------------
// Movement thresholds (§2.8 default policy — constants with rationale).
// ---------------------------------------------------------------------------

export const MOVEMENT_FAST_DOI_MAX = 30;
export const MOVEMENT_SLOW_DOI_MIN = 90;
export const MOVEMENT_RATIONALE =
  'Default 30/90-day policy: Fast means the closing stock would turn within ' +
  '30 days of inventory; Slow means it would sit for more than 90 days. ' +
  'Dead is measured (0 units sold in period with stock on hand). ' +
  'Not a universal truth — the UI labels the policy.';

export type MovementClass = 'Dead' | 'Fast' | 'Slow' | 'Normal';

/**
 * Days of inventory: closing stock ÷ average daily sales over the period.
 * Zero sales ⇒ +Infinity (infinite cover; the Dead rule handles display).
 * Throws on negative or non-finite inputs. Default period is 30 days
 * (monthly-sales basis, matching the 30/90 default policy).
 */
export function computeDOI(input: {
  unitsSold: number;
  closingStock: number;
  periodDays?: number;
}): number {
  const periodDays = input.periodDays ?? 30;
  const fields = {
    unitsSold: input.unitsSold,
    closingStock: input.closingStock,
    periodDays,
  } as const;
  for (const [name, value] of Object.entries(fields)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(
        `computeDOI: ${name} must be a finite non-negative number (received ${value})`,
      );
    }
  }
  if (input.unitsSold === 0) return Number.POSITIVE_INFINITY;
  return (input.closingStock * periodDays) / input.unitsSold;
}

export function classifyMovement(input: {
  unitsSold: number;
  closingStock: number;
  /** Days of inventory; defaults to computeDOI({ unitsSold, closingStock }). */
  doi?: number;
  periodDays?: number;
}): MovementClass {
  if (input.unitsSold === 0 && input.closingStock > 0) return 'Dead';
  const doi =
    input.doi ?? computeDOI({ unitsSold: input.unitsSold, closingStock: input.closingStock, periodDays: input.periodDays });
  if (!Number.isFinite(doi) && doi !== Number.POSITIVE_INFINITY) {
    throw new Error(`classifyMovement: doi must be a finite number or +Infinity (received ${doi})`);
  }
  if (doi < 0) {
    throw new Error(`classifyMovement: doi must be non-negative (received ${doi})`);
  }
  if (doi <= MOVEMENT_FAST_DOI_MAX) return 'Fast';
  if (doi > MOVEMENT_SLOW_DOI_MIN) return 'Slow';
  return 'Normal';
}

// ---------------------------------------------------------------------------
// Shipping-refund inference (§2.10.2, online-collected orders only).
// ---------------------------------------------------------------------------

export const NO_COURIER_SETTLEMENT_SOURCE =
  'no_courier_settlement_source' as const;
export type NoSettlementReason = typeof NO_COURIER_SETTLEMENT_SOURCE;

export type ShippingRefundInference = 'covered' | 'below' | 'none';

export interface DeliveryChargeOutcome {
  state: CostState;
  retained: number | null;
  inference: ShippingRefundInference;
  reason?: NoSettlementReason;
}

export function inferDeliveryChargeRetained(input: {
  shippingCharge: number;
  refundAmount: number;
  collection: 'online' | 'cod';
}): DeliveryChargeOutcome {
  if (input.collection !== 'online') {
    return {
      state: 'unavailable',
      retained: null,
      inference: 'none',
      reason: NO_COURIER_SETTLEMENT_SOURCE,
    };
  }
  if (input.refundAmount <= 0) {
    return { state: 'actual', retained: input.shippingCharge, inference: 'none' };
  }
  if (input.refundAmount >= input.shippingCharge) {
    return { state: 'actual', retained: 0, inference: 'covered' };
  }
  return { state: 'actual', retained: input.shippingCharge, inference: 'below' };
}

// ---------------------------------------------------------------------------
// COD collection honesty (D11): unavailable until a settlement source exists.
// ---------------------------------------------------------------------------

export interface CodSettlement {
  state: 'unavailable';
  reason: NoSettlementReason;
  amountCollected: null;
  amountRetained: null;
  deliveryChargeRetained: null;
  fulfillmentMargin: null;
}

/** Frozen — COD honesty is a constant until a settlement source exists (D11). */
export const COD_SETTLEMENT: Readonly<CodSettlement> = Object.freeze({
  state: 'unavailable',
  reason: NO_COURIER_SETTLEMENT_SOURCE,
  amountCollected: null,
  amountRetained: null,
  deliveryChargeRetained: null,
  fulfillmentMargin: null,
});

// ---------------------------------------------------------------------------
// Single-count contribution bridge (D12, §2.11).
// TBC = CP + DCR. CP + FM is forbidden (subtracts courier cost twice).
// ---------------------------------------------------------------------------

export function computeContributionProfit(input: {
  netSales: number;
  cogs: number;
  courierCost: number;
  paymentFees: number;
  marketingCost: number;
}): number {
  return (
    input.netSales -
    input.cogs -
    input.courierCost -
    input.paymentFees -
    input.marketingCost
  );
}

/** Diagnostic of the delivery axis only — never an additive bridge operand. */
export function computeFulfillmentMargin(input: {
  deliveryChargeRetained: number;
  courierCost: number;
}): number {
  return input.deliveryChargeRetained - input.courierCost;
}

export function computeTotalBusinessContribution(input: {
  contributionProfit: number;
  deliveryChargeRetained: number;
}): number {
  return input.contributionProfit + input.deliveryChargeRetained;
}

export function computeNetProfit(input: {
  totalBusinessContribution: number;
  operatingExpenses: number;
}): number {
  return input.totalBusinessContribution - input.operatingExpenses;
}

/**
 * Operating Profit = TBC − OE. Numerically equal to Net Profit while Other
 * Costs is not_applicable (no source, §2.5 limitation 5) — locked by test.
 */
export function computeOperatingProfit(input: {
  totalBusinessContribution: number;
  operatingExpenses: number;
}): number {
  return input.totalBusinessContribution - input.operatingExpenses;
}

/**
 * Component-once ledger (§2.11): every component in exactly one place.
 * CourierCost appears once (ladder Fulfillment line), never again in the
 * bridge; Delivery Charge Retained appears in the bridge only.
 */
export function computeNetProfitFromLedger(input: {
  grossSales: number;
  discounts: number;
  returns: number;
  refundsReversal: number;
  deliveryChargeRetained: number;
  cogs: number;
  courierCost: number;
  paymentFees: number;
  marketingCost: number;
  operatingExpenses: number;
}): number {
  return (
    input.grossSales -
    input.discounts -
    input.returns -
    input.refundsReversal +
    input.deliveryChargeRetained -
    input.cogs -
    input.courierCost -
    input.paymentFees -
    input.marketingCost -
    input.operatingExpenses
  );
}

// ---------------------------------------------------------------------------
// Margins (§2.5): Net Sales <= 0 (or missing) ⇒ null → renders "N/A".
// ---------------------------------------------------------------------------

export function computeMargin(input: {
  profit: number;
  netSales: number | null | undefined;
}): number | null {
  if (input.netSales === null || input.netSales === undefined) return null;
  if (!(input.netSales > 0)) return null;
  return input.profit / input.netSales;
}
