# P13 — ERP Stock Projection (operator-directed)

Branch: `feature/central-commerce-p0` · Date: 2026-09-26 · No commit (per direction).

## 0. Supersession note (read first)

This change **explicitly SUPERSEDES** two plan rules from
`/Users/riaz/.commandcode/plans/central-commerce-multistore-integration.md`
(the plan file itself is NOT rewritten, per direction):

| Plan rule | Old stance | P13 operator-directed stance |
|---|---|---|
| **BR-06** (status-only) | No exact quantity is ever written to any store. | ERP stock 1–5 → ACTUAL quantity pushed in real time (Woo `manage_stock + stock_quantity`, Shopify `InventoryLevel.available`, bridge `quantity`). Status-only survives ONLY above the threshold band (faithful/status-only bridges) and for `ALWAYS_IN_STOCK`. |
| **BR-08** (Shopify zero-write) | Shopify `unsupported` → zero writes, monitor-only. | Shopify declares `quantized-capped`: ERP > 5 → capped qty 5 (tracked, deny); 1–5 → exact; 0 → 0. Zero-write now applies ONLY to `unsupported`-fidelity paths. |
| **BR-13/BR-16** (never-reject + shortfall-flag) | External orders are always ingested; shortfalls flagged. | **Deviation** (see §5): ERP-zero per item → `ZERO_STOCK_REJECT` (not created). Nonzero-shortfall keeps the flag behavior. |

Everything else in the plan stays binding — verified intact: ownership
BR-02/03 (`FieldOwnershipService.evaluate` untouched), no-implicit-resolution
BR-26 (no sync path touches overrides; `sync-retry` + stock engine write only
attempts/issues), R-2 (no provider call in any mutation — extended static guard
now covers the quantity methods too), audit trails (`SyncRun/Item/Attempt/Issue`
on every path, including the new reject path).

## 1. Policy

"ERP calculates the truth; every integrated store only receives a controlled
stock projection." ERP stock = resolved quantity (`desiredState`, unchanged):
`INVENTORY_CONTROLLED` → physical available sum, else managed-stock available.
Threshold default 5, per-store override (`Store.settings.stockLowThreshold` →
product `lowStockQty` → 5) kept (`thresholdFor`, unchanged).

| Band | Custom + WooCommerce (`faithful` + qty) | Shopify (`quantized-capped`) |
|---|---|---|
| ERP > threshold | `IN_STOCK` status ONLY — zero quantity keys on the wire (Woo: `stock_status` with remote management NEVER enabled; bridge: `{status}`). Remote tracks nothing countable → oversell impossible. | Capped quantity = threshold (default 5) via `InventoryLevel.set`, tracked + deny. Remote never sees the truth above the band. |
| ERP 1–5 | ACTUAL quantity real-time (Woo `manage_stock:true + stock_quantity:N`; bridge `{status, quantity:N}` when the manifest declares `stockQuantity`). | Actual quantity real-time. |
| ERP 0 | `OUT_OF_STOCK` (Woo explicit `stock_quantity:0` + outofstock, management left armed). Forced + read-back verify. | `available: 0` (selling stops). Forced + read-back verify. |
| `ALWAYS_IN_STOCK` | Status IN, never a quantity (`Infinity` is not projectable). | Same. |
| `unsupported` fidelity | n/a | n/a — ZERO writes, monitor-only drift audit (BR-08 remainder). |

NATIVE is unchanged and never a sync target (BR-20 guard + suite intact).
Location strategy (Shopify): first location from `GET /locations.json`, cached
per store (`resolveLocationId`); a per-store location override is out of scope
(single seam noted in code). `inventory_management:'shopify'` + deny policy is
ensured on every push (idempotent; required for the 0-band no-sell guarantee).
Cap semantics: the quantized cap IS the threshold, so a per-store override
moves cap and band together (10 → band 1–9 exact, ≥10 capped 10). Rationale:
capping below the band top (fixed 5 with threshold 10) would project a *lower*
number than the exact band just left — incoherent. Locked by `planFor` tests.

## 2. Contract changes

`StockStatusFidelity = 'faithful' | 'quantized-capped' | 'unsupported'`
(+ `stockQuantity: boolean` capability; optional `publishStockQuantity /
publishVariantStockQuantity / readStockQuantity / readVariantStockQuantity`
methods — the engine calls them ONLY when capability AND method both exist,
else status fallback; base class deliberately declares none so a status-only
adapter can never receive a quantity push).

