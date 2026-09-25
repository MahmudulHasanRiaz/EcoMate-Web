/**
 * Shared plain-language explanations for business analytics info copy.
 *
 * Every user-facing string here follows the shop-owner voice: plain simple
 * words, max 2 short sentences, WHAT the number means + WHY it matters or
 * WHAT to do. Product terms (Net Sales, Drill Down, ROAS, Filter, Date
 * Range) stay as-is. No emojis. Meanings match the backend exactly —
 * plain words, same truth.
 */

/** Only Delivered orders count as sales. Used everywhere instead of repeating the lecture. */
export const INFO_DELIVERED_ONLY =
  'Only counts orders marked Delivered. Orders still in delivery are not sales yet.'

/** Placed-order counting (Booked). Never sales. */
export const INFO_BOOKED_INTAKE =
  'Counts orders when placed, before delivery. Not sales yet.'

/** Cash counting (paid orders only). */
export const INFO_CASH_PAID_ONLY =
  'Money actually collected from paid orders. Unpaid orders are not counted.'

/** Recognition rate = delivered share of placed orders. */
export const INFO_RECOGNITION_RATE =
  'Share of placed orders that reached Delivered. Higher means fewer cancellations and returns.'

/** Pipeline rows are not sales. */
export const INFO_PIPELINE_NOT_SALES =
  'Orders not yet delivered, by stage. Not sales yet.'

/** Delivery money is never sales. */
export const INFO_FULFILLMENT_NOT_SALES =
  'Delivery money only. Not counted as sales.'

/** Courier cost appears once in the profit steps. */
export const INFO_COURIER_COST_ONCE =
  'Courier cost appears once in Profit & Loss under Fulfillment Cost.'

/** Generic missing-cost action used when a cost line has no saved cost. */
export const INFO_MISSING_COST_ACTION =
  'No cost was saved for these lines. Add the cost on the order to complete this number.'

/** Undated ad spend is left out until it has a date. */
export const INFO_UNDATED_SPEND_ACTION =
  'Some ad spend has no date and is left out. Add the date to include it.'

/** Delivery-fee diagnostic: never added to the total. */
export const INFO_FM_DIAGNOSTIC =
  'Delivery check only. Not added to Total Business Contribution.'

/** Return rate counts orders, not items. */
export const INFO_RETURN_INCIDENCE =
  'Counts orders with a return. One order counts once.'

/** COD money needs a courier settlement before it can be shown. */
export function infoCodUnavailable(orders: number): string {
  return (
    `Delivery money is missing for ${orders} cash-on-delivery order(s). ` +
    'Add a courier settlement to complete this number.'
  )
}

/** Words the shop owner should never see in info copy. */
export const BANNED_JARGON = [
  'accrual',
  'provenance',
  'ladderState',
  'formulaVersion',
  'recognition event',
  'dateBasis',
  'attribution basis',
  'cohort',
]

