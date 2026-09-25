# Central Commerce — Consolidated Readiness Report (P0–P12)

Branch: `feature/central-commerce-p0` · HEAD `ffc337f6` · Date: 2026-09-25.
Plan: `/Users/riaz/.commandcode/plans/central-commerce-multistore-integration.md`.
Evidence docs: `docs/central-commerce/P0-evidence.md` … `P11-evidence.md`,
`P9-LIVE-SMOKE.md`, `P10-evidence.md`, `FINAL-REPORT.md`; companions:
`P10-PILOT-CHECKLIST.md`, `P12-READINESS-PACKAGE.md`.
No secrets appear in this report. Every claim below pairs with a
suite/file reference — never test-count-only.

## Status lines (exact)

- **P9 = Code Complete → UI Complete → Live Smoke (BLOCKED) → Formally Closed (pending)**
- **P10 = Code Complete → Conformance Verified → Live Peer Pending**
- **P12 = Implementation Ready → Environment Pending**

## Per-phase readiness (exactly these fields each)

### P0 — Safety net & proofs (`ec5972b8`)

- Implemented: YES — raw-body capture (`stores/raw-body-capture.ts`), 6 raw-body
  proofs, flag/consistency suites, baselines.
- Unit-Contract verified: YES — `stores/raw-body-proof.spec.ts` + flag/consistency
  suites (see `P0-evidence.md`).
- Integration verified: YES — proofs run against the real backend/DB path.
- Live verified: YES (dev) — proofs executed live in dev per `P0-evidence.md`.
- Not yet verified: none.
- External prerequisite: none.
- Known limitation: none open (fallback never triggered).
- Production blocker: NO.
- Next action: none.

### P1 — Store foundation (`6c2debff`)

- Implemented: YES — `Store` model (`schema.prisma` ~3876), provider registry
  (`providers/provider-registry.service.ts:25`) + NATIVE guard, connect with
  duplicate-409 (`stores.service.ts:91` reconnect-to-existing).
- Unit-Contract verified: YES — `store-identity.spec.ts`, `provider-registry.spec.ts`,
  `store-flags.spec.ts` (NATIVE guard throws; write-rejection of NATIVE ids).
- Integration verified: YES — connect/duplicate flows per `P1-evidence.md`.
- Live verified: YES (dev) — NATIVE connect rejected live; `sync-all` reports
  `excludedNativeCount=1` (re-proven in FINAL-REPORT §2c/§3).
- Not yet verified: none.
- External prerequisite: none.
- Known limitation: none.
- Production blocker: NO.
- Next action: none.

### P2 — Provider generality (`cae6b3bc`)

- Implemented: YES — `FakeProvider` (`providers/__tests__/fake.provider.ts`),
  contract suite (`providers/__tests__/provider-contract.spec.ts`), fixture harness,
  `verifyWebhook` HMAC + delivery-id + topic.
- Unit-Contract verified: YES — contract vectors (§13: capability completeness,
  connection-failure taxonomy) + fixture replays.
- Integration verified: YES — FakeProvider whole-engine suites (§13 E2E clause).
- Live verified: PARTIAL (dev) — abstraction proven by MockFetch/fixture paths;
  real-provider vectors deferred to P9/P10 live steps.
- Not yet verified: live-provider contract legs (moved to P9/P10 pilots).
- External prerequisite: P9 dev-store credentials / P10 live peer (for the legs).
- Known limitation: Shopify/Custom legs stubbed loud until P9/P10.
- Production blocker: NO (stubs throw loudly, never silently pass).
- Next action: close via P9 smoke + P10 peer pilot.

### P3 — Distribution & ownership (`05fd7a0e`)

- Implemented: YES — resolver, field-state (`ProductStoreFieldState`), availability
  service (`distribution/store-availability.service.ts:32`), availability UI, bulk ops.
- Unit-Contract verified: YES — per `P3-evidence.md` suites.
- Integration verified: YES — distribution reads/writes per `P3-evidence.md`.
- Live verified: YES (dev) — distribution read path exercised in P12 drill (§2a).
- Not yet verified: none.
- External prerequisite: none.
- Known limitation: none.
- Production blocker: NO.
- Next action: none.

