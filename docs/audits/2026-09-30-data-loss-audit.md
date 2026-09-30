# Data-Loss Audit — Findings Register

Date: 2026-09-30
Scope: deploy/redeploy data-loss risk + data integrity in recently committed code (`c377067f..3746b634`) + background jobs.
Method: 4 parallel reviewers (migrations, boot/seed, background jobs, recent-diff review) + direct source verification by the main thread.
Status: **findings only — nothing fixed, nothing committed.**

## Legend
- 🔴 CRITICAL/HIGH — can destroy or corrupt live production data
- 🟡 MEDIUM — wrong business numbers or integrity drift under normal operation
- 🟢 LOW — hygiene / robustness

---

## A. Deploy-path data loss (fires on redeploy regardless of migration state)

### 🔴 A1 — Every boot can drop live columns
- `apps/backend/src/prisma/prisma.service.ts:324` (call), `:967-996` (`dropStaleColumns`)
- Reads the **image's own** `prisma/schema.prisma`, then for every model runs
  `ALTER TABLE "<model>" DROP COLUMN IF EXISTS "<relationFieldName>"` for any column
  that exists in the DB, is named like a relation field, and is not declared as a scalar.
- **No `NODE_ENV` gate.** Contrast: `ensureSchemaColumns()` → `autoHealSchema()` IS gated
  at `:717-719` (`NODE_ENV !== 'production'`). `dropStaleColumns` is called *before* it and is not.
- Impact: rolling back to an older image, or any redeploy where the image's schema.prisma is
  older than the applied migrations, **drops live columns and their data**. Errors are swallowed (`catch {}`).
- Fix: gate the whole boot-time schema repair on `NODE_ENV !== 'production'`
  (keep `isRestoreWriteBlocked()` deferral), or at minimum never DROP in production.

### 🔴 A2 — `RUN_SEED=true` resets branding + admin password every boot
- `apps/backend/prisma/seed.ts:955` — `systemSetting.upsert({ where:{key}, update:{ value: s.value } })`
  for ~30 keys (`store_name`, `store_phone`, `hero_slides`, `seo_*`, `footer_*`, `currency`,
  `delivery_charge`, `free_delivery_min`, `about_us_text`, `shipping_info`, `payment_info`).
  Every other seeder in the file uses `update: {}` — this is the outlier.
- `apps/backend/prisma/seed.ts:34-41` — `plainPassword = process.env.ADMIN_PASSWORD || 'Admin@123'`,
  and the upsert **overwrites the live superadmin password** on every run.
  `docker-compose.yml:112` passes `ADMIN_PASSWORD: ${ADMIN_PASSWORD:-}` → empty string is falsy → `Admin@123`.
- Trigger: `startup.sh:37-40` runs `npx prisma db seed` whenever `RUN_SEED=true`.
  Current compose/stack default is `false`, so production is safe **today** — the landmine arms
  the moment a client sets `RUN_SEED=true`.
- Impact: every redeploy wipes all client-edited branding/SEO/delivery settings and resets the
  superadmin password to a publicly known value.
- Fix: `update: {}` for existing setting keys (create-only), and never overwrite an existing
  admin password (only set on create); require an explicit `ADMIN_PASSWORD` when seeding.

### 🔴 A3 — Migration-safety gate never runs
- Gate exists: `apps/backend/src/prisma/migration-safety.p0.spec.ts` (blocks `DROP TABLE`,
  `ALTER TABLE … DROP COLUMN`, `ALTER TYPE … DROP VALUE`, `DROP INDEX`, but only for folders
  newer than `20260925`, with a per-pattern allowlist for 2 migrations).
- `.github/workflows/ci.yml` runs **no tests at all** (only builds 4 images + fires the Portainer
  webhook) — verified: no `jest`/`npm test`/`migration-safety` reference in any workflow.
- Gate blind spots: `DELETE FROM`, `TRUNCATE`, `SET NOT NULL` (no default), narrowing
  `ALTER COLUMN … TYPE` are not patterns at all. The 20260925 cutoff exempts 119 of 133 migrations.
- Impact: a destructive migration reaches production unchallenged.
- Fix: run jest (or at least this spec) in CI; add `DELETE FROM`/`TRUNCATE` patterns.

