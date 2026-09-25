# P5 — Stock-Status Sync · Evidence

Branch: `feature/central-commerce-p0` · **NOT committed** (per instruction).
Plan: `/Users/riaz/.commandcode/plans/central-commerce-multistore-integration.md`
§8.4 (stock-status sync), BR-06/BR-07/BR-08/BR-20/BR-22/BR-26, §13 stock
suite, P5 row. Entry prerequisite P4 satisfied at `e6eda090`.

## 1. Migration (ONE, additive only)

- `apps/backend/prisma/migrations/20260925170000_p5_stock_variant_version/migration.sql`
  — one nullable column, no backfill (`NULL` = never evaluated):
  `ALTER TABLE "StoreVariantMapping" ADD COLUMN "lastEvaluatedVersion" TEXT;`
  (product-level guard column already landed in P4 on `StoreProductMapping`).
  Zero drops/renames. Asserted additive by the stock suite itself
  (`P5 migration is additive-only` test reads the SQL: contains
  `lastEvaluatedVersion`, matches no `DROP TABLE|COLUMN`).
- `migrate status`: **123 migrations, database up to date**; column verified
  live (`information_schema`: `StoreVariantMapping` gains
  `lastEvaluatedVersion`, 8 columns total). `prisma generate` clean.

## 2. Files

Backend only — admin/storefront untouched (zero diffs outside
`apps/backend/`; P5 has no UI deliverable — capability notices landed in
P1/P4).

New (`apps/backend/src/stores/sync/`):
- `stock-status-sync.service.ts` — §8.4 engine (913 lines):
  `notifyStockChanged` (post-commit, try/catch non-propagating, flag-gated,
  assigned + CONNECTED + non-NATIVE stores only, `jobId =
  stock:{storeId}:{productId}:{variantId}`, `{delay: 1500}` via
  `SyncQueuesService.enqueue`); `handleStockChange` (opens `SyncRun(STOCK,
  SYSTEM)`, §8.1 retry ladder `classifyProviderError` → `[30s,2m,10m,1h,6h]`
  ×5 → `DEAD_LETTER` issue, BR-26 never resolves); `evaluateProduct` /
  `evaluateTarget` (re-reads live state, never trusts payload; NATIVE
  reject BR-20; PRODUCT_GONE/VARIANT_GONE skips; combo → `COMBO_SKIPPED`
  with `min(child)` trail, never pushed BR-22; stale-version exit;
  threshold paths BR-07; fidelity gate BR-08; forced-zero push +
  read-back + one repair → `STOCK_VERIFY_FAILED` issue; per-(store|product|
  variant|status) 60s cooldown; post-verify drain re-enqueue);
  `runAudit` (flag-gated, `SyncRun(STOCK, SCHEDULED)`, CONNECTED +
  `autoSyncEnabled` stores, `productId`-paged `take: 100`, concurrency 5,
  250ms inter-page delay, cursor-resumable incl. fatal-error continuation
  re-enqueue); `onModuleInit` (repeatable `stock-audit`
  `0 3 * * *` `Asia/Dhaka`, fail-closed removal when the flag is off);
  pure helpers `thresholdFor` (store override → `lowStockQty` → 5),
  `desiredFromQty`, `versionFor`, `isStale` (`<=` = stale, equal replays
  never push). `desiredState` resolves through `availabilityMode`
  (ALWAYS_* short-circuits, INVENTORY_CONTROLLED sums physical rows,
  MANAGED/variable sums managed−reserved; inactive/draft → OUT/zero).
- `__tests__/stock-status-sync.spec.ts` — §13 stock suite, **29 tests**
  (see §3).

Modified (all additive, post-commit notify only — no behaviour change when
flags are off, no provider call in any mutation per R-2):
- `stock/stock.service.ts` + `stock/stock.module.ts` — choke-point notify
  in `operate()` (both tx-external and tx-internal paths, both methods;
  `StoresModule` import, acyclic: StoresModule never imports stock).
- `products/products.service.ts` + `products/products.module.ts` — notify
  at create / update (mode-transition zeroing) / draft-create /
  draft-update / draft-publish / variants-generate / variants-regenerate /
  variant-remove (×2: variant + parent). `updateVariant` needs none (direct
  stock edit throws) and `reorderVariants` needs none (sortOrder only).
- `inventory/inventory.service.ts` + `inventory/inventory.module.ts` —
  notify at combo-adjust (×2 paths) / variant-adjust / product-adjust /
  restock-commit.
- `inventory/physical-inventory.controller.ts` — notify at adjust + bulk
  (per seen product|variant key).
