# Central Commerce & Multi-Store Synchronization — FINAL REPORT (P12 drill scope)

Branch: `feature/central-commerce-p0` · Date: 2026-09-25 · Head: `e473a9ff`
Plan: `/Users/riaz/.commandcode/plans/central-commerce-multistore-integration.md`
Scope rule honoured: ONLY what is executable in dev — **no staging/production
exists here**, so P12-production items (staging on a production copy,
backfill dry run, pilot, broader enablement) are recorded as pending, not
simulated. **Nothing committed** (working tree unchanged except this file,
uncommitted, plus the pre-existing untracked `.tmp-e2e/` leftovers).

## 1. Per-phase status

| Phase | Status | Evidence commit |
|---|---|---|
| P0 Safety net & proofs | DONE | `ec5972b8` (6 raw-body proofs, baselines, flag/consistency suites) |
| P1 Store foundation | DONE | `6c2debff` (Store model, registry + NATIVE guard, connect/duplicate-409) |
| P2 Provider generality | DONE | `cae6b3bc` (FakeProvider + contract suite, fixture harness) |
| P3 Distribution & ownership | DONE | `05fd7a0e` (resolver, field-state, availability UI, bulk) |
| P4 Product sync (WooCommerce) | DONE | `e6eda090` (ownership engine, overrides, categories, deletion) |
| P5 Stock-status sync | DONE | `f4492267` (notify/coalesce/monotonic guard, audit, fidelity gate) |
| P6 Order ingestion | DONE | `da2f4d0d` (webhooks, 3-day reconcile, blocked-ingest suite, bridge) |
| P7 Order status push | DONE | `c577e80e` (cancel/Delivered push, verify, skip reasons) |
| P8 Channel migration | DONE | `d8da115b` (ChannelResolver, dual-write, backfill 219/219, parity) |
| P9 Shopify provider | **BLOCKED** — operator prerequisite unmet: live Shopify dev store + custom-app token never supplied (§14/§18). Not started, not downgraded, not skipped. | — |
| P10 Custom provider (Bridge v1) | **BLOCKED on P9** (dependency graph). Not started. | — |
| P11 Operations (provider-independent partial) | DONE | `e473a9ff` (retention purge + scheduler, retry center, notify, correlation-id logging, health, overrides history) |
| P12 Rollout & rollback | **DRILL SCOPE DONE in dev** (this report); production items pending staging (see §5) | — (no commit) |

Per-phase evidence docs: `docs/central-commerce/P0-evidence.md` … `P11-evidence.md`
(P9/P10 have none — correctly, since blocked phases produce no artefacts).

## 2. P12 rollback drill (live, dev, `SKIP_LICENSE_CHECK=true`)

Backend lifecycle for the drill: `npx nest build` clean → original
flags-off server stopped → restarted **flags-ON** (`THIRD_PARTY_STORES_ENABLED`
+ `store_sync/product/order/push/stock/reconcile/widening/stock_audit` =
`true`) → drill → restarted with the **original env**
(`SKIP_LICENSE_CHECK=true` only) → re-verified. Final backend healthy
(`:4000`, original env). Temp scripts lived only in workspace-root
`.tmp-e2e/` (watch-restart trap honoured) and the 3 drill scripts are deleted.

### 2a. Flags OFF + queues paused → zero sync activity (15/15 PASS, run twice)

- All six sync queues paused via BullMQ (`paused=true`, `waiting/active = 0`
  on all six; `store-reconcile` carried 1 delayed repeatable tick, untouched),
  then resumed after. Queue status script deleted.
- `GET /stores`, `POST /stores/sync-all`, `GET /sync/runs`,
  `POST /sync/publish`, `POST /stores/:id/sync` → **403** (fail-closed gates);
  distribution read → 403; `POST /stores` with `NATIVE` → 400 validation, **0
  rows written**.