### 🟡 A4 — `SEED_DUMMY_DATA` fails open
- `apps/backend/prisma/seed.ts:30` — `const seedDummyData = process.env.SEED_DUMMY_DATA !== 'false'`
  → unset means dummy data **ON**. Compose sets it, but any manual
  `npx prisma db seed` / `docker exec … prisma db seed` without the var injects demo
  customers/products/**orders/payments**.
- `seed.ts:789, 847` — demo `Order.create` / `Payment.create` have no existence guard
  (products `:570` and combos `:683` do) → repeat runs duplicate demo orders/payments.
- Fix: `=== 'true'`.

### 🟡 A5 — Order-status transition map is a second source of truth vs migrations
- `apps/backend/prisma/seed.ts:141` declares `'Partial': ['Delivered', 'Return Pending']` and
  `:145-153` **unconditionally overwrites every status' `nextStatuses`**.
- Migration `20260930010000_rtn_return_orders/migration.sql:26-34` removes `Delivered` from
  `Partial.nextStatuses` (the RTN business rule). Any `RUN_SEED=true` redeploy silently restores it.
- Impact: staff can close a Partial order as Delivered, bypassing the RTN workflow — no return
  order, no quantity reduction, wrong order totals/quantities permanently.
- Fix: remove status-transition writing from the seed, or align it with the migration.

### 🟡 A6 — Retention cleanup enabled by default, not exposed in config
- `apps/backend/src/tracking/retention-cleanup.service.ts:89-92` — `RETENTION_ENABLED` defaults ON
  (only literal `'false'` disables); hard-coded windows (90d context anonymisation, 90d payload
  nulling, **30d outbox DELETE**, 1y dispatch, 2y snapshot). Sweeps run on boot **and** every 6h.
- `RETENTION_ENABLED` appears in no compose/stack/`.env.example` file → operators can't see or control it.
- Also `tracking/retention-cleanup.service.ts:338-339, 385-388` — the archive-before-purge path can
  never fire for snapshots older than 30d because `purgeTerminalOutboxes` (`:209`) already deleted
  the outbox row, so `archiveRows` skips them and they are still deleted at `:385`.

### 🟢 A7 — Non-idempotent boot SQL outside migration history
- `apps/backend/scripts/fix-p2039.sql:60-67` (drops/recreates the `Employee.betterAuthUserId` FK with
  `ON DELETE CASCADE`) and `scripts/reconcile-hr-base.sql:215-402` (16 × `ALTER COLUMN … TYPE` casts,
  `DROP DEFAULT`) run via `startup.sh:33` → `resolve-failed-migrations.sh:559-568` on **every boot**,
  outside `_prisma_migrations`. DDL only (no data DML), but changes future delete semantics and
  re-runs table rewrites on every restart.
- `prisma/scripts/e2e-inventory-test.ts:874-880` ships in the production image and contains an
  unfiltered `blockedIp.deleteMany()` — manual-only, but a hazard if ever executed against prod.

---

## B. Data integrity in recently committed code (`c377067f..3746b634`)

### 🔴 B1 — RTN return orphans `PhysicalReservation` rows
- `apps/backend/src/rtn/rtn.service.ts:321` — `tx.orderItem.delete({ where: { id: item.id } })`
  when a line is fully returned.
- Verified: `PhysicalReservation` has **no FK to `OrderItem`** (constraints are only
  `productId`, `warehouseId`, `cycleId`); `schema.prisma` has only `@@unique([orderItemId, cycleId])`.
- Impact: the reservation + its `PhysicalReservationAllocation` rows are orphaned while still
  ACTIVE. The release path resolves by `orderItemId`
  (`stock/cancel-return-stock.service.ts:210-220`), which can no longer match →
  `reservedQuantity` on `PhysicalInventory` can never be released → showroom availability is
  permanently understated and stock can never reconcile. Also destroys the record of what was sold.
- Fix: don't hard-delete the order item (soft-delete/`removedAt`), or cascade-delete the
  reservation explicitly in the same transaction.

### 🔴 B2 — Returned POS sales disappear from POS analytics
- `apps/backend/src/pos-analytics/pos-analytics.service.ts:17` (`EXCLUDED_STATUS_NAMES` includes
  `returned`, `damaged`) + `:178` (also filtered by `source: 'POS'`, and RTN orders are `source: 'MANUAL'`).
- A full POS return never re-bases the original order's `total` (only the partial path does).
- Impact: **POS net sales overstate revenue by the value of every returned POS sale**;
  `analytics.service.ts:27` / `dashboard.service.ts` count those same orders, so the admin
  dashboard and POS analytics disagree on the same business number.
- Fix: count returns as negative entries (RTN orders linked via `returnOfOrderId`), or restate
  the original order on full return.

### 🔴 B3 — Excel detail column does not reconcile with the TOTAL row
- `apps/backend/src/pos-analytics/pos-analytics.service.ts:505-536`
  - detail `Line Total` = `it.qty × it.unitPrice` (gross — order discount excluded)
  - fully-refunded orders are **also written** into the detail sheet
  - `row.discount` is repeated on **every** item line of a multi-line order
  - the `TOTAL (Net Sales…)` row puts **`kpi.net`** in that same column 10
- Impact: summing the visible "Line Total" column never equals the printed TOTAL; summing
  "Discount" multiplies it by line count. The sheet ships an autoFilter that invites exactly
  this sum. This is the dashboard-vs-export consistency failure the spec forbade (§10).

### 🔴 B4 — `GET /pos/orders/:id` has no showroom scope (IDOR)
- `apps/backend/src/pos/pos-orders.controller.ts:39-43` → `pos-orders.service.ts:800-802`
  `where: { id, source: 'POS', trashedAt: null }` — no showroom/session filter.
- Impact: any authenticated cashier can read any POS order by UUID across showrooms —
  customer name, phone, address, payments.
- Fix: derive the showroom from `x-pos-session-id` (as `createTransferRequest` and the
  analytics controller already do) and scope the query.

### 🟡 B5 — Percentage discounts re-based on return
- `rtn.service.ts:227-230, 349-374` — RTN subtotal is gross (`price × qty`, no discount share);
  the original is re-totaled with `recalculate()` which recomputes `effectiveDiscount` on the
  *reduced* subtotal. Stored `Order.discount` is not updated → `discount` no longer reconciles
  with `total`, which propagates into `pos-analytics` `discountTotal` and discount reports.

### 🟡 B6 — Lost update on `Order.timeline`
- `rtn.service.ts:365-371, 606, 639` builds the timeline from a read **outside** the transaction
  and writes it wholesale. Concurrent `addNote` / `updateStatus` / dispatch-sync writes are lost.
  Three writers, no version check → audit entries can disappear during return processing.

### 🟡 B7 — `fullHeal` can return a genuinely delivered order
- `rtn.service.ts:458, 615` — `fullHeal = status === 'Delivered' && !rtn` combined with
  `eligibleDispatchStates` reaches `restoreForOrder` and sets the order to `Returned`.
  If a dispatch is `PARTIAL` while its order was advanced to `Delivered`, stock is added back for
  goods that left the building.

### 🟡 B8 — My destructive-wipe guard is partial
- `physical-inventory.controller.ts:20-58` — availability is read in a **separate query** before
  the write (TOCTOU: two concurrent adjusts can both pass); `if (available <= 0) return;` allows an
  unlimited wipe when reserved ≥ on-hand; and the guard exists **only** on the physical endpoints —
  the managed-stock adjust path (`inventory.controller.ts`) can still be zeroed by one mis-keyed entry.

### 🟡 B9 — Cross-session transfer-request adoption
- `pos-orders.service.ts:1317-1358` — `pendingHeaders` filters only on
  `destWarehouseId: showroomId` + `status IN (REQUESTED, APPROVING)`, with **no cashier/session
  filter**. A second POS session in the same showroom adopts the first session's pending request.

### 🟡 B10 — Analytics/export unavailable after session close
- `pos-analytics.service.ts:118-124` throws `'POS session is not active'` for a closed session →
  a cashier finishing a shift cannot export their own day.

### 🟢 B11 — Export is fully in memory
- `pos-analytics.service.ts:433, 543` — `detail.push(row)` accumulates all rows, then
  `wb.xlsx.writeBuffer()`. The 500-row `FETCH_CHUNK` bounds the DB page, not memory. A 366-day
  custom range on a busy showroom can OOM the container.

### 🟢 B12 — `GET /inventory/transfers` `perPage` unbounded
- `inventory.controller.ts` parses `perPage` with no cap (unlike the analytics DTO's `@Max(100)`).

---

## C. Background jobs (verified)

- **No scheduled job deletes or mutates** `Order`, `Payment`, `OrderItem`, `PhysicalInventory`,
  `ManagedStockLedger`, `CostingLot`, `StockTransfer`. The only writer is
  `stock/stock-reconciliation.service.ts` (opt-in via `STOCK_RECONCILE_ON_BOOT=true`, **off by
  default**, idempotency guards sound) — correct design.
- `security-dashboard/retention-cleanup.service.ts:411` — `retentionDays` has **no lower bound**;
  `0` wipes that category on the next sweep.
- `security-dashboard/processors/security-event.processor.ts:116,141,174` — aggregate
  `increment: 1` upserts are **not** idempotent; a BullMQ retry after a partial failure
  double-counts hourly/daily/block totals permanently.
- `backup/backup.service.ts:1316-1389` — `nonNegativeInteger` accepts `0`, so
  `backup_retention_daily=0` deletes all backups in that bucket on the next run.
- `marketing/marketing-consumption.service.ts:82-120` — no dedupe key; a repeated sync re-covering
  the same insight date double-draws prepaid balance and double-posts a journal entry.
- `retention-cleanup.service.ts:23-25`, `webhook-attempt.service.ts:45-46`, `auth.service.ts:37` —
  timers never cleared on module destroy → each hot reload/redeploy stacks another sweep timer
  (write amplification, not corruption).
- `stock/costing-lot.service.ts:39-41, 43-59` — `consumeFIFO` decrements `remainingQty` with no
  guard and on insufficient lots `break`s with only a `console.warn` → silent partial consumption.

---

## D. Verified sound (no action)

- Production migration path is `prisma migrate deploy` only — **no** `db push`, `migrate reset`,
  `--force`, `--accept-data-loss` in any script, Dockerfile, or workflow.
- Zero rollback SQL exists for any of the 133 migrations — every destructive statement is
  irreversible; recovery requires a restore.
- No automatic backup-restore over live data; boot correctly fails closed (503) during a restore
  and defers seed/repair writes (`prisma.service.ts:318-323`, `main.ts:136-226`).
- Analytics scope is server-derived; forged `showroomId` rejected 400 in both controller and service.
- `restoreForReturnOrder` sets `Order.stockRestored` **inside** the stock transaction —
  durable idempotency. RTN claim uses `updateMany({where:{id,status}})` + `count===0` race branch.
- Outbox relay + reconciler are replica-safe (`FOR UPDATE SKIP LOCKED`, composite job ids).
- `scripts/backup-db.sh` is manual and only prunes local `.sql` files older than 7 days.

---

## E. Recommended order of work

1. **A1** — gate boot-time schema repair (dropStaleColumns) on non-production. *Highest risk-to-effort ratio.*
2. **B4** — showroom-scope `GET /pos/orders/:id` (PII leak).
3. **B1** — stop orphaning `PhysicalReservation` on return.
4. **A2** — seed must not overwrite settings or an existing admin password.
5. **B2 + B3** — POS analytics return handling + export column reconciliation (they are the same business-number contract).
6. **A3** — run the migration-safety gate in CI; add `DELETE FROM`/`TRUNCATE` patterns.
7. **A5** — remove the second source of truth for order-status transitions.
8. **A4, A6** — fail-closed seed defaults; expose `RETENTION_ENABLED` in compose/stack.
9. **B5-B10** — integrity hardening (discount re-basing, timeline versioning, `fullHeal` predicate, guard scope/TOCTOU, session-scoped requests, closed-session export).
10. **C** — background-job hardening (retention lower bounds, idempotent aggregates, dedupe keys, timer cleanup).

---

## F. Verification & fix status (2026-09-30, post-audit pass)

Every finding was re-verified against the source before acting. Verdict legend:
**FIXED** (code + tests), **NOT VALID** (claim does not hold — reason given),
**DEFERRED** (valid but deliberately out of this pass).

### A — deploy path

| # | Verdict | What was done |
|---|---------|---------------|
| A1 | **FIXED** | `dropStaleColumns()` now returns early on `NODE_ENV === 'production'` (logged), keeping the `isRestoreWriteBlocked()` deferral. Additive static FK/column repair is unchanged. Guarded by `src/prisma/deploy-safety.spec.ts`. |
| A2 | **FIXED** | Admin password is **create-only** (existing row → password untouched); on a fresh production seed `ADMIN_PASSWORD` is required (aborts instead of creating the public default). System settings upsert is `update: {}` (create-only). Live evidence: ran the real seed on the dev DB — admin hash, settings values and status transitions unchanged. |
| A3 | **FIXED** | New CI `test` job (`npm ci --ignore-scripts` + `npx jest migration-safety`) and `build: needs: [test]`, so a destructive migration can no longer reach a published image or the Portainer redeploy. Gate patterns extended with `DELETE FROM` / `TRUNCATE`; the one pre-existing `20260928000400_purge_discarded_invoices` is allowlisted. Remaining gaps (`SET NOT NULL`, narrowing `ALTER COLUMN … TYPE`, the 20260925 cutoff) are unchanged and noted as future work. |
| A4 | **FIXED** | `SEED_DUMMY_DATA === 'true'` (unset now means OFF — the live run proved demo data is no longer injected). Demo orders/payments additionally guarded by an existence check per demo customer. |
| A5 | **FIXED** | Transitions now come from ONE shared map (`src/orders/order-transitions.ts`, imported by both `OrdersService` and the seed), are written **only for statuses created during that run**, and `Partial` no longer offers `Delivered`. The Dockerfile ships the shared constants file so the image's `prisma db seed` resolves the import. |
| A6 | **FIXED** | `RETENTION_ENABLED` (default true) now appears in `docker-compose.yml`, `.env.example` and `portainer-stack.json`. The archive pass treats a **missing** outbox row as terminal, so 2y snapshots whose terminal outbox was purged at 30d are archived instead of dropped unarchived (new test). |
| A7 | **PARTIAL** | `prisma/scripts/e2e-inventory-test.ts` now refuses to run with `NODE_ENV=production` unless `ALLOW_E2E_INVENTORY=true` (before its unfiltered `blockedIp.deleteMany`). The boot-time DDL re-runs from `resolve-failed-migrations.sh` were **not** changed (verified DDL-only, no DML). |

### B — recently committed code

| # | Verdict | What was done |
|---|---------|---------------|
| B1 | **FIXED** | A fully-returned line now releases its holds **before** it is deleted, inside the same transaction: ACTIVE physical reservation via `releasePhysicalAllocated` (standalone + combo components) and managed reservations that were reserved-but-not-deducted. Deducted lines are untouched (the RTN restore owns that quantity). 3 new tests. |
| B2 | **NOT VALID** | A returned POS sale is either *excluded* (status `Returned`, both the manual path and the dispatch full-return heal) or *re-based* (the RTN path recomputes subtotal/total from the remaining lines). There is no path where the original stays counted at full value, so net sales do not overstate. Residual (minor, not fixed): a 100 %-line RTN leaves a 0-value order that still counts in `totalOrders`. |
| B3 | **FIXED** | Export detail rows now allocate the order's net and discount across its lines (proportional, cent-exact residual on the last line; fully refunded rows contribute 0 to every line), so Σ "Line Total" = the printed TOTAL = dashboard net sales and Σ "Discount" = `discountTotal`. New reconciliation test with a multi-line + partial-refund + full-refund sheet. |
| B4 | **FIXED** | `GET /pos/orders/:id` requires `x-pos-session-id` and scopes the query to that session's showroom. Live: cross-showroom read → 404, own showroom → 200, missing/unknown session → 400. |
| B5 | **NOT VALID** | POS orders store `discountType: 'flat'` with a money discount, and the re-base keeps the `(discount, discountType)` pair consistent (`total = subtotal' + shipping − discount`). Percentage orders keep the percent, so the recomputed share is correct by construction; no consumer reads a stale "effective discount". |
| B6 | **PARTIAL/FIXED (RTN scope)** | New `appendOrderTimeline()` helper appends to `Order.timeline` with `jsonb \|\|` inside the caller's transaction; all five RTN writers (creation + finalize partial/full/heal) now append instead of rewriting a timeline read outside the transaction. The remaining wholesale writers in `orders.service.ts` (addNote, updateStatus, addItem/removeItem, bulk) still read-modify-write — converting them is a follow-up with wide test churn. |
| B7 | **FIXED** | `fullHeal` is now limited to full-consignment returns (`RETURN_PENDING` / `RETURNED` dispatches). A `PARTIAL` dispatch on a delivered order is refused (with the actionable state error) instead of restoring the whole order quantity. 2 new tests. |
| B8 | **FIXED** | Physical guard: runs inside the same transaction as the write, locks the location rows `FOR UPDATE` first (TOCTOU closed), and now also refuses a removal when `available ≤ 0`. Managed guard: same 90 %-of-available rule with `confirmDestructive` (DTO + service + admin checkbox) on the product, variant and combo paths. Tests: physical guard (7) + managed guard (6). |
| B9 | **FIXED** | The pending-transfer reuse query is scoped to `requestedBy: cashierId`, so a second session in the same showroom can no longer adopt a colleague's in-flight request (the header is already created with `requestedBy`). |
| B10 | **NOT A BUG** | The approved design (§2) states the POS session must exist **and be `open`** for analytics endpoints. Working as specified; changing it would contradict the approved contract (product decision, not a defect). |
| B11 | **DEFERRED (accepted)** | The export still buffers the workbook in memory; range is capped at 366 days and rows are read in 500-row chunks. Streaming via exceljs `WorkbookWriter` is a worthwhile follow-up but changes the controller's response plumbing. |
| B12 | **FIXED** | `perPage`/`page` are clamped (`1..100`, garbage → default) on `/inventory/transfers`, `/inventory/logs` and `/inventory/stock-overview`, with tests. Live: `perPage=99999` → 100. |

### C — background jobs

| Finding | Verdict | What was done |
|---------|---------|---------------|
| security retention `retentionDays` unbounded | **FIXED** | `updateRetentionPolicy` rejects `< 1`, non-integer, and invalid `criticalRetentionDays` (400). Live: `retentionDays: 0` / `-30` → 400. Tests added. |
| security-event aggregate increments not idempotent | **FIXED** | Raw event + hourly/daily/block aggregates now commit in ONE transaction, with a dedupKey fast-path probe; a BullMQ retry can no longer double-count (P2002 aborts the whole unit). Tests cover retry-noop, concurrent-collision, single transaction, failure propagation. |
| backup retention accepts 0 | **FIXED** | The four bucket sizes and the safety limit now require ≥ 1 (0 falls back to the shipped default). Dead `nonNegativeInteger` helper removed. |
| marketing consumption double-draw on repeat sync | **FIXED** | `consumeInsightSpend` consumes only the **delta** vs. what is already consumed for that (campaign, insight day), so a repeated sync cannot double-draw prepaid balance or double-post a journal entry. 2 new tests. |
| timers never cleared on destroy | **FIXED (auth)** / **NOT VALID (others)** | `AuthService` now stores its interval and clears it in `onModuleDestroy`. `courier-manager/webhook-attempt.service.ts` already cleared its timer (audit claim stale); `tracking/retention-cleanup.service.ts` already implements `OnModuleDestroy.stop()`. |
| `consumeFIFO` silent partial consumption | **FIXED** | Decrement is now a guarded `updateMany({ remainingQty: { gte: deductQty } })`; a lot that lost a race is skipped (excluded from the retry query, no hot loop) and a shortfall is logged at **error** level with the full reference (was `console.warn`). 4 new tests. |

**Regression after the pass**: backend jest **3476/3476** (246 suites) + `nest build` clean; admin `tsc --noEmit` clean + vitest **783/783**; storefront `tsc --noEmit` clean + **310/310**; live API probes **11/11** (config safety, retention bound, POS receipt scope, physical guard, pagination clamp); seed executed against the dev DB with zero mutation of existing rows.
