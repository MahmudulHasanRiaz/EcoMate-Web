# Analytics profit correctness + order due + 9167f5ea gap closure

Owner directive (FINAL, consolidated). Branch `fix/analytics-profit-correctness`,
ONE commit, NEVER push.

## Base branch note

`origin/main` = `219bd17a`, which is exactly the base of the verified
`9167f5ea` (not merged). The directive requires §6 (close 9167f5ea deferred
items), which only exist on that commit. Therefore the branch is cut from
`9167f5ea` = origin/main + the one verified feature commit. No redo of 9167f5ea.

## Locked principle

D1: return flows NEVER mutate order totals/items. All deductions happen at
calculation time (analytics, due derivation).

---

## Task 1 — Schema + migrations

Files:
- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/migrations/20261020120000_return_received_at/migration.sql`
- `apps/backend/prisma/migrations/20261020120100_expense_compensation_links/migration.sql`

1. `Return.receivedAt DateTime?` — first transition into RECEIVED-or-later.
   Backfill: `UPDATE "Return" SET "receivedAt" = "stockReconciledAt" WHERE
   "stockReconciledAt" IS NOT NULL`.
2. `Expense.sourceType String?`, `Expense.sourceId String?`,
   `@@unique([sourceType, sourceId])` (NULLs do not collide).
3. Data migration: insert ExpenseCategory
   `('cat-commissions','Commissions','commissions','Sales and performance
   commissions','#8B5CF6',true,60,NOW(),NOW())` with
   `WHERE NOT EXISTS (SELECT 1 FROM "expense_categories" WHERE slug='commissions')`.

Run `npx prisma generate`, `npx prisma migrate deploy`, `npx prisma validate`,
`npx prisma migrate status`.

Set `receivedAt` in the return service at every first receipt:
`markReceived`, `restockReturn`, `setReturnReceived` (RECEIVED), and inside
`restoreStockForReturnTx` (RECEIVED/RESTOCKED leg) — only when currently null.

## Task 2 — Pure finance helpers (TDD)

### `apps/backend/src/common/finance/return-impact.ts`

```ts
export const RECEIVED_RETURN_STATUSES = ['RECEIVED','RESTOCKED','CLOSED'] as const;
export interface ReceivedReturnLine { productId?: string|null; variantId?: string|null; quantity: number }
export interface ReceivedReturnEvent { id: string; status: string; receivedAt: Date|string|null; items: unknown }
export interface ReturnMatchItem { productId?: string|null; variantId?: string|null; price: number; quantity: number; costSnapshot?: number|null }
export interface ReceivedReturnImpact {
  events: number; undatedEvents: number; units: number; value: number;
  cogsReversal: number; cogsUnavailableUnits: number;
}
export function computeReceivedReturnImpact(input: {
  returns: ReceivedReturnEvent[];
  orderItems: ReturnMatchItem[];
  range?: { start: Date; end: Date };
}): ReceivedReturnImpact
export function receivedReturnValue(input: {
  returns: ReceivedReturnEvent[]; orderItems: ReturnMatchItem[];
}): number // all-time, ignores dates, used by due
```

Rules: status ∈ RECEIVED_RETURN_STATUSES; item qty capped by the matching
order line's remaining quantity (match productId and null-safe variantId;
null return variant matches any variant of the product only when exactly one
line exists); value = `orderItem.price × qty`; COGS =
`costSnapshot × qty` (null cost → `cogsUnavailableUnits`); undated receipt →
counted in `undatedEvents`, ₾0 deduction; range filters on `receivedAt`.

### `apps/backend/src/common/finance/order-due.ts`

```ts
export const COURIER_SETTLEMENT_GATEWAY = 'courier_settlement';
export interface DuePayment { amount: number|string; status: string; gatewayCode?: string|null; appliedCreditAmount?: number|string|null }
export interface OrderDueResult { paid: number; credit: number; receivedReturnValue: number; due: number }
export function deriveOrderDue(input: {
  total: number|string; payments?: DuePayment[]|null; receivedReturnValue?: number|string|null; cancelled?: boolean;
}): OrderDueResult
```