### P4 — Product sync, WooCommerce (`e6eda090`)

- Implemented: YES — ownership engine, overrides, categories, deletion paths,
  `StoreProductMapping`/`StoreCategoryMapping`/`StoreSkuMapping` rows.
- Unit-Contract verified: YES — engine suites incl. BR-22 combo-skip and BR-23
  informational cost row (consumed untouched by P9/P10).
- Integration verified: YES — enqueue → worker → adapter → classified attempt →
  run accounting (re-proven live in P12 §2c: `TEMPORARY_FAILURE / fetch failed`
  against the dead endpoint).
- Live verified: YES (dev) — P12 §2c provider path + duplicate-409 reconnect.
- Not yet verified: live Woo store sync (no live Woo peer in env).
- External prerequisite: live Woo peer (only for a store-specific smoke).
- Known limitation: adapter needs `baseUrl` in secrets/settings (`domain` is
  identity-only, by design — P12 §2c `INVALID_REQUEST` proof).
- Production blocker: NO.
- Next action: none (peer smoke optional, via P12 package §4a).

### P5 — Stock-status sync (`f4492267`)

- Implemented: YES — notify/coalesce/monotonic guard, audit ledger,
  fidelity gate (`sync/stock-status-sync.service.ts`: `UNSUPPORTED_FIDELITY` skip +
  audit-only `STOCK_DRIFT_MONITOR_ONLY` — UNTOUCHED by P9/P10, proven by its
  unsupported vectors consuming live `resolveCapabilities`).
- Unit-Contract verified: YES — per `P5-evidence.md`, incl. unsupported vectors.
- Integration verified: YES — fidelity gate enforced at engine + adapter layers.
- Live verified: PARTIAL (dev) — engine paths live; real-peer zero-write leg pending.
- Not yet verified: `unsupported`-fidelity zero-quantity-write assertion against a
  real dev store (P9 smoke step 11) / faithful-peer `{status}`-only PUT wire proof.
- External prerequisite: P9 dev store / P10 live peer.
- Known limitation: none (gate is fail-closed).
- Production blocker: NO.
- Next action: close via P9 smoke step 11 + P10 pilot §7.

### P6 — Order ingestion (`da2f4d0d`)

- Implemented: YES — webhooks (`webhooks/store-webhook.service.ts`, delivery-key
  dedupe), 3-day reconcile, blocked-ingest suite, EcoMate-side contact-check
  endpoint (`GET /store-bridge/v1/contact-check`, BR-14 exposure-never-enforcement).
- Unit-Contract verified: YES — per `P6-evidence.md` incl. blocked-ingest suite.
- Integration verified: YES — webhook → normalize → ingest-once
  (`StoreOrderMapping` + `Order.idempotencyKey`).
- Live verified: PARTIAL (dev) — paths live in dev; peer-originated intake pending.
- Not yet verified: real peer webhook delivery + HMAC/replay against live intake.
- External prerequisite: P9 dev store / P10 live peer.
- Known limitation: localhost guest-checkout smoke impossible in this env
  (pre-existing `BlockedIp` auto-block on `127.0.0.1` — FINAL-REPORT G-1,
  unrelated to the programme, self-expiring).
- Production blocker: NO.
- Next action: close via P9 smoke steps 5–8 + P10 pilot §3/§5.

### P7 — Order status push (`c577e80e`)

- Implemented: YES — cancel/Delivered push, read-back verify seam, loud skip
  reasons (`MANUAL_ACTION_REQUIRED`, `ORDER_STATUS_TARGET_UNSUPPORTED`).
- Unit-Contract verified: YES — per `P7-evidence.md`.
- Integration verified: YES — push → read-back agreement pattern.
- Live verified: PARTIAL (dev) — stale P7 stub-Woo process killed after use;
  no live peer push.
