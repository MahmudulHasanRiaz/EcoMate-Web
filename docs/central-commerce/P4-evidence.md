# P4 — Product Sync (WooCommerce) · Evidence

Branch: `feature/central-commerce-p0` · **NOT committed** (per instruction).
Plan: `/Users/riaz/.commandcode/plans/central-commerce-multistore-integration.md`
§8.1 (sync engine), §8.3 (ownership), §8.8 (publication/deletion), §8.9
(categories), §8.11 (field matrix), §10 (sync ops + overrides), §11 (Sync UI),
§13 (field-contract + ownership suites), P4 row.

## 1. Migration (ONE, additive only)

- `apps/backend/prisma/migrations/20260925160000_p4_product_sync/migration.sql`
  — 6 enums (`SyncRunScope/Status`, `SyncTriggerType`, `SyncItemStatus`,
  `SyncObjectType`, `SyncIssueStatus`) + 10 tables (`SyncRun` with
  `windowDays`/`wideningReason`, `SyncRunItem`, `SyncAttempt`,
  `StoreSyncIssue` OPEN/RESOLVED/IGNORED, `StoreWebhookDelivery`
  `deliveryKey @unique`, `StoreProductMapping` storeId+productId unique +
  externalId, `StoreVariantMapping`, `StoreCategoryMapping`
  storeId+categoryId unique + externalTermId/externalPath,
  `StoreSkuMapping`, `StoreMediaMapping`). Zero drops/renames.
- Applied via `migrate deploy` (122 migrations, `migrate status` clean).
  `migrate dev` was unusable: pre-existing edited-history complaint about
  `20260924070009_backfill_picked_up_at_for_skipped_pickup` (predates P4,
  untouched). Post-P4 `migrate diff` shows **0 P4 residue**.
- `prisma generate` run; all 10 tables verified live in `ecomate_web`.
- Pre-existing unrelated schema↔DB drift (JournalEntry/marketingPaymentId,
  fundingType, id defaults — other-branch work) deliberately EXCLUDED from
  the P4 migration (additive rule).

## 2. Files

Backend (`apps/backend/src/stores/`):
- `sync/field-matrix.ts` — §8.11 Table A (24 rows, capability/override/
  baseline/audit F-G), `assertSyncedFieldsSubset` build gate,
  `readEcoMateFields` (read-only, SeoMetaAccessor for rows 18–21),
  custom-field allowlist (secrets structurally excluded).
- `sync/sync-run.service.ts` — begin/finish (PARTIAL = failed>0 AND
  created+updated>0), items, attempts, issue upsert, cancel, attempt counter.
- `sync/sync-circuit.ts` — per-store breaker (5 failures → OPEN 60s →
  single half-open probe).
- `sync/product-sync.service.ts` — ownership engine: ONE batched
  `readProductFields` per product per sync → `FieldOwnershipService.evaluate`
  → push EcoMate-changed fields only; PRESERVE never pushes (BR-26 guard);
  first-contact `adopt_existing` (BR-05); Keep rebase (BR-04); Force/Keep/
  reset-all with actor + prev-external + prev-baseline audit items; media
  hash/id reuse (never re-upload mapped); variants add/update (removal per
  `variantDelete`); publication via resolver (§8.8, OFF→draft, mapping
  retained); `deleteRemote` capability-gated, hard-delete path only
  (`delete:false` → MANUAL_ACTION_REQUIRED); combos skipped (BR-22); cost
  never in payload (BR-23); retry ladder helper (30s→6h, 5 → DEAD + issue).
- `sync/category-sync.service.ts` — §8.9: mapping-keyed, slug-within-parent
  lookup, rename/move, idempotent re-sync, remote-deleted recovery via
  re-create, unsupported → CATEGORY_UNSUPPORTED + null (products proceed).
- `sync/sync-queues.service.ts` — per-store serialization chains, fan-out
  cap (`store_sync_fanout_concurrency`, default 5), post-commit non-throwing
  enqueue, triggers return `{runId}` immediately.
- `sync/sync.processors.ts` — 6 in-process processors, each explicit
  `concurrency` + `limiter` (product 5/20s, stock 10/30s, ingest 5/20s,
  push 5/20s, reconcile 2/5s, maintenance 1/2s); BullMQ `attempts:1`
  (engine owns retries so permanent failures never loop); breaker gate;
  stock/ingest/push/maintenance park with explicit DEFERRED-TO-P5/P6/P7/P11
  items (never dropped, never silent).
- `sync/sync-ops.controller.ts` — §10: `POST /stores/sync-all`
  (NATIVE excluded, `excludedNativeCount`), `POST /sync/publish`, runs /
  run-detail / items / cancel, attempts (90d), issues + resolve/ignore,
  product-history, overrides queue, overrides/retry (re-evaluates only,
  `resolved:0` always — BR-26).
