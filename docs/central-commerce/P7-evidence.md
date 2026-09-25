# P7 — Order Status Push · Evidence

Branch: `feature/central-commerce-p0` · **NOT committed** (per instruction).
Plan: `/Users/riaz/.commandcode/plans/central-commerce-multistore-integration.md`
§8.6 (BR-17), BR-17 row, P7 row. Entry prerequisite P6 satisfied at `da2f4d0d`.

## 1. Migration (ONE, additive only)

- `apps/backend/prisma/migrations/20260925190000_p7_order_status_push/migration.sql`
  — `ALTER TABLE "StoreOrderMapping" ADD COLUMN "lastPushedStatus" TEXT`
  (nullable, NULL = never pushed). No drops/renames/index changes.
- Applied: `lastPushedStatus` present on dev DB;
  `_prisma_migrations` contains `20260925190000_p7_order_status_push`
  (after `…_p6_order_ingestion`). `npx prisma generate` clean.
- Semantics: canonical push target (`cancelled` | `completed`) last
  confirmed on the store. Written only by `StoreOrderPushService` after
  read-back verification; the idempotency key for replays.

## 2. Files

New backend (`apps/backend/src/stores/orders/`):
- `store-order-push.service.ts` — §8.6 worker + notify:
  `PUSHABLE_ECO_STATUSES = [Cancelled, Delivered, Returned]`,
  `ECO_STATUS_TO_CANONICAL_TARGET` (Cancelled→`cancelled`,
  Delivered→`completed`, Returned→null), pure `targetForEcoStatus()`
  (capability-driven, case-insensitive via `TARGET_SYNONYMS`
  `completed: [completed, fulfilled]` — Shopify P9 `CANCELLED/FULFILLED`
  resolves with zero slug branching), `notifyOrderStatusChanged()`
  (flag-gated, mapping+status re-read, enqueue only, never throws — R-2),
  `handlePush()` (SyncRun `ORDER_PUSH`: mapping → live-status re-read
  (`STATUS_SUPERSEDED` on stale payload) → store CONNECTED gate →
  `providerFor` (NATIVE throws → `PROVIDER_UNRESOLVABLE` skip, BR-20) →
  capability gate (`ORDER_STATUS_UPDATE_UNSUPPORTED` /
  `UNSUPPORTED_TARGET:*` / `NO_PUSH_TARGET_FOR_RETURNED` — all explicit
  SKIPPED, never silent) → `lastPushedStatus` idempotency
  (`ALREADY_PUSHED:*`, zero provider calls) → push + `verifyReadBack`
  (one repair push + re-read, then retryable `ORDER_PUSH_VERIFY_FAILED`)
  → `lastPushedStatus` write + SUCCESS item; failures use the standard
  §8.1 ladder `classifyProviderError` + `MAX_SYNC_ATTEMPTS`/`RETRY_BACKOFF_MS`
  (engine-owned re-enqueue, BullMQ attempts stay 1; DEAD → `ORDER_PUSH_DEAD`
  issue). BR-17: only status travels; totals/items/prices never read/written.
- `__tests__/store-order-push.spec.ts` — 20 tests (see §3).

Modified backend:
- `orders/orders.service.ts` — 4 post-commit, non-propagating hooks via
  `notifyStoreOrderPush()` (void + catch, no provider call — R-2):
  `updateStatus` (Cancelled/Delivered/Returned), bulk transition
  (per transitioned id), `cancelByCustomer` (unconditional — cancel path),
  status-transition method (Cancelled/Delivered/Returned). Worker re-reads
  live state; non-mapped orders no-op.
- `orders/orders.module.ts` — imports `StoresModule` (acyclic: Stores never
  imports Orders; ingest still lazy via ModuleRef). Injects
  `StoreOrderPushService` into `OrdersService` as `@Optional()`.
- `stores/stores.module.ts` — registers + exports `StoreOrderPushService`.
- `stores/sync/sync.processors.ts` — `StoreOrderPushProcessor` executes
  `order-status-push` via `serializeStore` (per-store, R-8); unknown job
  names → explicit SKIPPED item, never silent (replaces P6 `P7-deferred` stub).
- `stores/providers/provider.contract.ts` — optional `readOrderStatus()`
  (keeps contract backward-compatible).
- `stores/providers/base-provider.ts` — `readOrderStatus` default loud-throws
  (`VERIFY_UNSUPPORTED`, never a silent verify-pass); `pushOrderStatus`
  stays on the existing loud stub.
- `stores/providers/woocommerce.provider.ts` — P7 live seams (both real HTTP):
  `pushOrderStatus` (`PUT /orders/{id} {status: target}`, pre-existing) +
  `readOrderStatus` (`GET /orders/{id}` → raw `status`; worker compares
  case-insensitively, status-only).
- `stores/providers/shopify.provider.ts`, `custom-bridge.provider.ts` —
  comment-only: push/read stay on the base loud stub until P9/P10; the worker
  classifies the throw (permanent) and records it, never silence.
- `stores/providers/__tests__/fake.provider.ts` — P7 remote-status map:
  `pushOrderStatus` writes it, `readOrderStatus` reads it,
  `directSeedOrderStatus`/`remoteOrderStatus` white-box seams.
- `stores/providers/__tests__/woo-live.spec.ts` — +2 P7 tests (read seam URL/
  method; push→read-back round-trip `cancelled`→`completed` with PUT bodies).
- `stores/store-flags.ts` (+ spec) — `store_order_push_enabled` in
  `STORE_RUNTIME_FLAGS`; `orderPushEnabled()` nested under `orderSyncEnabled`
  (fail-closed, no bypass). Worker AND notify both check it.

Queues: `store-order-push` (concurrency 5, limiter 20/s, attempts 1) unchanged
from P4; per-store serialization + circuit breaker reused; no new queue.

## 3. Tests (§13) — all green

Backend full: **242 suites / 3404 tests pass**; `npx nest build` clean
(exit 0); `npx prisma generate` clean.
P7 suites (3 files, 23 tests):
`store-order-push` 20 = pure target resolution 4 (Woo targets, Shopify
uppercase, Returned skip, unsupported/non-pushable) · notify 4 (enqueue for
mapped+pushable; non-mapped never pushed — `findUnique` untouched; non-pushable
never enqueued; flag-off no-op) · worker cancel→cancelled + Delivered→completed
(read-back-verified, mapping write, SUCCESS item) + idempotent second run
(zero non-capability provider calls, `ALREADY_PUSHED`) · explicit skips 6
(`UNSUPPORTED_TARGET`, `ORDER_STATUS_UPDATE_UNSUPPORTED`, `Returned`,
`MAPPING_GONE` (provider never resolved), `STATUS_SUPERSEDED`, `STORE_NOT_CONNECTED`)
· retry ladder 3 (transient → `RETRY_SCHEDULED:1` + 30s delay re-enqueue, no
issue, no mapping write; permanent → DEAD + `ORDER_PUSH_DEAD`; verify-mismatch
→ exactly 2 pushes + 2 reads then classified failure, no mapping write) ·
`woo-live` +2 (P7) · `store-flags` +1 (push nested under order sync).
`provider-contract` + `orders.service` suites (263) re-run green against the
changed FakeProvider and the `OrdersModule → StoresModule` edge.
Admin/storefront untouched (no suites run per task scope).

Required vectors: cancel→cancelled ✓, Delivered→completed ✓, idempotent ✓,
skip (unsupported/Returned/disabled) ✓, non-mapped never pushed ✓.

## 4. Live E2E (built backend + Postgres + Redis, flags on) — 18/18 PASS

Stub-Woo (`PUT /orders/9001` recorded, mutable `GET`) → store create (201) →
`test-connection` authenticated → CONNECTED → `reconcile-orders` ingests ext
`9001` → cancel (200) → stub `PUT {status:cancelled}` + `lastPushedStatus =
cancelled` + remote read-back `cancelled` → re-hold (200) → 6s settle →
re-cancel (200) → 10s settle → stub PUT count unchanged (1→1, `ALREADY_PUSHED`
no-op) + mapping still `cancelled` → order trashed → store hard-deleted
(cascade) → 0 mappings, 0 store rows. Scripts: `.tmp-e2e/p7-stub-woo.js`,
`.tmp-e2e/p7-live-e2e.js` (workspace-root only; backend watch-restart trap
respected — no scripts under `apps/backend`).

## 5. Example walkthrough

`PUT /api/orders/:id/status {Cancelled}` on a mapped order → post-commit
`notifyOrderStatusChanged` enqueues `store-order-push/order-status-push`
(unique job id) → worker begins `ORDER_PUSH` run → capability resolution
(`['cancelled','completed']` ∋ `cancelled`) → idempotency check → Woo
`PUT /orders/9001 {status:'cancelled'}` → `GET /orders/9001` reads
`cancelled` → `lastPushedStatus='cancelled'` + SUCCESS item. A Shopify store
declaring `['CANCELLED','FULFILLED']` resolves the same canonical target; an
unsupported target or `Returned` records SKIPPED with reason; a stale enqueue
after re-hold records `STATUS_SUPERSEDED`.

## 6. Gaps / follow-ups (nothing blocking P7)

- Shopify live push (`CANCELLED`/`FULFILLED` HTTP) is P9 (needs dev store +
  custom-app token); Custom bridge push is P10 (manifest). Both stay loud
  stubs — core needs no change to add them (abstraction acceptance test).
- `Returned` has no phase-1 remote target by design → explicit skip; a
  return-to-store mapping (if ever wanted) is a future provider decision,
  never a silent push.
- No admin UI for push state in P7 (Sync Center is P11); state is observable
  today via `SyncRun`/`SyncRunItem` (`ORDER_PUSH`) + `StoreOrderMapping.
  lastPushedStatus`.
- Pre-existing unrelated drift (`MarketingFundingLedger.fundingType`
  TEXT-vs-enum, reported in P6) untouched.
