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
  /** Fulfillment location — inventory-scoped pages (OrderItem.sourceWarehouseId). */
  warehouseId?: string
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

// ─── P5 Sales & Orders (§2.1 lenses + §2.2 + §2.10 full panel + §4.2 rows) ────

/** Funnel stage: instrumented stages carry counts; unsupported render "Not instrumented", never zeros. */
export interface SalesFunnelStage {
  key: string
  label: string
  instrumented: boolean
  orders: number | null
  value: number | null
  shareOfBooked: number | null
  conversionFromPrev: number | null
  dateBasis?: string
  reason?: string
}

export interface SalesPipelineStage {
  key: string
  label: string
  orders: number
  value: number
  note: string
}

export interface SalesPaymentMethod {
  gateway: string
  orders: number
  amount: number
  note: string
}

export interface SalesTrendPoint {
  bucketStart: string
  label: string
  amount: number
  orders: number
}

export interface SettlementAmount {
  value: number | null
  state: CostState
  reason?: string
  dateBasis?: string
}

export interface SalesSettlementRow {
  orderId: string
  displayId: string
  status: string
  createdAt: string | null
  collection: 'online' | 'cod' | 'unknown'
  amountCollected: SettlementAmount
  amountRefunded: SettlementAmount
  amountRetained: SettlementAmount
  deliveryChargeRetained: SettlementAmount & { inference: 'covered' | 'below' | 'none' }
  courierCost: SettlementAmount
  fulfillmentMargin: SettlementAmount
  disclosure: string | null
}

export interface SalesSummaryData {
  lenses: { booked: KpiValue; recognised: KpiValue; cashCollected: KpiValue }
  strip: RecognitionStripData
  orderMetrics: {
    bookedOrders: KpiValue
    bookedValue: KpiValue
    recognisedOrders: KpiValue
    recognisedValue: KpiValue
    aovRecognised: KpiValue
    unitsRecognised: KpiValue
    cashCollected: KpiValue
  }
  funnel: SalesFunnelStage[]
  pipeline: { stages: SalesPipelineStage[]; totalOrders: number; totalValue: number }
  paymentBreakdown: {
    methods: SalesPaymentMethod[]
    unpaid: { orders: number; bookedValue: number; note: string }
  }
  cancellations: {
    total: number
    totalValue: number
    undated: number
    dateBasis: string
    byPriorStage: { stage: string; orders: number; value: number }[]
    bySalesChannel: BreakdownRow[]
  }
  returns: {
    events: number
    value: number
    units: number
    cogsReversal: number
    cogsUnavailableUnits: number
    rate: number | null
    rateBasis: string
    dateBasis: string
  }
  refunds: {
    reversal: { orders: number; amount: number }
    informational: { orders: number; amount: number }
    not_a_reversal: { orders: number; amount: number }
    dateBasis: string
    crossoverNote: string
  }
  trends: {
    requestedGranularity: string
    granularity: string
    booked: SalesTrendPoint[]
    recognised: SalesTrendPoint[]
    cash: SalesTrendPoint[]
  }
  economics: {
    fulfillment: FulfillmentCompact
    returnLoss: { amount: number; events: number; unavailableEvents: number; note: string }
    refundLeakage: { amount: number; refunds: number; orders: number; note: string }
    coverage: FulfillmentCompact['coverage']
  }
}

export interface SalesSettlementData {
  rows: SalesSettlementRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  coverage: FulfillmentCompact['coverage']
  gapBanner: FulfillmentCompact['gapBanner']
  panelNote: string
}

export interface SalesSummaryResponse {
  data: SalesSummaryData
  meta: OverviewMeta
}

export interface SalesSettlementResponse {
  data: SalesSettlementData
  meta: OverviewMeta
}

// ─── P6 Customers (§2.7 + §4.2 customer rows + §8.11/8.12) ────

export type CustomerSegmentLabel = 'new' | 'returning' | 'vip'

/** One attributed customer: segment → customer → order history (§4.2). */
export interface CustomerRow {
  key: string
  kind: 'profile' | 'guest'
  profileId: string | null
  phone: string | null
  name: string | null
  segment: CustomerSegmentLabel
  firstRecognisedAt: string
  lifetimeOrders: number
  /** Observed cumulative revenue for this customer — never a prediction. */
  lifetimeRevenue: number
  rangeOrders: number
  rangeRevenue: number
}

export interface CustomerUnattributed {
  orders: number
  customers: number
  revenue: number
  statement: string
}

export interface CustomersSummaryData {
  acquisition: { newCustomers: KpiValue; returningCustomers: KpiValue; totalCustomers: KpiValue }
  repeat: { rate: KpiValue }
  value: { revenuePerCustomer: KpiValue; ordersPerCustomer: KpiValue; averageCustomerOrderValue: KpiValue }
  /** Observed cumulative revenue — the predictive-model word appears nowhere. */
  clr: { total: KpiValue; statement: string }
  unattributed: CustomerUnattributed
}