- `SyncRun` count **23 → 23** (no runs spawn while off).
- Mappings/credentials/history intact: `StoreCredential 0→0`,
  `StoreProductMapping 0→0`, `ProductStoreFieldState 0→0`, attempts/issues
  readable (attempts/issues endpoints verified in ON phase).
- Honest mechanism note: the product-sync *worker* itself has no flag check —
  an already-queued job would still execute. That is exactly why §15 pairs
  "flags off" with "queues paused"; both halves were exercised.

### 2b. Native flows unaffected (same 15/15 runs)

- Public browse `GET /products` → 200 (before, during flags-off, and after).
- Staff order create (CALL, same native `create()`) → 201, detail → 200,
  trashed after → 0 live drill orders.
- Guest path: `POST /orders` (guest/WEBSITE) → 400 with the **pre-existing**
  `127.0.0.1` auto-block message — byte-identical with flags on or off, so
  the parity itself is the unaffected proof (see §6 gap G-1).

### 2c. Flags ON → sync works again (15/16 script + 2 follow-up proofs)

- `GET /stores` → 200; connected WOOCOMMERCE test store (unreachable URL
  `http://127.0.0.1:9`, dummy credentials) → 201.
- Detail + rotate responses contain **zero secret echoes** (write-only proven).
- Duplicate connect (same domain) → **409** reconnect-to-existing (§8.10 live).
- `POST /stores/sync-all` with a NATIVE row present → 200,
  `excludedNativeCount = 1`, exactly 1 external child run (BR-20 live).
- Child run with no assignments → SUCCESS, 0 items (correct no-op, explains
  the single script FAIL: `items=0` — no provider call was *due*).
- After assigning a live product: single-sync run → FAILED with a recorded
  `SyncAttempt`, first `INVALID_REQUEST` (adapter needs `baseUrl` in
  secrets/settings — `domain` is identity-only, by design), then after
  rotating credentials with `baseUrl`: **`TEMPORARY_FAILURE / fetch failed`**
  — a genuine outbound HTTP attempt refused by the dead endpoint. Provider
  path proven live end-to-end (enqueue → worker → adapter → classified
  attempt → run accounting).
- `GET /sync/attempts`, `/sync/issues`, `/sync/health` (both stores listed)
  → 200: history/audit surfaces intact — no data loss.

### 2d. Cleanup (verified by SQL)

0 test stores, 0 credentials, 0 `p12-%` products, 0 live P12 orders (2 drill
orders soft-trashed per repo convention, same as P8). `SyncRun` 23 → 24 (+1
`sync-all` batch row retained as audit history, consistent with prior
phases). 0 blocks created (pre-existing `BlockedPhone` 4 / `BlockedIp` 1
untouched). Stale P7 stub-Woo process killed.

## 3. BR-20 native-isolation regression — FULL PASS

- Unit: `identity-sync` + `provider-registry` + `store-flags` +
  `store-identity` → **23/23 PASS** (NATIVE guard throws, write-rejection of
  NATIVE ids, sync-all exclusion, fail-closed flags).
- Live: NATIVE connect rejected; `sync-all` reports `excludedNativeCount=1`
  with zero child runs for NATIVE (§2c).
- Storefront suite (native checkout/product/order paths, untouched by sync
  code): **26 files / 285 tests PASS** + `tsc` clean — no provider-path
  coupling possible (storefront has zero imports from the stores domain).

## 4. Final regression (§17 — `next build` excepted, see note)

| Check | Result |
|---|---|
| `prisma migrate status` | 126 migrations, **up to date** (no new migration in P11/P12) |
| Backend jest | **249 suites / 3474 tests PASS** (== P11 baseline) |
| `nest build` | clean (exit 0, run twice: pre-drill + final) |
| Admin vitest | **78 files / 767 tests PASS** (== P11 baseline) |
| Admin `tsc --noEmit` | clean |
| Storefront tests | **26 files / 285 tests PASS** |
| Storefront `tsc --noEmit` | clean |
| `next build` | **skipped with reason**: P12 made zero code changes (no commit, tree otherwise clean); storefront untouched since P8's type-only touch, whose build already succeeded |

