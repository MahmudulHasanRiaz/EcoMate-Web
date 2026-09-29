# POS Sales Analytics & Reporting — Design

Date: 2026-09-29
Status: Approved design (all 5 sections approved). Next: implementation plan via writing-plans.
Scope: POS module only. No cross-showroom reporting in POS. No changes to head-office Delivered revenue recognition.

## 1. Goal and non-goals

Goal: a reliable, business-ready POS sales reporting capability: showroom-scoped overview, paginated transaction report, personal My Sales report, and a professionally formatted server-generated Excel export — all sharing one reporting service, one scope rule, one date rule, and one sales-inclusion rule.

Non-goals:
- Cross-showroom analytics inside POS (stays in existing admin analytics under `view_analytics`).
- Per-staff leaderboard or staff comparison tables (Overall + My Sales only).
- Async export jobs in the initial release (structure must allow adding one later without changing reporting logic).
- New revenue-recognition semantics for head office (Delivered-only logic untouched).

## 2. Scope and authorization

- New backend module `pos-analytics` guarded by existing `dual-mode-auth`, `@Roles('cashier','admin')` (superadmin bypasses via existing guard), no new bypass permission.
- Every request resolves the showroom server-side from the `x-pos-session-id` header through the existing POS session lookup (`getSessionShowroom` semantics): session must exist, be `open`, and belong to a `Warehouse` of type `showroom`.
- Any client-supplied `showroomId` is rejected with 400 (fail closed). There is no showroom-override parameter on POS analytics endpoints.
- Overall Sales scope: all valid POS sales in the session showroom, all staff included.
- My Sales scope: session showroom + current logged-in user.
- Export endpoints enforce the identical scope resolution as dashboard endpoints.

## 3. Sales basis, dates, and inclusion rules

- A POS sale counts when: `trashedAt` is null, `source = POS`, `paymentStatus = PAID`, and order status is none of `Cancelled`, `Returned`, `Damaged`. Only `PAID` counts — `PARTIAL_PAID` (not fully paid), `PAYMENT_PENDING`, `PENDING`, `PAYMENT_VERIFYING`, `UNPAID`, `FAILED`, `CANCELLED`, and `REFUNDED` payment statuses never count.
- Net-sales rule: fully refunded orders contribute zero (excluded from totals and order counts); partially refunded orders contribute gross minus processed refund amounts. Primary “Total Sales” is net sales after approved refunds. Reports show gross, refunds, and net side by side where space allows.
- Processed refund = a `Refund` row for the order with an approval/completion status and `processedAt` set (exact status strings verified against existing data during implementation; `pending` never counts).
- Reporting day: Asia/Dhaka calendar day of the latest PAID payment completion (`verifiedAt` when set, else payment `createdAt`), fallback `Order.createdAt` when no reliable payment timestamp exists. Delivery date is never used.
- Presets: Today, Yesterday, Last 7 Days, Last 30 Days, This Month, Previous Month, Custom From–To. Boundaries inclusive in Asia/Dhaka, reusing `dhaka-time` and `analytics-range` utilities. Custom ranges are capped at 366 days (validation error otherwise); presets are server-aggregated and need no cap.
- KPIs (same basis everywhere): net sales, total orders, units sold, average order value (net ÷ orders, 0 when no orders), gross sales, refunds total, discount total.

## 4. Attribution

- My Sales attribution uses the POS sale's cashier identity: the `cashierId` of the `PosSession` referenced by `Order.posSessionId` (creator at transaction time). `Order.assignedToId` is never used for attribution because reassignment must not rewrite history.
- Showroom totals are independent of the viewer: every valid sale in the showroom counts regardless of which staff member made it.
- Historical sales remain attributed to the original session cashier even if that staff member is later deactivated.

## 5. API and service boundaries

- `PosAnalyticsService` is the single source of truth for scope resolution, date bucketing, inclusion/refund logic, KPI aggregation, transaction queries, and export row production. Controllers are thin.
- Endpoints (all session-scoped, no showroom param; `scope` only selects the view and is server-validated):
  - `GET /pos/analytics/overview?preset|from&to&scope=showroom|mine`
  - `GET /pos/analytics/transactions?scope&preset|from&to&page&pageSize&sort&order`
  - `GET /pos/analytics/export.xlsx?scope&preset|from&to` (synchronous download; `Content-Disposition` filename `POS-Sales-<Showroom>-<from>_<to>.xlsx`)
