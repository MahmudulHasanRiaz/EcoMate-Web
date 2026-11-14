# P12 — Production Validation Package (execute nothing here)

Branch: `feature/central-commerce-p0` · Date: 2026-09-25.
Sources: `docs/central-commerce/FINAL-REPORT.md` (P12 drill scope, dev-only),
`docs/central-commerce/P8-evidence.md` (backfill 219/219 + parity),
`docs/central-commerce/P9-LIVE-SMOKE.md` (BLOCKED pattern to reuse for peers).
Standing rollback: FINAL-REPORT §8. **Nothing in this package is executed —
no staging/production exists in this environment.**

## 1. Migration validation checklist

1. `prisma migrate status` → **up to date** (last recorded: 126 migrations in
   FINAL-REPORT §4; P9/P10/P11/P12 added none — all additive, no
   drops/renames/enum repurposing).
2. `git diff --name-only` scope check: provider phases touch only
   `apps/backend/src/stores/providers/*` + docs (P9/P10 precedent) — any
   service/controller/worker/engine file in the diff is a scope violation.
3. `npx nest build` clean; backend jest green on the exact deploy commit
   (P10 baseline: 251 suites / 3554 tests); admin vitest + `tsc --noEmit`
   clean if admin/storefront files changed.
4. Schema rule: **no schema rollback ever** — all migrations are additive, so
   rollback is flags-off + queue-pause + deploy revert (§6), never a DB down.

## 2. Backfill dry-run procedure (ChannelResolver, P8 pattern)

1. Snapshot counts first: products, mappings (`StoreProductMapping`,
   `StoreCategoryMapping`, `StoreSkuMapping`), credentials
   (`StoreCredential` — count only, values write-only, never echoed).
2. Run the backfill against the staging copy (P8 achieved 219/219 with parity —
   re-anchor on that procedure in `P8-evidence.md`).
3. Assert: backfilled count == eligible count, parity check passes, zero secret
   echoes in rotate/detail responses (P12 §2c secret-leak proof pattern).
4. STOP if any mismatch: freeze, investigate, do not proceed to pilot (same
   before/after `products/count.json` discipline as the P9 smoke harness).

## 3. Preflight checks (run immediately before any pilot)

- Backend healthy (`/api/health` → `healthy`, DB ok); env as expected
  (`SKIP_LICENSE_CHECK` only where applicable; feature flags known).
- Flags state recorded: `THIRD_PARTY_STORES_ENABLED` +
  `store_sync/product/order/push/stock/reconcile/widening/stock_audit`
  (`apps/backend/src/stores/store-flags.ts`).
- Queue states recorded for all six queues (`sync-queues.service.ts`):
  `store-product-sync`, `store-stock-sync`, `store-order-ingest`,
  `store-order-push`, `store-reconcile`, `store-maintenance`
  (`waiting/active/delayed` counts noted).
- `SyncRun` count recorded (frozen-count check is the rollback proof).
- Blocked-entry state noted (P12 G-1 precedent: pre-existing blocks must not
  be confused with pilot effects).

## 4. Pilot sequence: Products → Orders → Stock

General rules per step: pilot-only artefacts (SKU/test-order prefix, draft
status on create); one step fully verified before the next begins; every step
has stop (halt that step), rollback (§6), isolate (quarantine that domain
without touching the others) criteria.

### 4a. Products (push → idempotency → read-back)

- Push pilot product (draft) → SKU-idempotent re-push (client-side scan → PUT,
  never duplicate POST) → media attach on pilot product only → read-back
  re-GET, SKU present.
- STOP on duplicates or silent field drops (field-matrix ownership: drift is
  detected, never auto-resolved — BR-02).
- ISOLATE: disable product-sync queue only; orders/stock paths unaffected.
- Expected evidence: run SUCCESS with items > 0, `SyncAttempt` rows, history
  readable (`/sync/attempts`, `/sync/issues`).

### 4b. Orders (pull/webhook → ingest-once → status push)

- Order fetch is GET-only (order creation NEVER attempted against the peer —
  P9 smoke §isolation properties); webhook intake reachability with
  reject-as-data; HMAC accept-good / reject-tampered; replay rejection
  (stale-timestamp / missing-delivery-id); cancel/fulfil push on PILOT order
  only with read-back.
- STOP on duplicate ingestion or push-without-read-back-agreement.
- ISOLATE: pause `store-order-ingest` / `store-order-push` only; product sync
  continues.

### 4c. Stock (fidelity-gated, zero-quantity-write proof)

- `unsupported`-fidelity peers (e.g. Shopify): assert **zero quantity writes**
  — wire-body scan must show no `quantity|inventory_quantity|available`
  (BR-08); audit raises `STOCK_DRIFT_MONITOR_ONLY`.
- Faithful peers (bridge): PUT bodies equal `{status}` exactly (BR-06).
- STOP on any quantity write — BR-08 violation, halt stock sync immediately.
- ISOLATE: pause `store-stock-sync` only.

## 5. Post-migration verification

- `SyncRun` count advanced only by expected pilot runs; queue counts back to
  pre-pilot baselines (paused → resumed where intended).
- Mappings/credentials/history intact; attempts/issues endpoints 200;
  `/sync/health` lists all stores.
- Native flows unaffected (BR-20): public browse 200, staff order create 201,
  guest path byte-identical behaviour with flags on/off.
- Cleanup verified by SQL: 0 pilot stores/credentials/products/orders left
  (soft-trash per repo convention where applicable); no blocks created.

## 6. Rollback procedure (flags-off + queue-pause)

Per FINAL-REPORT §8 (drilled live 2026-09-25: OFF 15/15 → ON → OFF 15/15,
zero data loss):

1. Set all `store_*` runtime flags + `THIRD_PARTY_STORES_ENABLED` explicitly
   to `'false'` (kill-switch semantics: only explicit `'false'` disables —
   unsetting NO LONGER stops sync; all sync HTTP surfaces 403,
   stock/reconcile workers self-skip).
2. Pause the six queues (covers in-flight jobs the flags cannot stop — the
   product-sync worker itself has no flag check, FINAL-REPORT G-4).
3. Mappings, credentials, history, field-ownership state stay untouched.
4. Revert the deploy. No schema rollback ever (§1.4).
5. Verify: sync endpoints 403, queue counts static, `SyncRun` count frozen,
   native browse/checkout/detail green. Re-enable by reversing 1–2.

## 7. Acceptance criteria (all must hold)

- Migration validation §1 green; backfill dry-run §2 at parity (P8 219/219
  precedent re-met); preflight §3 recorded.
- Pilot steps 4a→4b→4c each exited with evidence (wire bodies, read-backs,
  delivery rows) — paired with suite/file references, never count-only.
- Rollback §6 drill passes on the staging copy; native-isolation regression
  (BR-20) passes.
- P9 live dev-store smoke unblocked (credentials supplied) and P10 live peer
  pilot (companion checklist `P10-PILOT-CHECKLIST.md`) completed before
  broader enablement.