## 5. Gate answers (§18 — explicit)

1. *"Programme-entry prerequisites: none. P0 starts immediately."* → **YES** —
   P0 executed (`ec5972b8`), all six §8.7 raw-body proofs pass and are written
   in `P0-evidence.md`; fallback never triggered.
2. *"P9 prerequisite: live Shopify dev store + custom-app token; if unmet,
   P9 does not start, is not downgraded, P10 does not begin."* → **PREREQUISITE
   STILL UNMET — P9 NOT STARTED, P10 NOT STARTED.** No weaker verification
   was substituted; no Shopify/bridge code was written in any phase (P11
   evidence §8 deferred list stands).
3. *"There is no third prerequisite."* → **YES** — nothing else blocked any
   executed phase.
4. *P12 gate: "rollback drill passes; native-storefront isolation regression
   passes; final report carries the explicit answers and the §18 gate."* →
   **YES** (§2 drill 15/15 ×2 + ON-phase proofs; §3 BR-20 full pass; this
   report).

## 6. Gaps (honest, none blocking what was executable)

- **G-1.** Full public guest-checkout smoke from localhost is impossible in
  this environment for reasons unrelated to the programme: a pre-existing
  `BlockedIp` auto-block on `127.0.0.1` (row `0dc7f824…`, `autoBlocked`,
  expires 2026-09-26) makes every localhost guest `POST /orders` 400. Proven
  identical with flags on/off; staff-path smoke covers the same `create()`.
  Left untouched (security state, self-expiring).
- **G-2.** No staging/production exists here → P12-production items pending:
  migration validation on a production copy, backfill dry run, internal store
  with sync paused, staged pilot (products → orders → stock), broader
  enablement, production smoke tests.
- **G-3.** P9/P10 blocked (see §5.2); Shopify `unsupported`-fidelity
  zero-write assertion and bridge conformance await the live prerequisites.
- **G-4.** Product-sync worker has no flag check of its own (see §2a note):
  rollback relies on flags **plus** queue pause, exactly as §15 specifies.
  A worker-level fail-closed check would harden this (one-line follow-up,
  not applied here to keep P12 code-free).
- **G-5.** P11 residual (accepted): `provider`/`correlationId` on
  items/attempts live in logs only — queryable only via a future migration.

## 7. Deferred list (P9/P10 + production)

Shopify adapter (custom-app token, products/variants/media/collections,
`CANCELLED`/`FULFILLED`, HMAC webhooks, wizard path, limitation UX, live
dev-store smoke + zero-quantity-write proof); Bridge v1 (protocol spec,
manifest, signing, order pull/webhook, status push, contact-check,
conformance suite); all §5-G-2 production rollout items.

## 8. Rollback procedure (standing, §15/§16.7)

1. Set all `store_*` runtime flags + `THIRD_PARTY_STORES_ENABLED` to
   off/unset (fail-closed — all sync HTTP surfaces 403, stock/reconcile
   workers self-skip).
2. Pause the six queues (`store-product-sync`, `store-stock-sync`,
   `store-order-ingest`, `store-order-push`, `store-reconcile`,
   `store-maintenance`) — covers in-flight jobs the flags cannot stop (G-4).
3. Mappings, credentials, history, field-ownership state stay untouched
   (disconnect likewise retains everything — proven live in P4/P11 suites).
4. Revert the deploy. **No schema rollback ever**: all 126 migrations are
   additive (no drops/renames/enum repurposing).
5. Verify: sync endpoints 403, queue counts static, `SyncRun` count frozen,
   native browse/checkout/detail green. Re-enable by reversing 1–2.
6. Drilled live on 2026-09-25: OFF 15/15 → ON (sync proven) → OFF 15/15,
   zero data loss, zero leftover test artefacts.