`paid` = Σ PAID payments excluding `courier_settlement`; `credit` = Σ
`appliedCreditAmount` on PAID rows; `due = max(0, total − paid − credit −
receivedReturnValue)`; `cancelled → due 0` (paid/credit still reported).

### `metric-contract.ts`

```ts
export function findPartialTransition(timeline: TimelineEntry[]): TimelineEntry | null // latest status 'Partial'
export interface PartialRecognition { recognised: boolean; partialAt: Date|null }
export function resolvePartialRecognition(status: string, timeline: TimelineEntry[]): PartialRecognition
```
Recognised only when `status === 'Partial'` AND a dated Partial transition
exists. No transition date → not recognised (W5 stays).

Tests: `common/finance/__tests__/return-impact.spec.ts`,
`common/finance/__tests__/order-due.spec.ts`, partial-guard cases in
`business-analytics/__tests__/analytics-pnl.spec.ts`.

## Task 3 — P&L: received partial returns + partial delivery + COD DCR

### Inputs (`analytics-pnl.service.ts`)

`PnlOrderInput` gains:
```ts
receivedReturns?: ReceivedReturnEvent[];
codCollection?: CodCollectionResult | null;
```
`PnlResult.returns` gains `receivedEvents`, `receivedUndatedEvents`;
`PnlResult` gains `partialRecognition: { orders: number; gross: number; net: number }`;
bridge gains `codSettledOrders` (or equivalent) and keeps
`excludedCodShippingCharge` for unsettled COD only.

### computePnl

Per order:
1. `partial = resolvePartialRecognition(order.status, order.timeline)`.
2. Revenue gate: existing delivered gate OR `partial.recognised`.
3. If `partial.recognised` (kept-items recognition):
   - keptQty per line = `quantity − receivedReturnedQty(line)` (all received returns,
     any date).
   - gross += Σ keptQty × price; allocate the order discount across ORIGINAL line
     grosses (`allocateDiscount`) and take each line's kept share of its net:
     net += lineNet × keptQty / quantity; discounts += keptGross − keptNet.
   - COGS += Σ keptQty × costSnapshot; unavailable units counted.
   - revenue date = `partial.partialAt`.
   - NO item-level return deduction for this order (returns already excluded).
4. Else if recognisedEver, apply whole-order return path as today; if
   `ret.reversesRevenue` is true, skip item-level entirely (R12 guard).
   Otherwise `computeReceivedReturnImpact` over `receivedReturns` dated in range:
   `returns += value`, `returnedCogs += cogsReversal`, units/events/coverage.
5. Returns already received but not in range → nothing (event-dated).
6. Created-but-not-received returns are not in `receivedReturns` → nothing.
7. Partial exchange: original order = source (deduct via received returns);
   exchange order is a separate Order and recognises normally. No special case.
8. COD DCR: for kind === 'cod', read `codCollection`:
   - `state === 'actual'` and `deliveryChargeRetained != null` → dcr += value,
     codSettled++.
   - else dcr state unavailable, codUnsettled++, `excludedCodShippingCharge +=
     shippingCharge`. Never guess (R18).
   DCR state = `unavailable` if any recognised COD order is unsettled, else
   `actual`.

### buildReport

- orders select adds `returns: { where: { status: { in: RECEIVED_RETURN_STATUSES } },
  select: { id, status, receivedAt, stockReconciledAt, items } }`.
- items select adds `productId`, `variantId`, `costSnapshot` (already there?).
- map `receivedReturns` with date fallback `receivedAt ?? stockReconciledAt`.
- inject `AnalyticsFulfillmentService`; for COD candidate ids call
  `buildSettlementSource(ids)` once and map `codCollection =
  source.getCodCollection({ id })`. No per-order query.
- Partial-delivery kept quantities: courier-reported undelivered quantities do
  NOT exist in the data (Dispatch only carries status text, no quantities), so
  only received-return quantities are subtracted. Stated in commit message.

Tests (`analytics-pnl.spec.ts`, `analytics-pnl-service.spec.ts`):
- received partial return 300 on a 1000 delivered order → returns 300,
  net sales 700, returned COGS reversed.
