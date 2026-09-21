# Metric Dictionary — Business Analytics (P1, review checkpoint D9)

Canonical metric definitions for the EcoMate Web BI & Analytics system.
Enforced in code by `metric-contract.ts` (status sets, Delivered gate,
return/refund crossover, cost states, movement thresholds, shipping-refund
inference, TBC bridge), `analytics-range.util.ts` (Dhaka ranges) and
`analytics-coverage.util.ts` (ladderState). Locked by pure-rule jest tests in
`__tests__/`. Full plan: §2 Canonical Metric Dictionary.

## 1. Time basis

Dhaka calendar day, inclusive: `startDate` → 00:00:00.000, `endDate` →
23:59:59.999 via `dhakaDayRange` (all math through
`common/utils/dhaka-time.ts`, never hand-rolled). Comparison = immediately
preceding window of identical length (`prevEnd = start − 1ms`,
`prevStart = prevEnd − (end − start)`). `periodDays` is inclusive and always
returned. Auto-granularity: ≤2d hour, ≤62d day, ≤185d week, else month.

## 2. Revenue recognition — Delivered only (D4)

Recognised cohort = orders with a `Delivered` transition in range. Revenue
event date = the `Delivered` transition timestamp from `Order.timeline`
(`revenueDateSource: 'timeline'`); fallback `Dispatch.deliveredAt`
(`'dispatch'`); neither → not recognised, counted in
`recognition.undatedDeliveries` — never guessed. `createdAt` is never a
revenue date. Everything before `Delivered` is never Sales/Net Revenue.

Lifecycle groups: Pending / Payment Pending / Payment Verifying / Hold =
pre-fulfilment (never recognised); Confirmed / Packed / Packing Hold /
Shipping = in-fulfilment (never recognised); Delivered = recognised event;
Partial = unrecognised + flagged (no partial value invented); Return Pending
= unrecognised unless a prior `Delivered` exists; Returned / Damaged =
recognised-then-reversed only with a prior `Delivered`; Cancelled = never
recognised. `isFinal`: Delivered, Returned, Damaged, Cancelled.

Lenses (side by side, never mixed): L1 Booked (`Σ Order.total` by
`createdAt`, intake only) · L2 Recognised (Delivered cohort, P&L basis) ·
L3 Cash Collected (`Σ Payment.amount` PAID). Gross Sales = `Σ price × qty`
(product revenue only); `Order.shippingCharge` is never inside Gross Sales.

Return before delivery (F9): nothing recognised ⇒ no reversal; pipeline +
Fulfillment Economics only. Delivered then returned: recognised at
`Delivered`, reversed at the return event date; cross-period reversals land
in the later period, earlier periods are never rewritten.

## 3. Returns & refunds (D7 crossover)

Return Event = delivery-recognised order with a transition to
Returned/Damaged in range, dated by that transition. Returned Value =
`Σ lineNet` of all the order's items at the return event. Return Rate is
order-level only (`returnEvents / recognisedOrders`); product/variant return
figures are labelled "order-level incidence" — no fractional attribution.

| Refund case | Treatment |
|---|---|
| Delivered, not returned (incl. refund without return) | Revenue reversal, dated `processedAt ?? createdAt` |
| Delivered and returned | Informational only (reversal already taken) |
| Never delivered | Not a reversal; lives in Fulfillment Economics |

R12: no order contributes to both `Returns` and `Refunds (reversal)`.

## 4. Discount allocation (single definition)

`lineGross = price × qty`; `allocatedDiscount = order.discount × (lineGross /
Σ lineGross)` clamped to `lineGross`; `lineNet = lineGross −
allocatedDiscount`. Zero gross ⇒ zero allocation (never NaN).

## 5. Cost states — actual | estimated | unavailable | not_applicable

COGS: `actual` (FIFO `costType='actual'` + snapshot) / `estimated`
/ `unavailable` (snapshot NULL — never back-filled from current
`standardCost`; unavailable units counted, never summed as zero).
Fulfillment: `manual` → actual, `courier_default` → estimated, NULL →
unavailable. Payment Fee: present (PAID row) → actual, NULL → unavailable.
Marketing: every row has `spendDate` → actual; any row NULL →
`unavailable` (D10). Operating Expenses: always actual. Other Costs: no
source → `not_applicable` (renders "—", never downgrades the ladder).