- Not yet verified: TEST-order-only cancel/fulfil push + read-back on a real peer.
- External prerequisite: P9 dev store / P10 live peer.
- Known limitation: none.
- Production blocker: NO.
- Next action: close via P9 smoke step 9 + P10 pilot §4.

### P8 — Channel migration (`d8da115b`)

- Implemented: YES — `ChannelResolver`, dual-write, backfill, parity check.
- Unit-Contract verified: YES — backfill 219/219 + parity per `P8-evidence.md`.
- Integration verified: YES — dual-write paths per `P8-evidence.md`.
- Live verified: YES (dev) — backfill executed live in dev (2 drill orders
  soft-trashed per repo convention).
- Not yet verified: production-copy backfill dry run (no staging/prod in env).
- External prerequisite: staging on a production copy (P12 package §2).
- Known limitation: none.
- Production blocker: NO (dry run is a gate, not a defect).
- Next action: run P12 package §2 dry run when staging exists.

### P9 — Shopify provider (commits `692ffddb` + `1c377c35` + `ffc337f6`)

- Implemented: YES (Code Complete) — `providers/shopify.provider.ts` rewritten
  (P1 stub 149 lines → ~880-line live adapter, Admin API `2024-01`); contract
  suite evolved (Shopify-live `fetchOrders` vector; Custom still stubs loud).
- Unit-Contract verified: YES (UI Complete) — `providers/__tests__/shopify-live.spec.ts`
  (38 tests) + contract net +1; backend jest 250 suites / 3513 tests PASS
  (P9-evidence §4); canonical UI gaps + secret-leak proof (`1c377c35`,
  `stores-secret-leak.spec.ts` — zero secret echoes in test-connection responses).
- Integration verified: YES — MockFetch fixture-replay + FakeProvider whole-engine
  suites (§13 E2E clause); no service/controller/worker/engine file changed
  (`git diff --name-only` shows exactly provider + contract + new spec + docs).
- Live verified: NO — Live Smoke BLOCKED: no Shopify credentials in env (verified
  no `SHOPIFY*`/`SHOP_*` entries); harness `.tmp-e2e/shopify-live-smoke.js`
  asserted env first, made zero network calls, created/mutated nothing, exited 0
  (BLOCKED verdict, never fail-open); all 12 steps BLOCKED (`P9-LIVE-SMOKE.md`);
  P11-live-vectors consequently NOT-YET. Formally Closed pending.
- Not yet verified: 12-step live smoke (testConnection → TEST- push → idempotency →
  media → order fetch → webhook intake → HMAC → replay → cancel/fulfil →
  read-back → zero-quantity-write → token-leak scan) + P11 live vectors
  (429→retryable / 401→terminal, correlation-id, health transition).
- External prerequisite: YES — operator supplies (out of band) a Shopify dev-store
  domain + custom-app Admin API token (`SHOPIFY_TEST_SHOP` / `SHOPIFY_TEST_TOKEN`).
- Known limitation: collections + `product_type` adapter-internal (flat-model move =
  loud skip `COLLECTION_FLAT_MODEL`); cost push-only, snapshot always null (BR-23).
- Production blocker: YES — live smoke is the P9 acceptance prerequisite; P10
  followed P9 per the dependency graph (now unblocked at code level by `8b1cad2f`,
  live legs still pending).
- Next action: supply credentials → re-run smoke → then P11-live-vectors → formally
  close P9.

### P10 — Custom provider, Bridge v1 (commit `8b1cad2f`)

- Implemented: YES (Code Complete) — `providers/custom-bridge.provider.ts`
  rewritten (161 lines → ~640-line live adapter); published protocol
  `docs/central-commerce/BRIDGE-V1-PROTOCOL.md` (manifest, HMAC + 5-min replay,
  order pull/webhook payloads, status push + read-back, contact-check, stock
  status-only semantics, error taxonomy); reference stub
  (`providers/__tests__/reference-bridge.ts`, test-only, 404s undocumented routes).
