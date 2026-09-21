/**
 * Business analytics Overview — shared types (P3, §6 empty-vs-zero + auditability).
 *
 * Every card carries KpiValue<T> with all six states. null NEVER renders as ৳0;
 * not_applicable renders "—" and stays visually distinct from unavailable.
 */

export type KpiState =
  | 'ok'
  | 'zero'
  | 'no_data'
  | 'not_applicable'
  | 'unavailable'
  | 'estimated'

export interface KpiValue<T = number> {
  value: T | null
  state: KpiState
  reason?: string
  basis?: 'direct' | 'allocated' | 'attributed'
  dateBasis?: string
  estimatedReference?: { label: string; excludedFromTotal: true }
}

export type CostState = 'actual' | 'estimated' | 'unavailable' | 'not_applicable'

export interface RecognitionStripData {
  bookedOrders: number
  bookedAmount: number
  recognised: number
  inFulfilment: number
  delivered: number
  notYetRecognised: number
  recognitionRate: number | null
  dateSourceMix: { timeline: number; dispatch: number }
  undatedDeliveries: number
}

export interface CostCoverage {
  cogs: { actualPct: number; estimatedPct: number; unavailableUnits: number; unavailableItems: number }
  shipping: { actualOrders: number; estimatedOrders: number; unavailableOrders: number }
  fees: { paidPayments: number; withFee: number; withoutFee: number }
  marketing: { datedRows: number; undatedRows: number; datedAmount: number; undatedAmount: number }
  delivery: { onlineOrders: number; codOrders: number; collectionUnavailableOrders: number }
}

export interface BridgeData {
  contributionProfit: number
  deliveryChargeRetained: number
  deliveryChargeRetainedState: 'actual' | 'unavailable'
  fulfillmentMargin: number
  totalBusinessContribution: number
  operatingProfit: number
  netProfit: number
  /** Structural R15 guard: FM is never an operand. */
  operands: ['contributionProfit', 'deliveryChargeRetained']
  codRecognisedOrders: number
  excludedCodShippingCharge: number
  shippingRefundInferences: number
  state: KpiState
}

export interface OverviewComparison {
  prevNetSales: number
  prevGrossProfit: number
  prevRecognisedOrders: number
  prevCashCollected: number
  prevBooked: number
  netSalesDelta: number
  netSalesDeltaPct: number | null
  recognisedDelta: number
  cashCollectedDelta: number
}

export interface TrendPoint {
  bucketStart: string
  label: string
  netSales: number
  grossSales: number
  recognisedOrders: number
}

export interface BreakdownRow {
  key: string
  label: string
  netSales: number
  orders: number
}

export interface FulfillmentCompact {
  totals: {
    collected: number
    refunded: number
    retained: number
    courierCost: number
    deliveryChargeRetained: number
    fulfillmentMargin: number
  }
  coverage: {
    onlineOrders: number
    codOrders: number
    collectionUnavailableOrders: number
    unknownAmount: number
  }
  gapBanner: { codOrders: number; courierCost: number; message: string }
  panelNote: string
}

export interface OverviewMeta {
  range: { start: string; end: string; periodDays: number }
  comparison: { prevStart: string; prevEnd: string }
  filters: Record<string, string | undefined>
  granularity: string
  generatedAt: string
  dataAsOf: string
  formulaVersion: string
  recognition: 'delivered-only'
  costCoverage: CostCoverage
  ladderState: CostState
  thresholds: Record<string, unknown>
  dateBasis: string
}

export interface OverviewData {
  pnl: {
    lines: Record<
      | 'grossSales' | 'discounts' | 'returns' | 'refundsReversal' | 'netSales'
      | 'cogs' | 'grossProfit' | 'fulfillmentCost' | 'paymentFees' | 'marketingCost'
      | 'contributionProfit' | 'operatingExpenses' | 'operatingProfit' | 'otherCosts' | 'netProfit',
      KpiValue
    >
    margins: { gross: number | null; contribution: number | null; operating: number | null; net: number | null }
    bridge: BridgeData
    lenses: { booked: KpiValue; recognised: KpiValue; cashCollected: KpiValue }
    strip: RecognitionStripData
    coverage: CostCoverage
    marketing: {
      datedRows: number
      undatedRows: number
      datedAmount: number
      undatedAmount: number
      estimatedReference: { label: string; excludedFromTotal: true } | null
    }
  }
  fulfillment: FulfillmentCompact
  comparison: OverviewComparison
  trend: { requestedGranularity: string; granularity: string; points: TrendPoint[] }
  breakdowns: { bySalesChannel: BreakdownRow[]; bySource: BreakdownRow[]; byCategory: BreakdownRow[] }
}