const REPLACEMENTS: [RegExp, string][] = [
  [/MarketingConsumption\.calculatedCost/g, 'ad spend'],
  [/Σ MarketingConsumption/g, 'Total ad spend'],
  [/Attribution views/g, 'Ad reports'],
  [/\bAttribution\b/g, 'Ad sales'],
  [/costSnapshot/g, 'saved cost'],
  [/standardCost/g, 'current product cost'],
  [/feeAmount NULL/g, 'fee missing'],
  [/shippingCost NULL/g, 'delivery cost missing'],
  [/spendDate NULL/g, 'spend date missing'],
  [/expenseDate/g, 'expense date'],
  [/with spendDate/g, 'with a spend date'],
  [/missing spendDate/g, 'missing a spend date'],
  [/spendDate/g, 'spend date'],
  [/allocatedAt and calculatedAt/g, 'allocated and worked-out times'],
  [/allocatedAt reference only — not a financial period date/g, 'allocated time shown for reference only'],
  [/allocatedAt/g, 'allocated time'],
  [/calculatedAt/g, 'worked-out time'],
  [/Order\.total by createdAt/g, 'order totals by order date'],
  [/Order\.createdAt/g, 'order date'],
  [/Payment\.createdAt/g, 'payment date'],
  [/createdAt/g, 'date'],
  [/Delivered transition vs Order\.createdAt/g, 'delivery dates compared with order dates'],
  [/Delivered transition/g, 'delivery date'],
  [/Delivered-then-returned/g, 'Delivered-then-returned'],
  [/delivered-only/g, 'Delivered-only'],
  [/P&L spend-date basis/g, 'profit spend-date basis'],
  [/Not part of recognised revenue\./g, 'Delivery money only. Not counted as sales.'],
  [/P&L ladder/g, 'profit steps'],
  [/P&L basis/g, 'profit basis'],
  [/P&L Marketing Cost/g, 'Marketing Cost in profit'],
  [/P&L/g, 'profit'],
  [/never in the ladder/g, 'never in profit'],
  [/in the ladder once/g, 'in profit once'],
  [/shown once in the ladder/g, 'shown once in profit'],
  [/shown once in the Ladder/g, 'shown once in profit'],
  [/intake cohort/g, 'placed orders'],
  [/intake value/g, 'placed-order value'],
  [/intake only/g, 'placed orders only'],
  [/attribution intake basis/g, 'order date for ad sales'],
  [/attribution basis/g, 'ad-sales basis'],
  [/insight date and attribution date/g, 'ad-report dates'],
  [/insight date/g, 'ad-report date'],
  [/Intake cohort \(booked in range\) reaching each supported stage\./g, 'Orders placed in this period, and how far each one reached.'],
  [/\bintake\b/gi, 'placed orders'],
  [/\bcohort\b/gi, 'group'],
  [/\bprovenance\b/gi, 'source'],
  [/\baccrual\b/gi, 'counting'],
  [/attribution/g, 'ad sales'],
  [/Attributed revenue/g, 'Revenue from ads'],
  [/attributed ·/g, 'from ads ·'],
  [/attributed/g, 'from ads'],
  [/CostingLot history/g, 'past stock records'],
  [/CostingLot/g, 'stock records'],
  [/\(quantity − consumed \+ restored\) × unitCost/g, 'stock left × unit cost'],
  [/\(quantity - consumed \+ restored\) × unitCost/g, 'stock left × unit cost'],
  [/\bFIFO\b/g, 'stock records'],
  [/\breconstructed\b/gi, 'worked out from past records'],
  [/\bReconstructed\b/g, 'Worked out'],
  [/closing-only basis/g, "today's stock only"],
  [/closing_only/g, "today's stock only"],
  [/closing-only/g, "today's stock only"],
  [/order-level incidence — never fractional/g, 'counts orders with a return — one order counts once'],
  [/order-level incidence/g, 'counts orders with a return'],
  [/never fractional/g, 'one order counts once'],
  [/never double-counted/g, 'counted once'],
  [/never back-filled/g, 'never filled in later'],
  [/never filled in later from standardCost/g, 'never filled in later from the current product cost'],
  [/the current standardCost is never a fallback/g, 'the current product cost is not used instead'],
  [/OrderItem\.sourceWarehouseId/g, 'warehouse'],
  [/no_courier_settlement_source/g, 'no courier settlement yet. Add a courier settlement to complete this number'],
  [/courier settlement source yet/g, 'courier settlement yet. Add a courier settlement to complete this number'],
  [/courier settlement import will supply this/g, 'courier settlement will complete this number'],
  [/A courier settlement import will supply this/g, 'A courier settlement will complete this number'],
  [/\bPAID\b/g, 'paid'],
  [/\(§[^)]*\)/g, ''],
  [/§\S*/g, ''],
  [/\(R\d+\)/g, ''],
  [/\bR\d+\b/g, ''],
  [/\bD\d+\b/g, ''],
  [/Σ\(courierCost − deliveryChargeRetained\)/g, 'delivery cost minus delivery fee kept, added'],
  [/Σ\(courierCost - deliveryChargeRetained\)/g, 'delivery cost minus delivery fee kept, added'],
  [/Σ MarketingConsumption/g, 'Total ad spend'],
  [/Σ Expense\.amount \+ taxAmount/g, 'each expense plus tax, added'],
  [/Σ over product rows/g, 'total across products'],
  [/Σ recognised units over product rows/g, 'total units sold across products'],
  [/Σ over lots received on or before the valuation date of/g, 'total across stock received by the count date of'],
  [/Σ/g, 'total'],
  [/ ÷ /g, ' divided by '],
  [/ × /g, ' times '],
  [/\s{2,}/g, ' '],
]

/**
 * Turn a backend or legacy info line into plain shop-owner words.
 * Idempotent: running it twice changes nothing the second time.
 * Keeps numbers, counts and product terms untouched.
 */
export function plainLine(line: string): string {
  let out = line.trim()
  for (const [re, replacement] of REPLACEMENTS) out = out.replace(re, replacement)
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+([.,;])/g, '$1').trim()
  return out
}

/** "Counted by: …" replaces the bare "Date basis: …" prefix. */
export function plainDateBasis(basis?: string | null): string | null {
  if (!basis) return null
  return `Counted by: ${plainLine(basis)}`
}

/** Plain reason line (backend or frontend). */
export function plainReason(reason?: string | null): string | null {
  if (!reason) return null
  return plainLine(reason)
}

/** "Worked out as v9" replaces the bare "Formula: v9" prefix. */
export function plainFormulaLabel(version?: string | null): string | null {
  if (!version) return null
  return `Worked out as ${version}`
}

/** "Note: … Not counted in the total." replaces "Reference: … — excluded from total." */
export function plainReference(label?: string | null): string | null {
  if (!label) return null
  const plain = plainLine(label)
  if (/not counted in the total/i.test(plain)) return `Note: ${plain}`
  return `Note: ${plain}. Not counted in the total.`
}

/** Plain cost-completeness word for the footer. */
export function plainLadderState(state: string): string {
  if (state === 'actual') return 'complete'
  if (state === 'estimated') return 'partly estimated'
  if (state === 'unavailable') return 'partly missing'
  return state
}