- Unit-Contract verified: YES (Conformance Verified) — `providers/__tests__/
  bridge-conformance.spec.ts` 40/40 (manifest validation, connection taxonomy,
  signature vectors, pull window/paging, Table-A mapping, idempotent create +
  field-scoped PUT, categories, media-hash reuse, publication, delete, faithful
  `{status}`-only + unsupported zero-write, push + read-back, webhook registry,
  missing-settings guard) + contract-suite bridge vectors; backend jest 251 suites
  / 3554 tests PASS; `nest build` clean; no migration, no drift (P10-evidence §4).
- Integration verified: YES — every adapter call terminates at documented routes
  only (stub 404s anything else); BR-06/08/22/23 enforcement points asserted;
  engine files untouched (same `git diff --name-only` discipline as P9).
- Live verified: NO — Live Peer Pending: no real custom bridge site exists in env
  (P10-evidence §6 honest gap); stub proof is the strongest available short of a
  live peer.
- Not yet verified: connect → push → order-pull → status-push → webhook delivery
  against a production bridge (companion `P10-PILOT-CHECKLIST.md` §§1–7).
- External prerequisite: YES — a real Bridge-v1 peer (endpoint + bridge key +
  optional webhook secret, out of band) + pilot-only SKUs.
- Known limitation: engine cost-push to manifest-enabled bridges stays
  informational (core gates on declared caps; adapter-layer only — needs a core
  change, deferred BR-23-safe); manifest fetched per call (no cache — correctness
  first, workers serialize per store); variant-attributes read-back EcoMate-anchored
  until first push (BR-02: drift detected, never auto-resolved).
- Production blocker: PARTIAL — code/conformance ready; live-peer pilot gates
  production enablement for Custom connections.
- Next action: run `P10-PILOT-CHECKLIST.md` against a real peer (40/40 re-green on
  the piloted commit first).

### P11 — Operations, provider-independent (`e473a9ff`)

- Implemented: YES — retention purge + scheduler (`sync/sync-retention.service.ts`,
  `sync-retention.scheduler.ts`, daily `30 3 * * * Asia/Dhaka` on
  `store-maintenance`), retry center (`sync/sync-retry.service.ts`), repeated-failure
  notify (`sync/sync-notify.service.ts`), correlation-id logging
  (`sync/store-sync-logger.ts`), health surfaces, overrides history.
- Unit-Contract verified: YES — `store-sync-logger` (5) + `sync-notify` (6) +
  `sync-retention` (8) + `sync-retry` (7) specs; backend 249 suites / 3474 tests
  PASS (FINAL-REPORT §4 == P11 baseline).
- Integration verified: YES — retry re-runs idempotent engine (SKU-keyed upsert →
  same remote ref, never duplicate); purge self-reports failures (FAILED
  MAINTENANCE run + `RETENTION_PURGE_FAILED` OPEN issue + email, never silent).
- Live verified: YES (dev) — history/audit surfaces 200 in P12 drill (§2c:
  `/sync/attempts`, `/sync/issues`, `/sync/health`); admin vitest 78 files / 767
  tests PASS + `tsc` clean; storefront 26 files / 285 tests PASS + `tsc` clean.
- Not yet verified: live-API/Playwright E2E in the P11 pass (unit + contract only —
  P11-evidence §7 recommends the standard harness before P12; P12 drill covered it).
- External prerequisite: none.
- Known limitation: accepted residual — `provider`/`correlationId` on items/attempts
  live in logs only (queryable only via a future migration; FINAL-REPORT G-5).
- Production blocker: NO.
- Next action: none.

### P12 — Rollout & rollback (docs + drill, no commit)

- Implemented: YES (Implementation Ready) — rollback procedure (FINAL-REPORT §8),
  drill scripts (deleted after), this package (`P12-READINESS-PACKAGE.md`).
- Unit-Contract verified: YES — BR-20 native-isolation units 23/23
  (`identity-sync` + `provider-registry` + `store-flags` + `store-identity`).
- Integration verified: YES — drill ON-phase: connected test store 201, duplicate
  409, `sync-all` `excludedNativeCount=1`, no-op SUCCESS then assigned-product
  FAILED with recorded `SyncAttempt` (`INVALID_REQUEST` → `TEMPORARY_FAILURE /
  fetch failed` = genuine outbound attempt).