`ladderState` = weakest among contributing lines (unavailable < estimated <
actual); `not_applicable` never downgrades. Net Profit is presented as exact
only when `ladderState = 'actual'`.

## 6. Marketing cost — spend date only (D5, D10)

P&L Marketing Cost = `Σ MarketingConsumption.calculatedCost` dated by
`spendDate`. NULL-`spendDate` rows contribute 0 to every period, are
quantified (`undatedRows` / `undatedAmount`) and listed in a fix-list.
`allocatedAt` is never a financial event date, not even as a fallback — only
a labelled `estimatedReference`, excluded from every total. R17:
`Σ all == Σ dated + Σ undated` (date-independent).

## 7. Profit ladder (§2.5) + single-count bridge (D12)

Gross Sales − Discounts − Returns − Refunds(reversal) = Net Sales (weakest
state of the four) − COGS = Gross Profit − Fulfillment Cost − Payment
Gateway Cost − Marketing Cost = Contribution Profit − Operating Expenses =
Operating Profit − Other Costs (n/a) = Net Profit. Operating Profit and Net
Profit are numerically equal — the UI states this. Margins: Net Sales ≤ 0
or missing ⇒ null ⇒ "N/A" (never 0%, never Infinity).

Bridge: `Total Business Contribution = Contribution Profit + Delivery Charge
Retained` (= `NS + DCR − COGS − CC − PF − MK`). `CP + Fulfillment Margin` is
forbidden (double-counts courier cost). `Net Profit = TBC − OE`.
Fulfillment Margin (`DCR − CC`) is a delivery-axis diagnostic only, never a
bridge operand. Component-once ledger: each amount appears exactly once;
courier cost lives in the ladder Fulfillment line only; DCR lives in the
bridge only; the ledger sums to Net Profit.

## 8. Fulfillment / Courier Economics (D8, D11)

Per-order (BDT): `amountCollected` (online: `Σ PAID Payment.amount` →
actual; COD → unavailable, never inferred from `Order.total` or any order
field) · `amountRefunded` (`Σ completed Refund.amount` → actual) ·
`amountRetained` (derived, unavailable wherever collected is) ·
`deliveryChargeRetained` (online: shipping charge adjusted by inference →
actual; COD → unavailable) · `courierCost` (`shippingCost` + source states —
available for COD and online, deducted once in the ladder) ·
`fulfillmentMargin` (`DCR − CC`; unavailable for COD).

Shipping-refund inference (online only, labelled): refund ≥ shipping charge
⇒ retained 0 (`covered`); refund < charge ⇒ retained full (`below`); no
refund ⇒ retained full (`none`). Never applied to COD.

Future courier settlement / CSV import is the designated authoritative
source for COD collection, consumed through the `SettlementSource` adapter
seam (P2) — no settlement tables in this project. R18: no COD order carries
non-null collected / retained / deliveryChargeRetained / margin. R11: no
settlement amount appears in any revenue bucket.

## 9. Products, customers, inventory, expenses

Product P&L stops at Contribution Profit (company OPEX never apportioned):
direct (sales/discounts/returns/COGS) · attributed (marketing via
`ProductMarketingCost`) · allocated (fulfillment/fees by lineNet share), with
`basis` on every metric. Parent = Σ variants; combos expand to components.
CLR is observed cumulative revenue ("LTV" never appears). Inventory value
reconstructs from `CostingLot` history; movement classes are the default
30/90-day policy (Fast DOI ≤ 30, Slow DOI > 90, Dead = 0 sold + stock on
hand), labelled as policy. Expense kinds default `unclassified`, never
inferred. "Store" is not a dimension.

## 10. Reconciliation & warnings

R1–R18 + W1–W11 per plan §4.3. P1 locks the pure predicates behind R12
(double-reversal), R14 (bridge identity), R15 (forbidden-formula guard),
R16 (component-once), R17 (marketing strictness), R18 (COD honesty).
