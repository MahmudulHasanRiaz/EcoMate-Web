# Operational Dashboard: Activity & Pipeline Views — Design

Date: 2026-09-24
Status: approved (design gate passed, awaiting spec review)

## 1. Context

Operations Dashboard (`/op/overview` → `DashboardWrapper route="op"`) currently shows
one blended reporting semantic. `getOperationalKpis` mixes creation events (New Orders),
transition events (Confirmed / Packed / Picked Up / Delivered from timeline + dispatch),
payment events (Cash collected), and global backlog snapshots (Pending Payments /
Pending Refunds / Low Stock). Users cannot distinguish "what happened in the period"
from "where period-created orders stand now".

## 2. Goal (scope-locked)

Same Operations Dashboard, same route, same existing status/report metrics. Add a
compact, visually obvious Activity ↔ Pipeline switch:

- **Activity** = selected period-এ কী ঘটেছে (event counts in period). This is the
  CURRENT backend semantics — unchanged.
- **Pipeline** = selected period-এ তৈরি হওয়া order cohort-এর বর্তমান status
  distribution (where they stand now).

Out of scope: new order statuses, meaning changes to existing statuses, new KPIs,
Monitoring/Management dashboard changes, breaking existing functionality.

## 3. Decisions (user-confirmed)

1. Pipeline tiles = current-status mapping onto existing 5 tiles:
   Confirmed→confirmed, Packed→packed, Shipping→pickedUp, Delivered→delivered
   (exact status-name match; Packing Hold / Hold / Pending / Payment-* / Partial /
   Return-* / Returned / Damaged / Cancelled counted in New Orders only, not in tiles).
2. Snapshot tiles (Pending Payments, Pending Refunds, Cash collected, Low Stock)
   unchanged in BOTH views (global current-state / period payment-event as today).
   Only the 5 lifecycle tiles switch semantics.
3. Switch scope = KPI strip + order lists (Pending Orders, Recent Orders get
   view-aware descriptions; their queries already cohort+current-state).
   System Alerts / Activity Log / Low Stock Alert stay untouched snapshots.
4. DateFilter gains Yesterday + All Time preset buttons (ranges already exist in
   `DATE_PRESETS`; `useDateFilter` default stays `last_30_days`).
5. View state in URL `?view=activity|pipeline`, default `activity` (shareable, survives
   preset changes).

## 4. Backend

New service method `DashboardService.getOperationalPipelineKpis(startDate?, endDate?)`
+ controller route `GET /dashboard/operational-pipeline-kpis` with existing
`@Roles('superadmin','admin','manager')` + `@RequiresFeature('admin_orders')`.

Semantics:

- Cohort: `Order` where `createdAt` in [periodStart, periodEnd], `trashedAt` null.
- `newOrders` = cohort count (same value, no new metric; frontend labels it
  "Order Cohort" in Pipeline view — see §5).
- Lifecycle tiles = single `groupBy statusId` over the cohort, mapped via status-name
  lookup (same `orderStatus.findMany` pattern as `getOrderStatusDistribution`):
  confirmed / packed / pickedUp (status 'Shipping') / delivered. Backend field names
  stay `OperationalKpi`-identical; the Shipping-vs-Picked-Up distinction is a
  frontend label concern only.
- Non-lifecycle current statuses (Pending / Payment-* / Hold / Packing Hold /
  Partial / Return-* / Returned / Damaged / Cancelled) are counted in `newOrders`
  only. Cohort total == tile sum is NOT required in this phase.
- `pendingPayments` = `payment.count({status:'PENDING'})` (same as Activity).
- `pendingRefunds` = `refund.count({status:'pending'})` (same as Activity).
- `revenue` = PAID payments with `createdAt` in period (same as Activity).
- Error handling: try/catch → log → `InternalServerErrorException`, matching file convention.

Response shape = existing `OperationalKpi` (no new DTO needed):
`{ newOrders, confirmed, packed, pickedUp, delivered, pendingPayments, pendingRefunds, revenue }`.

Why a new endpoint (not `?mode=`): Activity method is audited/lifecycle-critical;
a separate method keeps it untouched and gives distinct React-Query cache keys.

## 5. Frontend

- `useDateFilter`: add `view: 'activity' | 'pipeline'` (read from `?view=`, default
  `activity`) + `setView()` (replace navigation, preserves preset/start/end).