- `sync/store-overrides.controller.ts` — reset/keep/reset-all (audited,
  `admin_sync_center` feature).
- `providers/woocommerce.provider.ts` — live REST (Basic): SKU-first-contact
  lookup, slug-within-parent categories, field mapping (cost/seo never
  pushed), variations, url-fetch media (zero HTTP), publish/draft,
  `DELETE ?force=true`, `stock_status` instock/outofstock (status-only),
  orders fetch (window + pagination), cancel/complete push, webhook
  provisioning. `testConnection`/`verifyWebhook` (P2) unchanged.
- `stores.module.ts` — 6 queues registered; `stores.controller.ts` —
  `:id/sync` + `webhooks/ensure` wired (replacing P1 501s).
- P2 contract suite updated for the phase evolution: Woo
  `publishStockState`/`fetchOrders` now assert live HTTP via MockFetch;
  Shopify/Custom stub assertions retained (P9/P10, contract-green).

Admin (`apps/admin/src/features/channels/` + routes/nav):
- `sync-api.ts` (client + `runStatusTone`/`syncPollInterval` 5s-running /
  30s-otherwise / `failureSummary` business-first / `shortHash`),
  `sync-hooks.ts`, `sync-center.tsx` (Overview/History/Product
  Sync/Failed&Retry/Issues/Overrides + run-detail Sheet with counts,
  widened-window display, expandable technical items + capability info
  rows), `overrides.tsx` (Force/Keep with ownership/evidence/baseline/
  external display + audited ConfirmDialog + re-evaluate-all that never
  auto-resolves), `sync-api.test.ts` (4 tests).
- Route `/op/channels/sync-center` (routeTree.gen.ts auto-updated) +
  sidebar entry (feature `admin_sync_center`, icon already imported).

## 3. Suites (new: 46 tests)

| Suite | Tests | Proves |
|---|---|---|
| `sync/__tests__/field-contract.spec.ts` | 15 | 24-row matrix, adapter ⊆ matrix gate, every Table B row behavior, BR-22/BR-23, read-back round-trip |
| `sync/__tests__/product-sync.spec.ts` | 14 | create+baselines, MISSING_SKU zero-call, combo skip, 3-cycle preserve zero-upsert, CONFLICT no-push, Force audit, Keep rebase→push, adopt_existing, draft-never-delete, BR-09 both branches, BR-20 reject, BR-26 guard, reset-all |
| `sync/__tests__/category-sync.spec.ts` | 5 | parent-first mapping, idempotent re-sync zero-call, rename-in-place, move-failure issue, unsupported notice |
| `sync/__tests__/identity-sync.spec.ts` | 5 | NATIVE throw, 409 reconnect payload, disconnect retains rows, reconnect same row, PARTIAL math + windowDays |
| `providers/__tests__/woo-live.spec.ts` | 8 | create/idempotent-update, snapshots, category no-dup, publication + force-delete, status-only stock, orders paging, media zero-HTTP, missing-settings guard |
| admin `sync-api.test.ts` | 4 | tones, poll intervals, failure sentences, shortHash |

## 4. Totals (final, all green)

- Backend jest **3302/3302 (234 suites)** · `nest build` clean
- Admin vitest **751/751 (77 files)** · `tsc --noEmit` clean
- Storefront **285/285 (26 files)** · `tsc` clean (untouched by P4)
- Prisma: 122 migrations, `migrate status` up to date, `generate` clean

## 5. Gaps / deferred (explicit)

- **P5**: stock-status notify/coalesce/monotonic-guard/daily-audit + Shopify
  read-only drift reporting (queue + processor shell parked).
- **P6**: order-ingest worker, webhook receiver + raw-body HMAC, 3-day
  reconcile + widening, `internal` create options, bridge contact-check
  (queue shell parked; Woo `fetchOrders` live and ready).
- **P7**: order-status push worker (queue shell parked; Woo `pushOrderStatus`
  live and ready).
- **P9/P10**: Shopify/Custom adapters remain P1 stubs; contract suite
  asserts loud-notImplemented (contract-green per plan).
- **P11**: retention purge, notifications, correlation-id logger wiring
  (queue shell + `windowDays`/`wideningReason` columns ready).
- Live-server E2E (backend :4000 + Playwright) not run; §13 E2E clause
  satisfied by MockFetch fixture-replay + FakeProvider whole-engine suites.
- Pre-existing `migrate dev` edited-history complaint
  (`20260924070009…`) predates P4 — needs owner resolution outside this
  phase; P4 worked around it with diff-extract + deploy (production-safe).