export interface OverviewResponse {
  data: OverviewData
  meta: OverviewMeta
}

/** Overview-relevant §4.1 dimensions. No Store — the dimension does not exist (F7). */
export interface AnalyticsFilters {
  preset: string
  startDate?: string
  endDate?: string
  granularity?: string
  source?: string
  salesChannel?: string
  marketingSource?: string
  paymentMethod?: string
  categoryId?: string
  location?: string
  customerSegment?: string
  deliveryOutcome?: string
  collectionStatus?: string
}

export const DEFAULT_FILTERS: AnalyticsFilters = { preset: 'last_30_days' }

/** P4 product list/detail filters: shared dimensions + list-only search/sort. */
export interface ProductAnalyticsFilters extends AnalyticsFilters {
  search?: string
  sort?: 'netSales' | 'units' | 'contribution' | 'margin' | 'returnRate'
  dir?: 'asc' | 'desc'
}

/** Verbatim §2.6 floor — the product P&L bottom line, stated on every product view. */
export const PRODUCT_CONTRIBUTION_FLOOR_STATEMENT =
  'Product P&L stops at Contribution. Company operating expenses are not allocated to products.'

/** Verbatim §2.2/F2 label — product/variant return rates are order-level incidence. */
export const RETURN_INCIDENCE_LABEL = 'order-level incidence — never fractional'

export type MovementClass = 'Dead' | 'Fast' | 'Slow' | 'Normal'

/** Parent row: every metric is a KpiValue with its §2.6 basis (direct/allocated/attributed). */
export interface ProductPnlRow {
  productId: string
  name: string
  stock: number
  movementClass: MovementClass
  doi: number | null
  lowMargin: boolean
  gross: KpiValue
  discounts: KpiValue
  returns: KpiValue
  netSales: KpiValue
  units: KpiValue
  cogs: KpiValue
  marketing: KpiValue
  fulfillment: KpiValue
  fees: KpiValue
  contribution: KpiValue
  contributionMargin: number | null
  recognisedOrders: number
  returnOrders: number
  returnRate: KpiValue
  uncostedUnits: number
  uncostedLines: number
}

export interface ProductVariantRow extends ProductPnlRow {
  variantId: string | null
  variantLabel: string
}

export interface ProductsData {
  rows: ProductPnlRow[]
  totals: { netSales: number; contribution: number; units: number }
  uncosted: { units: number; lines: number }
  contributionFloor: string
}

export interface ProductDetailData {
  product: { id: string; name: string; stock: number; movementClass: MovementClass; doi: number | null }
  parent: ProductPnlRow
  variants: ProductVariantRow[]
  trend: { requestedGranularity: string; granularity: string; points: TrendPoint[] }
  uncosted: {
    units: number
    lines: number
    rows: { orderId: string; orderItemId: string; productId: string; variantId: string | null; quantity: number; lineNet: number }[]
  }
  contributionFloor: string
}

export interface UncostedData {
  rows: { orderId: string; orderItemId: string; productId: string; variantId: string | null; quantity: number; lineNet: number; productName: string; variantLabel: string }[]
  totals: { units: number; lines: number }
}

export interface ProductsResponse {
  data: ProductsData
  meta: OverviewMeta
}

export interface ProductDetailResponse {
  data: ProductDetailData
  meta: OverviewMeta
}

export interface UncostedResponse {
  data: UncostedData
  meta: OverviewMeta
}

/** ৳ formatting — never called with null (states render first). */
export function formatBDT(v: number): string {
  const sign = v < 0 ? '-' : ''
  return `${sign}৳${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export function formatPct(v: number | null): string {
  if (v === null || v === undefined) return 'N/A'
  return `${(v * 100).toFixed(1)}%`
}

/** Delta with explicit sign — correct for negative-friendly metrics (profit can be < 0). */
export function formatDelta(v: number): string {
  if (v === 0) return '৳0'
  const sign = v > 0 ? '+' : '-'
  return `${sign}৳${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export function formatDeltaPct(v: number | null): string {
  if (v === null || v === undefined) return '—'
  const sign = v > 0 ? '+' : v < 0 ? '-' : ''
  return `${sign}${Math.abs(v).toFixed(1)}%`
}