| Provider | Fidelity | `stockQuantity` | Notes |
|---|---|---|---|
| WooCommerce | `faithful` | `true` (native) | Above-band body is exactly `{stock_status}` (asserted key-for-key). |
| Shopify | `quantized-capped` | `true` (native) | REST `InventoryLevel.set`; inherited `publishStockState` now unreachable by the engine (never called on capped providers). |
| Custom bridge | `faithful` (manifest may narrow to `unsupported` / set `quantized-capped`) | manifest `capabilities.stockQuantity:true` may ENABLE (widen exception, like `costPrice`); **default `false` → status-only when undeclared**. Degrades defensively to status-only if called while undeclared. | Protocol §4 extended (status + optional `quantity`; stub stores both). |
| Fake (tests) | `faithful` + `setFidelity()` seam | `true` | Capped override enforces `min(qty, cap)` like Shopify. |

## 3. Engine (`StockStatusSyncService`)

Pure planner `planFor(fidelity, quantityCapable, qty, path, threshold, audit)`
→ `{kind, state, wireQty}` (suite-pinned, §4 matrix). Executors:
`pushStatusPlan` (legacy flow, verbatim) + `pushQuantityPlan` (recheck-first
when observable → `IN_SYNC_QTY`; forced on zero; cooldown keyed on
**state + wire qty** so 4→3 is never suppressed; quantity read-back verify +
one repair → `STOCK_VERIFY_FAILED`; unobservable quantity + matching status →
`PUSH_VERIFIED_STATUS_FALLBACK`, never silent). Above-band per-change silence
preserved for ALL fidelities (audit owns >5, including the capped band).
Monotonic version guard, `NOT_MAPPED`, combo skip, NATIVE guard unchanged.
Fan-out: `notifyStockChanged` already enqueues per assigned store (R-2,
debounced, coalesced) — verified by the new multi-store test (one 1–5 change
→ exact qty 3 on BOTH stores).

## 4. Race audit (real gap found + minimal fix, no new lock service)

Audit: storefront + admin share `orders.create → resolveAndApplyStock →
StockService.operate*` with the order tx; external ingest funnels into the same
`create()`; POS uses `stock.reserve/deduct/addPhysical` with tx (static
assertions in `stock-race.spec.ts`). Sync enqueue is post-execution only
(`notifyStockChanged`, non-propagating — R-2).

**GAP (managed-stock `reserve`):** `applyStockChange` checked availability ONLY
for `decrement` ops. `reserve` (reservedStock increment) never checked, so two
concurrent creates could both pass the pre-transaction guard in
`orders.create` and double-spend (reserved 10 against stock 5). Proven by the
new tests failing pre-fix (second reserve resolved instead of rejecting).

**Fix (6 lines, `stock.service.ts`):** availability check on
`reservedStock` increment, gated to managed-stock modes (`MANAGED_STOCK`/null —
unlimited modes must not throw; IC/ALWAYS never reach here via the router).
It runs AFTER `lockRows()` took `SELECT … FOR UPDATE` in the same transaction,
so check-then-increment is atomic: the loser reads the winner's committed
reservation and throws `Insufficient stock`. No new lock service, no schema
change. Physical path was already safe (Serializable + retry in
`reservePhysicalAllocated`).

Proof (`src/stock/stock-race.spec.ts`, 5/5): lock-before-read ordering;
sequential oversell rejected with zero writes; concurrent `reserve(5)×2`
against 5 units with a FOR-UPDATE-faithful lock → exactly one wins, final
reserved 5 (never 10). Assumption: the DB honors `SELECT … FOR UPDATE`
(standard; the code's part — lock before read-check-write in one tx — is
pinned). Full backend suite shows no regression from the fix (shortfall items
skip `operate` entirely, so BR-16 flag flow is untouched).

## 5. Deviation note — `ZERO_STOCK_REJECT` (BR-13/BR-16, LOUD)

Operator direction overrides never-reject for ONE narrow case:
**external ingest, per item, ERP authoritative stock ≤ 0 → order NOT created.**
Explicit code `ZERO_STOCK_REJECT` (thrown + `SyncRunItem FAILED` + upserted
`ZERO_STOCK_REJECT` issue with SKUs; no order row, no mapping row; single
BullMQ attempt → no retry storm; reconcile/processor catch-chains record
FAILED). Scope locks (all asserted):
nonzero-shortfall still flows to `create()` and keeps the BR-16 flag (never
rejected); product-less (unmatched-SKU) items are unresolvable → never
triggers (keep `UNMATCHED_SKU` path); combos resolve no ERP row here → existing
path; native storefront/admin validation UNCHANGED (`assertManagedAvailability`
+ `blocked-ingest` suite intact). `erpStockForItem()` resolves the same truth
as the projection (IC → physical sum, else managed; `ALWAYS_OUT_OF_STOCK` = 0,
`ALWAYS_IN_STOCK` = ∞). Implementation: `store-order-ingest.service.ts`
(`ZERO_STOCK_REJECT`, `erpStockForItem`, pre-`create()` gate) — `orders.service`
and the plan file untouched.

## 6. Proof