- Live verified: YES (dev) — flags-OFF + queues-paused 15/15 PASS ×2 (sync
  surfaces 403, `SyncRun` 23→23 frozen, zero writes); native browse/checkout
  unaffected; re-enabled cleanly; full cleanup verified by SQL (0 leftovers).
  Environment Pending for staging/production.
- Not yet verified: migration validation on a production copy, backfill dry run,
  staged pilot (products → orders → stock), broader enablement, production smoke
  (FINAL-REPORT G-2 — no staging/production exists here).
- External prerequisite: YES — staging on a production copy + pilot peers.
- Known limitation: product-sync worker has no flag check of its own (rollback
  relies on flags **plus** queue pause — FINAL-REPORT G-4, one-line follow-up
  deliberately not applied to keep P12 code-free).
- Production blocker: YES — environment-gated only (all executable items done).
- Next action: execute `P12-READINESS-PACKAGE.md` §§1–7 on staging when available.

## Architecture-boundary confirmation (states are separate — code locations)

- **Provider (integration type)** — `apps/backend/src/stores/providers/
  provider-registry.service.ts:25` + `provider.contract.ts`; core never branches
  on a provider slug (P9-evidence §2: `CANCELLED`/`FULFILLED` rendered inside
  adapters).
- **Connection (per-probe result, not stored state)** — `providers/base-provider.ts:144`
  `connectionFromProbe` (reachable/authenticated/permissionsOk/mediaReachable/
  providerStoreId/capabilities); consumed by `shopify.provider.ts:456`,
  `woocommerce.provider.ts:242`, `custom-bridge.provider.ts:619`; missing settings
  throw `INVALID_REQUEST` before any HTTP call in all three.
- **Store status (connection lifecycle)** — `schema.prisma:3861` `enum StoreStatus`
  (`PENDING/CONNECTED/DISCONNECTED/AUTH_FAILED/ATTENTION_REQUIRED`) → `Store.status`
  (`schema.prisma:3883`, default `PENDING`); duplicate-connect resolves to the
  existing row with `storeStatus` echoed (`stores.service.ts:91`).
- **Health (probe history, separate model)** — `StoreHealthCheck` rows written by
  `stores.service.ts:313` `recordHealthCheck` (probe path `:196–233`); `Store.healthState`
  (`StoreHealthState`, default `DISCONNECTED`, `schema.prisma:3884`) + `lastHealthCheckAt`
  (`:3890`); read surface `GET /sync/health` (`sync/sync-ops.controller.ts:337`);
  retention purges checks after 30d (`sync-retention.service.ts:11,103`).
- **Availability (distribution, separate service)** — `distribution/
  store-availability.service.ts:32` (`StoreAvailabilityService`); reads through a
  distinct controller (`distribution.controller.ts:80`); storefront read path
  (`isActive` + `status != draft`) untouched by design (`schema.prisma:3953` note).
- **Sync states (run accounting, separate tables)** — `sync/sync-run.service.ts:28`
  (`SyncRunService`); `SyncRun`/`SyncRunItem`/`SyncAttempt` each carry their own
  `status` (`schema.prisma:4094,4129`); flags fail-closed in `stores/store-flags.ts:11–42`
  (`THIRD_PARTY_STORES_ENABLED` + `store_sync_enabled`).
- No conflation found: status ≠ healthState ≠ availability ≠ sync-run status ≠
  provider — five distinct fields/services/tables, each with its own writer and
  reader cited above.

## Consolidated verdict

- Code + contract + dev-live complete: P0–P8, P11; P9/P10 code + contract complete.
- Pending on external prerequisites only: P9 live smoke (credentials), P10 live
  peer (bridge site), P12 production sequence (staging copy).
- No production rollout before: P9 formally closed + P10 peer pilot passed +
  P12 package executed on staging (acceptance criteria: `P12-READINESS-PACKAGE.md` §7).