export interface CustomerCohortRetention {
  month: string
  offset: number
  active: number
  rate: number | null
}

export interface CustomerCohort {
  acquisitionMonth: string
  size: number
  retention: CustomerCohortRetention[]
  cumulativeClr: number
  rangeRevenue: number
}

export interface CustomerCohortsData {
  state: 'ok' | 'insufficient_history'
  months: string[]
  cohorts: CustomerCohort[]
  insufficientReason: string | null
}

export interface CustomersListData {
  rows: CustomerRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  unattributed: CustomerUnattributed
}

export interface CustomersSummaryResponse {
  data: CustomersSummaryData
  meta: OverviewMeta
}

export interface CustomerCohortsResponse {
  data: CustomerCohortsData
  meta: OverviewMeta
}

export interface CustomersListResponse {
  data: CustomersListData
  meta: OverviewMeta
}

/** Verbatim §2.7 CLR disclosure — observed, never predictive. */
export const CLR_STATEMENT =
  'Customer Lifetime Revenue (CLR) is observed cumulative revenue over delivery-recognised orders. No predictive model exists.'

/** Verbatim limitation-12 disclosure — phone-less guests are never merged. */
export const UNATTRIBUTED_STATEMENT =
  'Phone-less guest orders cannot be linked to a customer. Each is counted singly and never merged.'

// ─── P7 Marketing (§2.4 spend-date + §8.13/8.14 + §4.2 marketing rows) ────

/** Verbatim §2.4 spend-date basis — stated on the cost panel and every cost KPI. */
export const SPEND_DATE_BASIS_STATEMENT =
  'P&L Marketing Cost counts Σ MarketingConsumption.calculatedCost dated by spendDate only. Rows with no spendDate are excluded from every period total.'

/** Verbatim D10 — allocatedAt/calculatedAt are never financial dates. */
export const ALLOCATED_AT_NOTE =
  'allocatedAt and calculatedAt are never financial dates — shown as reference only, excluded from every total.'

/** Verbatim §8.13 — attribution/P&L period mismatch is expected, never a defect. */
export const ATTRIBUTION_MISMATCH_STATEMENT =
  'Attribution views sit on their own date basis (insight date and attribution date), not the P&L spend-date basis. ' +
  'A period-by-period mismatch against P&L Marketing Cost is expected by design; ' +
  'agreement is verified date-independently (R8).'

/** Verbatim §2.4 — spend on never-recognised orders is insight-only. */
export const UNRECOGNISED_SPEND_NOTE =
  'Spend allocated to orders that never recognised revenue (cancelled or undelivered). ' +
  'An insight only — never folded into the P&L ladder.'

/** Undated fix-list reference-column caption — allocatedAt is not a period date. */
export const UNDATED_ALLOCATED_AT_CAPTION =
  'allocatedAt reference only — not a financial period date'

/** §4.2 undated-spend fix-list actions (sync/replay in the marketing module). */
export const UNDATED_FIX_ACTIONS: { label: string; href: string }[] = [
  { label: 'Resync spend', href: '/op/marketing/spend-snapshots' },
  { label: 'Replay allocations', href: '/op/marketing/attribution' },
]

export interface MarketingSourceRow {
  key: string
  label: string
  orders: number
  revenue: number
}

export interface MarketingCostBlock {
  total: KpiValue
  datedRows: number
  undatedRows: number
  datedAmount: number
  undatedAmount: number
  estimatedReference: { label: string; excludedFromTotal: true } | null
  basisStatement: string
  allocatedAtNote: string
}

export interface MarketingUnrecognisedRow {
  orderId: string
  displayId: string
  status: string
  campaignId: string
  campaignName: string
  allocatedCost: number
  calculatedAt: string
}

export interface MarketingSummaryData {
  cost: MarketingCostBlock
  sources: { rows: MarketingSourceRow[]; unattributed: { orders: number; revenue: number }; dateBasis: string }
  channels: { rows: MarketingSourceRow[]; dateBasis: string }
  segments: {
    newOrders: number
    newRevenue: number
    returningOrders: number
    returningRevenue: number
    vipOrders: number
    vipRevenue: number
    dateBasis: string
  }
  unrecognisedSpend: {
    amount: number
    allocations: number
    orders: number
    rows: MarketingUnrecognisedRow[]
    note: string
    dateBasis: string
  }
  attributionDisclosure: string
}

export interface MarketingTreeAd {
  adId: string
  name: string
  status: string
  insights: { spend: number; impressions: number; clicks: number; purchases: number; purchaseValue: number }
  store: { orders: number; revenue: number }
}

export interface MarketingTreeAdSet {
  adSetId: string
  name: string
  status: string
  insights: { spend: number; impressions: number; clicks: number; purchases: number; purchaseValue: number }
  store: { orders: number; revenue: number }
  ads: MarketingTreeAd[]
}