- same return REQUESTED → 0.
- full return (timeline Returned) + a received Return row → whole-order only.
- partial delivery: kept items only (order 3 × 500, return 1 received at),
  revenue = kept 2 × 500, discount share, COGS kept only.
- Partial without a Partial transition date → still unrecognised.
- COD with actual settlement → DCR non-zero, courier cost deducted once;
  COD without settlement → dcr unavailable + excluded shipping.
- exchange order recognises normally while original deducts.

## Task 4 — Sales returns line

`computeReturnBreakdown` adds the received-return impact to
`value/units/cogsReversal` and exposes `receivedValue`, `receivedUnits`,
`receivedEvents`, `receivedUndatedEvents`, `receivedCogsReversal` on
`ReturnBreakdown`. Fetch adds the same `returns` include. Partial orders are
not double-deducted (their kept recognition lives in PnL; sales lens remains
delivered-only and applies received returns only to delivered orders).

Tests: `analytics-sales.spec.ts` — received partial return appears in Returns;
unreceived does not; whole-order reversed skips item-level.

## Task 5 — Order due coherence (backend)

- Adopt `deriveOrderDue` in:
  - `cod-mismatch.service.ts` — `systemDue`; include order `returns` + items
    (price/qty/cost not needed) and compute `receivedReturnValue`; COD-mismatch
    semantics now exclude courier_settlement rows and subtract received returns
    (same customer obligation). Document in commit.
  - `courier-settlement/economics.ts` — `derivedDue` delegates to the shared
    helper (no return data at settlement; no semantic change).
  - `analytics-fulfillment.service.ts` — expected-COD helper delegates.
  - `orders.service.ts` `transformOrder` — when `order.returns` is present:
    `receivedReturnValue` + `due` fields. `findOne` includes received returns.
  - Courier booking collectable (`courier-manager.getCollectableAmount`) is
    deliberately left on its doc'd booking-time heuristic: it runs before
    dispatch/delivery, when no received return can exist, and its legacy
    stored-value fallback is intentional. Stated in commit message.
- Admin consumes server `due` on detail; list rows keep the local fallback.

Tests: `cod-mismatch` expectedCollectable (PAID excl settlement, credit,
received returns); orders.service findOne fields; `order-due.spec.ts`.

## Task 6 — Admin payment card

- `OrderResponse` adds `receivedReturnValue?: number`, `due?: number`.
- `getOrderPaidAmount` excludes `gatewayCode === 'courier_settlement'`.
- `getOrderDueAmount` returns `order.due` when present; otherwise
  `max(0, total − paid − receivedReturnValue)`.
- `order-detail-page.tsx` payment card: when
  `receivedReturnValue > 0`, show `Less: received returns −৳X` above Due.
- `getOrderDueAmount(order)` call sites stay (banner/summary) — one helper.

Tests: `src/lib/order-display.test.ts` (received returns, settlement exclusion,
server due precedence).

## Task 7 — Payroll + commission expenses

### `apps/backend/src/expenses/compensation-expense.service.ts`

```ts
postCompensationExpense(input: {
  sourceType: 'payroll'|'commission'|'commission_v2';
  sourceId: string; amount: number; expenseDate: Date; description: string;
  categorySlug: 'salaries'|'commissions';
}, tx?: Prisma.TransactionClient): Promise<void>
reverseCompensationExpense(input: {
  sourceType: 'payroll_reversal'|'commission_reversal';
  sourceId: string; amount: number; expenseDate: Date; description: string;
  categorySlug: 'salaries'|'commissions';
}, tx?): Promise<void>
```
- Resolve category by slug; create with `expenseKind` fixed/variable if missing
  (self-healing).
- Create Expense with `sourceType/sourceId`; catch P2002 → no-op (idempotent).
  No double-entry: never updates an existing manual row.
- Reversal = a NEW negative-amount Expense row with its own
  `(sourceType, sourceId)` — prior periods are never rewritten.
- Register in `ExpensesModule`, export the service.

### Payroll hooks (`payroll.service.ts`)

