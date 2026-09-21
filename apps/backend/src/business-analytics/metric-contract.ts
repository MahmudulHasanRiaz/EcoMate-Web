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

export const STATUS_META: Record<
  OrderStatusName,
  { isFinal: boolean; group: RecognitionGroup }
> = {
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
};

function lookupStatus(status: string): OrderStatusName | null {
  return (ORDER_STATUSES as readonly string[]).includes(status)
    ? (status as OrderStatusName)
    : null;
}

export function isFinalStatus(status: string): boolean {
  const known = lookupStatus(status);
  return known ? STATUS_META[known].isFinal : false;
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
  if (!known) return false;
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
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  status: string;
  timestamp: string | Date;
  note?: string;
}

function entryDate(e: TimelineEntry): Date {
  return e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp);
}

export function findDeliveredTransition(
  timeline: TimelineEntry[],
): TimelineEntry | null {
  return timeline.find((e) => e.status === 'Delivered') ?? null;
}

export function findReturnTransition(
  timeline: TimelineEntry[],
): TimelineEntry | null {
  return (
    timeline.find((e) => e.status === 'Returned' || e.status === 'Damaged') ??
    null
  );
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
  /** Accepted for context only — createdAt is NEVER a revenue date. */
  createdAt?: Date | string;
  currentStatus?: string;
}

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}

export function resolveRevenueEvent(input: RevenueEventInput): RevenueEvent {
  const timeline = input.timeline ?? [];
  const viaTimeline = findDeliveredTransition(timeline);
  if (viaTimeline) {
    return {
      recognised: true,
      revenueDate: entryDate(viaTimeline),
      revenueDateSource: 'timeline',
      undatedDelivery: false,
    };
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
    input.currentStatus !== undefined &&
    DELIVERY_CLAIMING_STATUSES.includes(input.currentStatus);
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
  deliveredAt: Date | string | null,
): ReturnResolution {
  const transition = findReturnTransition(timeline);
  if (!transition) {
    return { hasReturn: false, returnAt: null, reversesRevenue: false };
  }
  const returnAt = entryDate(transition);
  const delivered = toDateOrNull(deliveredAt);
  return {
    hasReturn: true,
    returnAt,
    reversesRevenue: delivered !== null && returnAt >= delivered,
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

/** Each refund on an order classifies independently (multi/partial refunds). */
export function classifyRefunds(
  orderCase: { wasDelivered: boolean; wasReturned: boolean },
  refunds: unknown[],
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

export function allocateDiscount(
  lineGrosses: number[],
  discount: number,
): AllocatedLine[] {
  const grossSum = lineGrosses.reduce((s, g) => s + g, 0);
  if (!(grossSum > 0) || !(discount > 0)) {
    return lineGrosses.map((g) => ({ allocated: 0, net: g }));
  }
  return lineGrosses.map((gross) => {
    const share = (gross * discount) / grossSum;
    const allocated = Math.min(share, gross);
    const net = Math.max(gross - allocated, 0);
    return { allocated, net };
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

export function cogsLineState(input: {
  costSnapshot: number | null | undefined;
  costType: string | null | undefined;
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
  shippingCostSource: string | null | undefined;
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
    const at = row.spendDate instanceof Date ? row.spendDate : new Date(row.spendDate);
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
    if (row.spendDate === null || row.spendDate === undefined) {
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

export function classifyMovement(input: {
  unitsSold: number;
  closingStock: number;
  doi: number;
}): MovementClass {
  if (input.unitsSold === 0 && input.closingStock > 0) return 'Dead';
  if (input.doi <= MOVEMENT_FAST_DOI_MAX) return 'Fast';
  if (input.doi > MOVEMENT_SLOW_DOI_MIN) return 'Slow';
  return 'Normal';
}

// ---------------------------------------------------------------------------
// Shipping-refund inference (§2.10.2, online-collected orders only).
// ---------------------------------------------------------------------------

export type ShippingRefundInference = 'covered' | 'below' | 'none';

export interface DeliveryChargeOutcome {
  state: CostState;
  retained: number | null;
  inference: ShippingRefundInference;
  reason?: string;
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
      reason: 'no_courier_settlement_source',
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
  reason: 'no_courier_settlement_source';
  amountCollected: null;
  amountRetained: null;
  deliveryChargeRetained: null;
  fulfillmentMargin: null;
}

export function codSettlement(): CodSettlement {
  return {
    state: 'unavailable',
    reason: 'no_courier_settlement_source',
    amountCollected: null,
    amountRetained: null,
    deliveryChargeRetained: null,
    fulfillmentMargin: null,
  };
}

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