export interface MarketingTreeCampaign {
  campaignId: string
  name: string
  status: string
  adAccount: { id: string; name: string; currency: string } | null
  platform: { slug: string; name: string } | null
  insights: { spend: number; impressions: number; clicks: number; purchases: number; purchaseValue: number }
  insightsDateBasis: string
  store: { orders: number; revenue: number }
  storeDateBasis: string
  pnlCost: number
  pnlDateBasis: string
  undatedCost: { amount: number; rows: number }
  adSets: MarketingTreeAdSet[]
}

export interface MarketingCampaignsData {
  campaigns: MarketingTreeCampaign[]
  disclosure: string
}

export interface MarketingUndatedRow {
  id: string
  campaignId: string | null
  campaignName: string | null
  calculatedCost: number
  source: string
  /** allocatedAt as a labelled reference — never a period date. */
  allocatedAt: string | null
  allocatedAtCaption: string
  estimatedReference: { label: string; excludedFromTotal: true }
}

export interface MarketingUndatedData {
  rows: MarketingUndatedRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  totalAmount: number
  undatedRows: number
  fixActions: { label: string; href: string }[]
  allocatedAtNote: string
}

export interface MarketingSummaryResponse {
  data: MarketingSummaryData
  meta: OverviewMeta
}

export interface MarketingCampaignsResponse {
  data: MarketingCampaignsData
  meta: OverviewMeta
}

export interface MarketingUndatedResponse {
  data: MarketingUndatedData
  meta: OverviewMeta
}

// ─── P8 Inventory (§2.8 defined period semantics + §4.2 inventory rows) ───────

/** §2.8 reconstruction formula — stated on the value panel. */
export const INVENTORY_VALUE_BASIS_STATEMENT =
  'Inventory Value is reconstructed from CostingLot history: ' +
  'Σ over lots received on or before the valuation date of ' +
  '(quantity − consumed + restored) × unitCost.'

/** Incomplete history is disclosed, never papered over. */
export const INVENTORY_CLOSING_ONLY_NOTE =
  'Lot history is incomplete — value is shown on a closing-only basis from ' +
  'the current FIFO valuation. Opening, average, turnover and days of ' +
  'inventory are unavailable.'

/** Movement is a default policy, not a universal truth. */
export const MOVEMENT_POLICY_LABEL = 'classified by our default 30/90-day policy'

/** Lost sales need a stock-out day plus measurable demand — else unavailable. */
export const LOST_SALES_NOTE =
  'Lost sales are reported only for days with stock ≤ 0 where demand is ' +
  'measurable (recognised sales in the period); otherwise unavailable — ' +
  'never zero-filled.'

/** §4.2 drill path for the inventory page. */
export const INVENTORY_DRILL_LABEL =
  'Inventory value → movement class → product/variant → stock ledger'

export type InventoryValueBasis = 'reconstructed' | 'closing_only'

export interface InventoryAgingBucket {
  label: string
  minDays: number
  maxDays: number | null
  units: number
  value: number
}

export interface InventoryValueData {
  periodDays: number
  reconstructedAt: string
  basis: InventoryValueBasis
  basisNote: string
  basisStatement: string
  value: { opening: KpiValue; closing: KpiValue; average: KpiValue }
  turnover: KpiValue
  doi: KpiValue
  cogs: { amount: number; dateBasis: string }
  aging: { buckets: InventoryAgingBucket[]; dateBasis: string }
  coverage: { lots: number; products: number; inactiveExcluded: number }
}

export interface InventoryMovementRow {
  productId: string
  variantId: string | null
  name: string
  unitsSold: number
  closingUnits: number
  doi: number | null
  movementClass: MovementClass
  policyLabel: string
  sellThrough: number | null
  stockoutDays: number
}

export interface InventoryMovementData {
  periodDays: number
  reconstructedAt: string
  policyLabel: string
  policyRationale: string
  rows: InventoryMovementRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface InventoryStockoutRow {
  productId: string
  variantId: string | null
  name: string
  stockoutDays: number
  coveredDays: number
}

export interface InventoryStockoutsData {
  periodDays: number
  reconstructedAt: string
  stockoutDays: KpiValue
  productsAffected: number
  lostSales: KpiValue & { lostUnits?: number | null }
  lostSalesNote: string
  rows: InventoryStockoutRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface InventoryLedgerRow {
  id: string
  source: 'physical' | 'managed'
  productId: string | null
  variantId: string | null
  warehouseId: string | null
  quantity: number
  direction: string | null
  stockBefore: number | null
  stockAfter: number | null
  type: string | null
  reason: string | null
  createdAt: string
}

export interface InventoryLedgerData {
  periodDays: number
  rows: InventoryLedgerRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  dateBasis: string
}

export interface InventoryValueResponse {
  data: InventoryValueData
  meta: OverviewMeta
}

export interface InventoryMovementResponse {
  data: InventoryMovementData
  meta: OverviewMeta
}

export interface InventoryStockoutsResponse {
  data: InventoryStockoutsData
  meta: OverviewMeta
}

export interface InventoryLedgerResponse {
  data: InventoryLedgerData
  meta: OverviewMeta
}