- On `approvePayslip` (draft→paid) and `setStatus('approved')`: post expense
  with `sourceType='payroll'`, `sourceId=payslip.id`, amount =
  `totalEarnings − Σ PayslipItem(label 'Commission')` (commissions have their
  own expense; avoids double count), date = paidAt/approvedAt, category
  `salaries`, description `Salary — {periodKey}`.
- On `setStatus('cancelled')`: `reverseCompensationExpense` for any payroll
  expense (sourceType `payroll_reversal`, same sourceId). Current transitions
  forbid cancelling an approved payslip, so this is a defensive/wired path
  (documented in commit).
- Wrap status write + expense in one `$transaction`.

### Commission hooks

- v1 `commissions.service.ts` `processOrderCommissions`: after
  `createMany(skipDuplicates)`, upsert one expense per rule row with
  `sourceType='commission'`, `sourceId='${orderId}:${ruleId}'`, amount, date
  = now (accrual), category `commissions`. Idempotent on re-run.
- v1 `reverseEarning`: after `commissionReversal.create`, post reversal
  expense `sourceType='commission_reversal'`, `sourceId=reversal.id`, negative
  amount, date now. `reverseForOrder` uses `reverseEarning` → covered.
- v2 `commission-engine.service.ts`: post expense after
  `commissionLedgerV2.create` with `sourceType='commission_v2'`,
  `sourceId=ledger.id`, date = qualifiedAt. No v2 reversal path exists.

Tests: payroll spec (approve posts once; re-run no duplicate; cancel reverses;
commission lines excluded), commissions spec (accrual posts, duplicate run
no-op, reversal posts negative), compensation-expense spec (unique catch,
category self-heal).

## Task 8 — Reconciliation W-series

- W5: `partialFlagged` counts only Partial orders WITHOUT a dated Partial
  transition (covered orders resolve). Detail text updated.
- New W12 `manualCompensationDoubleEntry`: among expenses in range, if an
  auto-posted payroll/commission expense exists in a calendar month AND a
  MANUAL expense (sourceType null) in a salary/commission category exists in
  the same month → warn with count + amount. Never silently double-count.
- Add fields to `ReconciliationWarnings`, wire into `runReconciliation`, add
  W12 to `WARNING_REGISTRY`.

Tests: `analytics-reconciliation.spec.ts`.

## Task 9 — 9167f5ea deferred items

1. **Retry-in-place** (`scanner/index.tsx`, `staged-list.tsx`,
   `scanner-page.test.tsx`): add `failed?: boolean` to staged returns. On
   process failure keep `processable: true`, set `failed=true` + live error
   reason; ready = `processable && !failed`; attention = `!processable ||
   failed`; pending = `processable` (failed rows re-submit with fresh
   re-validation). Add retry test.
2. **Resolver item cap (#7)**: resolved as WON'T-FIX with rationale in the
   commit — itemCount is Σ quantities across ALL lines (coverage denominator
   in return-receive), so `take: ITEM_PREVIEW_CAP` would silently truncate it;
   previews are already capped in `orderItemPreviews`, and the select is a
   narrow projection (no over-fetch). No code change.
3. **Dead code (#11)**: remove unused `exchangesApi.get` and simplify
   `exchange-order-section.tsx` `srcHref` if it collapses to a constant
   (keep the link).

Tests: scanner retry + existing suite.

## Task 10 — Docs, acceptance, regression, commit

- Update `METRIC_DICTIONARY.md` (received returns, partial delivery, DCR-COD,
  payroll/commission expenses, due derivation).
- Full regression: backend jest + `nest build` + migrate status; admin vitest +
  tsc; storefront tsc/vitest if touched (not planned).
- Live probe (`.tmp-e2e/`, purged): delivered order + RESTOCKED return →
  PnL returns/net; order detail `receivedReturnValue`/`due`; payslip approve →
  expense once (re-run no duplicate); COD settlement DCR if fixture feasible.
- ONE commit on `fix/analytics-profit-correctness`; never push. Commit message
  lists: D1, guards, partial-delivery data limitation, COD-mismatch alignment,
  courier-booking rationale, and the three §6 resolutions.