### Automated (all green)
- Backend jest FULL: **258 suites / 3642 tests pass** (incl. new: `planFor` 4, matrix
  faithful 6, capped 3, fan-out 1, cooldown-step 1, qty verify 3, status-only
  fallback 1, race 5, zero-reject 6, contract qty/cap/status-only 5, Woo qty 1,
  Shopify qty 4, bridge qty 4, conformance qty-default 2).
- `nest build` clean. No migration (no column needed: Shopify locations cached
  in-memory per store; bridge quantity is a manifest flag).
- R-2 static guard extended (status + quantity methods absent from all five
  mutation writers); BR-13 static guard rewritten to pin the single explicit
  exception; P5-migration additive test intact.

### Wire proof (recorded HTTP, MockFetch — no live store exists on this machine, same stance as P9)
- Woo above-band: body exactly `{stock_status:'outofstock'}` (zero qty keys);
  band: `{manage_stock:true, stock_quantity:3, stock_status:'instock'}`;
  zero: `{manage_stock:true, stock_quantity:0, stock_status:'outofstock'}`.
- Shopify: `POST /inventory_levels/set.json`
  `{location_id:'111' (first), inventory_item_id:'8001', available:5}`;
  variant variant-item targeting; `inventory_management:'shopify'` +
  `inventory_policy:'deny'` ensured; no-location → loud `SHOPIFY_NO_LOCATION`;
  location cached (one GET); `readStockQuantity` live (3).
- Bridge: default `{status}` only (full-flow scan: no write body carries
  quantity/inventory_quantity/available); declared →
  `{status:'in_stock', quantity:3}` round-trip (product + variant);
  undeclared + quantity call → degrades to `{status}` (no blind qty write);
  unsupported → zero non-GET calls.
- Engine matrix on Fake: >5 faithful status-only (detail `{ref,state}` only);
  >5 capped → remote 5; 1–5 → exact (product + variant); 0 → 0 + OUT.

### Live-store smoke (GAP — operator prerequisite)
No live Woo/Shopify/bridge store exists on this machine and no credentials are
stored in-repo (same constraint as P9). Remaining before production: run one
1–5 unit step per provider against a real store and paste the read-back lines
into §6; the suites above define the exact assertions to repeat live.

## 7. Files changed / totals / gaps

Changed (backend only; admin untouched):
`providers/provider.contract.ts` (fidelity + `stockQuantity` + qty methods +
`StockProjection`), `providers/base-provider.ts` (gate comment; no qty
methods by design), `providers/woocommerce.provider.ts` (+qty impl),
`providers/shopify.provider.ts` (capped + locations + tracked/deny),
`providers/custom-bridge.provider.ts` (+manifest `stockQuantity` + qty impl),
`sync/stock-status-sync.service.ts` (`planFor` + two executors + qty-keyed
cooldown), `orders/store-order-ingest.service.ts` (`ZERO_STOCK_REJECT` +
`erpStockForItem` + gate), `stock/stock.service.ts` (atomic reserve check),
tests: `sync/__tests__/stock-status-sync.spec.ts`,
`providers/__tests__/{provider-contract,bridge-conformance,shopify-live,woo-live}.spec.ts`,
`providers/provider-registry.spec.ts`,
`providers/__tests__/{fake.provider,reference-bridge}.ts` (test-only),
`orders/__tests__/order-ingest.spec.ts`, `orders/__tests__/blocked-ingest.spec.ts`,
new `stock/stock-race.spec.ts`. Doc: this file.

Rules honored: additive-only (no migration); R-2; no silent overwrites
(drift/ownership untouched); no secrets. NOT committed (per direction).

Gaps: (1) live-store smoke per provider (§6) — needs operator credentials;
(2) per-store Shopify location override — out of scope by direction;
(3) combos excluded from zero-reject (existing shortfall path) — documented in §5.

## 7. Live proof — Shopify dev store 2026-09-26 (post-implementation fixes)

Three live-found gaps fixed during this proof (all committed with tests):
- Above-band first evaluation executed silence → newly mapped products sat
  at remote 0 (fix: first-eval always projects; later evaluations silent).
- Mapping creation never kicked a stock evaluation (adjust-before-mapping
  left no trigger) → product-sync now notifies post-mapping (R-2 safe).
- Completed BullMQ job records swallowed same-id re-adds (3→0 never ran)
  → `replaceFinishedJob` clears finished records; pending jobs still
  coalesce (they re-read live state).
- Read-back raced Shopify eventual consistency (2 false VERIFY_FAILED) →
  settled reads (3×2s) before repair; false alarms resolved with notes.

Matrix vs dev store (TEST product, cleaned after): ERP 10 → remote **5**;
ERP 3 → remote **3**; ERP 1 → remote **1**; ERP 0 → remote **0** (verified
PUSH_VERIFIED_QTY, no false failure). Deletion propagation re-proven
(remote 404 + mapping cleanup). Env clean: 0 TEST artifacts.