- `import/import.service.ts` + `import/import.module.ts` — notify at
  product-create / product-update / variant-update / variant-create
  (§3.8's four sites).
- `stores/stores.module.ts` — `StockStatusSyncService` provided + exported.
- `stores/sync/sync-queues.service.ts` — `enqueue` gains `{delay?}` (used
  for the 1500ms debounce; existing callers unaffected).
- `stores/sync/sync.processors.ts` — `StoreStockSyncProcessor` owns
  `stock-change` (per-store `serializeStore`, R-8) + `stock-audit`
  (unserialized; the version guard keeps the paths from racing).
- `stores/providers/provider.contract.ts` + `base-provider.ts` —
  optional variation-scoped `read/publishVariantStockState` (BR-06
  status-only; base default throws `VARIANT_STOCK_UNSUPPORTED`, mapped by
  the engine to SKIPPED, never to a parent-level push; `unsupported`
  fidelity throws before any HTTP seam — zero writes).
- `stores/providers/woocommerce.provider.ts` — live variation stock
  (`GET/PUT …/variations/{id}` with `{stock_status}` only, never a
  quantity — BR-06).
- `stores/providers/__tests__/fake.provider.ts` — variant slot `stockState`
  + `read/publishVariantStockState` (status-only, call-logged for the
  zero-write vectors).

## 3. Suites (new: 29 tests, all green)

`sync/__tests__/stock-status-sync.spec.ts`:

| Tests | Proves |
|---|---|
| threshold precedence / qty matrix / version guard / constants (4) | store override → lowStockQty → 5; 0/neg → zero/OUT, below → IN, at/above → IN/above; `<=` stale incl. equal-replay; cron/tz/debounce constants |
| notify coalescing+debounce / variant fan-out / non-propagation / flag+NATIVE filter / R-2 static guard (5) | `stock:{store}:{product}:{variant}` + delay 1500, zero provider calls; DB failure resolves silently; flag-off zero enqueue; NATIVE/DISCONNECTED excluded; all five §3.8 writers contain notify and zero provider symbols |
| zero forced push / below-threshold push / in-sync no-write / above-threshold silence + audit repair / per-store override (5) | BR-07 paths; `PUSH_VERIFIED`; `IN_SYNC` zero publish; `ABOVE_THRESHOLD` zero publish with audit repairing the same drift; threshold 10 vs default 5 |
| race stale-exit / fresh-push (2) | stale event leaves remote OUT with zero publishes; fresh version pushes |
| unsupported per-change / audit-drift / audit-match / status-only shape (4) | BR-08: zero writes AND zero reads per-change; `STOCK_DRIFT_MONITOR_ONLY` issue with exactly 1 read; `IN_SYNC_MONITORED`; publish detail keys exactly `{ref,state}`, no qty/sentinel (BR-06) |
| repair-then-verify / verify-failed (2) | mismatch→match = 2 pushes `REPAIRED_AFTER_RETRY`, no issue; mismatch→mismatch = 2 pushes + `STOCK_VERIFY_FAILED` |
| combo min-child / NATIVE reject / variant-scoped write (3) | BR-22 trail `min child 0`, zero publishes; BR-20 zero calls; variant zero touches `publishVariantStockState` only |
| repeatable registration / paged audit run / cursor resume / migration additive (4) | `stock-audit` repeat `{pattern 0 3 * * *, tz Asia/Dhaka}`, flag-off removal; one `SyncRun(STOCK,SCHEDULED)` repairing drift; cursor skips audited stores; SQL additive-only |

TDD record: suite written first — initial run 28/29 RED (mock missed the
DB-level NATIVE/CONNECTED filter; mock fixed, no production change).
Mutation check: breaking `isStale` to `return false` fails the race test;
restored. `nest build` caught one further real defect the runtime suite
could not distinguish: `isStale`'s null guard was inverted
(`return version <= lastEvaluated` under `!lastEvaluated`) — fixed to
`return false` (one line); build clean, suite still 29/29.

## 4. Totals (final, all green)

- Backend jest **3331/3331 (235 suites)** · `nest build` clean
  (P4 baseline 3302/3302 + 29 new stock tests, zero regressions)
- Admin / storefront: untouched by P5, suites not re-run (no diffs)
- Prisma: 123 migrations, `migrate status` up to date, `generate` clean

## 5. Gaps / deferred (explicit)

- **Live-server E2E not run** (backend :4000 + Playwright with
  `SKIP_LICENSE_CHECK=true`): §13 E2E clause satisfied by FakeProvider
  whole-engine vectors + MockFetch fixture-replay in the contract suite
  (same basis as P4); recommend a live audit walkthrough in P11/P12.
- **Above-threshold push on a store whose remote was never mapped**:
  `NOT_MAPPED` skip — mapping creation stays owned by product sync (P4);
  the audit repairs it on the next product-sync pass. By design, not a gap.
- **Draft products resolve to OUT_OF_STOCK** (inactive → zero path): a
  draft assigned to a store pushes OUT, never IN — fail-closed; publication
  itself stays owned by product sync (§8.8). By design.
- **Unrelated dirty file**: `.commandcode/taste/user-taste-profile/taste.md`
  (taste-profile additions, another workstream) and `.tmp-e2e/` (harness
  scratch) predate/are outside P5 — left untouched, NOT committed.
- P6/P7/P9/P10/P11 rows unchanged from P4-evidence §5.
