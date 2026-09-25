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
  /** Inventory drill-down narrow (P8 §4.2: movement row → ledger). */
  productId?: string
  variantId?: string
  /** Expenses narrow (P9 §4.2: category → expense list). */
  expenseCategoryId?: string
  expenseKind?: 'fixed' | 'variable' | 'unclassified'
  /** Expense description substring (case-insensitive, DB-side). */
  search?: string
  dir?: 'asc' | 'desc'
}

/** P9 expenses filters: shared dimensions + list-only sort. */
export interface ExpenseAnalyticsFilters extends AnalyticsFilters {
  sort?: 'total' | 'name' | 'expenseDate'
}

export const DEFAULT_FILTERS: AnalyticsFilters = { preset: 'last_30_days' }

/** P4 product list/detail filters: shared dimensions + list-only search/sort. */
export interface ProductAnalyticsFilters extends AnalyticsFilters {
  search?: string
  sort?: 'netSales' | 'units' | 'contribution' | 'margin' | 'returnRate'
  dir?: 'asc' | 'desc'
}

/** Product profit stops at Contribution — office and staff costs are never split into products. */
export const PRODUCT_CONTRIBUTION_FLOOR_STATEMENT =
  'Product profit stops at Contribution. Office and staff costs are not split across products.'

/** Return rates count orders with a return — one order counts once. */
export const RETURN_INCIDENCE_LABEL = 'Counts orders with a return. One order counts once.'

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

/** CLR is observed sales so far — never a forecast. */
export const CLR_STATEMENT =
  'Total sales from each customer so far, from Delivered orders only. Not a forecast.'

/** Phone-less guests are counted on their own, never merged. */
export const UNATTRIBUTED_STATEMENT =
  'Some guest orders have no phone number, so they cannot be linked to a customer. Each one is counted on its own.'

// ─── P7 Marketing (§2.4 spend-date + §8.13/8.14 + §4.2 marketing rows) ────

/** Marketing Cost counts spend dated in this period only. */
export const SPEND_DATE_BASIS_STATEMENT =
  'Marketing Cost counts spend dated in this period only. Spend with no date is left out — add the date to include it.'

/** Allocated and worked-out times are reference only. */
export const ALLOCATED_AT_NOTE =
  'The allocated time is for reference only. It never decides which period the spend belongs to.'

/** Ad reports and profit group spend by different dates — a gap in one period is normal. */
export const ATTRIBUTION_MISMATCH_STATEMENT =
  'Ad reports and profit group spend by different dates. A gap between them in one period is normal.'

/** Spend on orders that never delivered is insight only. */
export const UNRECOGNISED_SPEND_NOTE =
  'Ad spend on orders that were cancelled or never delivered. Shown for insight only, not counted in profit.'

/** Undated fix-list reference-column caption — the allocated time is not a period date. */
export const UNDATED_ALLOCATED_AT_CAPTION =
  'Allocated time shown for reference only'

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

/** Stock value is worked out from past stock records. */
export const INVENTORY_VALUE_BASIS_STATEMENT =
  'Stock value is worked out from past stock records up to the count date. Only stock received by that date is counted.'

/** Incomplete history is disclosed, never papered over. */
export const INVENTORY_CLOSING_ONLY_NOTE =
  "Past stock records are incomplete, so only today's stock value can be shown. " +
  'Opening, average, turnover and cover days are missing — they need full history.'

/** Movement is a default policy, not a universal truth. */
export const MOVEMENT_POLICY_LABEL = 'Grouped by sales in the last 30 and 90 days'

/** Lost sales need a stock-out day plus measurable demand — else unavailable. */
export const LOST_SALES_NOTE =
  'Lost sales show only for days with no stock where demand can be measured. ' +
  'Otherwise this number stays empty — never 0.'

/** §4.2 drill path for the inventory page. */
export const INVENTORY_DRILL_LABEL =
  'Stock value → sales speed → product → stock history'

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

// ─── P9 Expenses (§2.9 + §4.2 expense rows + §8.6) ────────────────────────────

/** Fixed / Variable / Unclassified comes from your staff's category setting. */
export const EXPENSE_KIND_NOTE =
  "Fixed, Variable and Unclassified come from your staff's category setting. Anything unset stays Unclassified."

/** Expenses add amount + tax by the expense date. */
export const EXPENSE_DATE_BASIS_STATEMENT =
  'Adds each expense plus tax by its expense date.'

/** No budget is set, so Budget vs Actual cannot be shown — never zero. */
export const BUDGET_VS_ACTUAL_NOTE =
  'No budget is set, so Budget vs Actual cannot be shown. It is not 0.'

/** §4.2 drill path for the expenses page. */
export const EXPENSE_DRILL_LABEL =
  'Expense → category → expense list'

/** Filters change the sales number used for comparison; expenses stay company-wide. */
export const EXPENSE_REVENUE_SCOPE_NOTE =
  'Filters change the sales number used for comparison. Expense lines always cover the whole business by expense date.'

export type ExpenseKind = 'fixed' | 'variable' | 'unclassified'

export interface ExpenseCategoryRow {
  categoryId: string
  name: string
  expenseKind: ExpenseKind
  total: number
  expenses: number
}

export interface ExpenseListRow {
  id: string
  description: string
  amount: number
  taxAmount: number
  total: number
  expenseDate: string
  referenceNo: string | null
  category: { id: string; name: string; expenseKind: ExpenseKind }
}

export interface ExpenseTrendPoint {
  bucketStart: string
  label: string
  amount: number
  expenses: number
}

export interface ExpensesSummaryData {
  periodDays: number
  total: KpiValue
  byKind: { fixed: KpiValue; variable: KpiValue; unclassified: KpiValue }
  kindNote: string
  expenseRevenue: KpiValue
  perOrder: KpiValue
  revenue: { netSales: number; recognisedOrders: number; dateBasis: string }
  growth: {
    prevTotal: number
    delta: number
    deltaPct: number | null
    comparison: { prevStart: string; prevEnd: string }
  }
  budgetVsActual: KpiValue
  dateBasis: string
}

export interface ExpensesTrendData {
  periodDays: number
  requestedGranularity: string
  granularity: string
  points: ExpenseTrendPoint[]
  dateBasis: string
}

export interface ExpensesCategoriesData {
  periodDays: number
  rows: ExpenseCategoryRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  dateBasis: string
}

export interface ExpensesListData {
  periodDays: number
  rows: ExpenseListRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  dateBasis: string
}

export interface ExpensesSummaryResponse {
  data: ExpensesSummaryData
  meta: OverviewMeta
}

export interface ExpensesTrendResponse {
  data: ExpensesTrendData
  meta: OverviewMeta
}

export interface ExpensesCategoriesResponse {
  data: ExpensesCategoriesData
  meta: OverviewMeta
}

export interface ExpensesListResponse {
  data: ExpensesListData
  meta: OverviewMeta
}