- New `ViewSwitch` component (`features/dashboard/components/ViewSwitch.tsx`):
  segmented pill reusing DateFilter classes
  (`rounded-xl bg-muted p-1`, active `bg-background shadow-sm`, `text-xs font-bold`),
  icons `Activity` / `Network`, labels Activity / Pipeline.
- `DashboardWrapper` (op branch): sticky header row gets `<ViewSwitch/>` beside
  `<DateFilter/>`; every op widget invocation gains `view={view}` (explicit props).
  Subtitle caption under "Operations Dashboard" becomes view-aware:
  Activity → "What happened in the selected period";
  Pipeline → "Where orders created in the selected period stand now".
  Mobile: header already `flex-col`; switch wraps below DateFilter naturally.
- `OperationalKpiStrip({ view, ... })`: query key `['operational-kpis', view, start, end]`;
  fetcher `getOperationalKpis` vs `getOperationalPipelineKpis`. Pipeline tile labels:
  New Orders → "Order Cohort"; Confirmed / Packed / Delivered unchanged; Picked Up →
  "Shipping" (Activity "Picked Up" = pickup EVENT in period; Pipeline "Shipping" =
  orders CURRENTLY in Shipping status — different semantics, different labels).
  Tile subtexts: Activity = existing `PERIOD_LABELS[preset]` / `SNAPSHOT_LABEL`;
  Pipeline lifecycle tiles = `Now · {periodLabel} cohort` (e.g. "Now · Today cohort");
  snapshot tiles unchanged. Tooltips: Order Cohort → "Total orders created in the
  selected period"; Shipping → "Orders created in the selected period, currently in
  Shipping status"; plus a strip-level note that other current statuses of the cohort
  are not yet shown as separate tiles.
- `DateFilter`: add Yesterday (`Yesterday`) + All Time (`All`) buttons to
  `DISPLAY_PRESETS` (overflow-x-auto already handles width).
- `PendingOrders` / `RecentOrders`: queries unchanged; `WidgetShell description`
  view-aware (Pipeline: "…created in the selected period, current status").
- `api.ts`: `getOperationalPipelineKpis(startDate?, endDate?)`.
- `types.ts`: `export type DashboardView = 'activity' | 'pipeline'`; `WidgetProps`
  gains `view: DashboardView` (mon branch passes `view="activity"`, ignored there).

## 6. Anti-confusion rules (acceptance-critical)

- Activity period numbers and Pipeline current-state numbers never share a label:
  period label vs "Now · {period} cohort" subtext + header caption + Picked Up tooltip.
- Pipeline tiles need not sum to New Orders (other statuses excluded by design);
  no "remainder" tile (would be a new metric — out of scope).

## 7. Tests & verification

- Backend `dashboard.service.spec.ts`: pipeline cohort mapping (confirmed/packed/
  shipping→pickedUp/delivered counted; hold/cancelled/pending excluded from tiles but
  in newOrders; trashed excluded; snapshots mirror activity logic).
- Controller spec: route exists, guards match.
- Admin vitest: ViewSwitch renders, active state obvious, `setView` updates URL;
  OperationalKpiStrip calls pipeline endpoint with view in key.
- `npx tsc --noEmit` (admin), `nest build` (backend), full backend jest + admin vitest
  regression, live curl of both endpoints for same range (activity ≠ pipeline values
  on transition-heavy data).
- Visual: start admin dev + backend, eyeball op overview at desktop + 390px
  (no screenshot tooling in this env — manual browser check).

## 8. Files to touch

- `apps/backend/src/dashboard/dashboard.service.ts` (+`__tests__/dashboard.service.spec.ts`)
- `apps/backend/src/dashboard/dashboard.controller.ts` (+`__tests__/dashboard.controller.spec.ts`)
- `apps/admin/src/features/dashboard/types.ts`
- `apps/admin/src/features/dashboard/use-date-filter.ts`
- `apps/admin/src/features/dashboard/api.ts`
- `apps/admin/src/features/dashboard/components/ViewSwitch.tsx` (new + test)
- `apps/admin/src/features/dashboard/components/DateFilter.tsx`
- `apps/admin/src/features/dashboard/components/DashboardWrapper.tsx`
- `apps/admin/src/features/dashboard/widgets/OperationalKpiStrip.tsx` (+test update)
- `apps/admin/src/features/dashboard/widgets/PendingOrders.tsx` (description only)
- `apps/admin/src/features/dashboard/widgets/RecentOrders.tsx` (description only)