- Request validation reuses the analytics filter DTO idiom (`class-validator`, `YYYY-MM-DD` dates, preset enum, `from <= to`, 366-day custom cap).
- Responses reuse the analytics envelope idiom: `{ data, meta: { range, scope, formulaVersion, dateBasis: 'payment-completion (Asia/Dhaka)' } }`.
- Transactions paginate server-side (`page`/`pageSize`, cap 100, stable sort by reporting timestamp then `displayId`).
- Multi-product orders: order-level money (subtotal, discount, total) counted once in KPIs; item rows repeat order context but never re-add order totals.

## 6. Excel export

- Generated server-side with `exceljs` (already a backend dependency) from the same service and filters as the dashboard; never from browser-loaded rows.
- Structure: title block (report title, showroom, period, duration in days, generated-at in Asia/Dhaka, generated-by), summary block (KPIs from section 3), detail table (order/invoice no, date, time, customer, staff, product, qty, unit price, discount, line/order total, payment method, status), totals row matching dashboard net sales. Fully refunded orders appear flagged as Refunded with zero net contribution.
- Formatting: bold title/summary, column widths fitted, BDT currency format, date/time formats, auto-filter, freeze panes below header, summary visually distinct.
- Memory: export pages through the transaction query in fixed-size chunks and writes rows incrementally; structured so a future async job can reuse the same row producer.

## 7. POS UX flow

- Entry: Analytics button beside the existing Session Dashboard control in `pos-terminal` header; opens a full-screen Analytics view (not a cramped slide-in) showing the current showroom name prominently.
- Tabs: Overall Sales | My Sales. Scope label always visible (“Showroom: X”, “Viewing: all staff” vs “Viewing: your sales”).
- Controls: preset buttons plus custom From–To date inputs; every view (KPIs, table, export) follows the same selection.
- Content: KPI cards, paginated transaction table (order no, date/time, customer, staff, items summary, qty, discount, total, payment, status), Export Excel button with progress state and duplicate-click guard.
- States: skeleton loading; context-aware empty messages (“No sales in this showroom for <range>. Try another date range.” / “You have no sales in <range>.”); inline + toast errors for network, unauthorized (session expired → re-login), invalid range, export failure. Existing Tailwind/Radix/sonner styling and `৳` BDT formatting reused; no new design system.

## 8. Testing and validation

- Backend specs: manipulated/forged `showroomId` rejected with 400; different-session showroom data invisible; creator attribution unchanged after `assignedToId` reassignment; midnight-boundary sales land on the correct Dhaka day; PAID/full-refund/partial-refund/Cancelled/Returned/trashed matrix; pagination caps and stable ordering; dashboard totals equal export totals for identical scope+range.
- POS checks: tab scoping, preset/custom sync across KPIs/table/export, empty/loading/error/export-failure states.
- Live validation: seeded showroom + session + cashier sales across a midnight boundary, refund and cancel cases, export download and formatting check; all fixtures purged afterward.
- Regression: backend jest, `nest build`, admin vitest/tsc unaffected, POS `tsc -b`, storefront untouched.

## 9. Edge-case behavior

- Cancelled/Returned/Damaged/trashed/failed/unpaid/pending: excluded from net sales everywhere. Fully refunded: zero net contribution, flagged in detail. Partially refunded: net contribution only.
- Discounts: order `discount`/`discountType` already reflected in `Order.total`; item rows show discount context without double counting.
- Tax/VAT: none in the data model; no tax column in v1.
- Multiple payment methods: transaction lists all PAID methods; KPI attribution is not split by method in v1 (method breakdown optional later).
- Midnight/timezone: payment-completion day in Asia/Dhaka governs all views.
- Missing customer: “Walk-in”. Missing staff on old rows: “Unknown” with totals intact. Inactive staff: history retained.
- Showroom switching: new session → new scope; no cross-showroom leakage via cached client state (client refetches on scope/range change).
