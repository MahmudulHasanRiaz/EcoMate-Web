# P10 — Production Pilot Checklist (Real Custom Bridge Peer)

Branch: `feature/central-commerce-p0` · Date: 2026-09-25.
Protocol: `docs/central-commerce/BRIDGE-V1-PROTOCOL.md` · Adapter:
`apps/backend/src/stores/providers/custom-bridge.provider.ts` ·
Evidence: `docs/central-commerce/P10-evidence.md`.

## Pre-pilot gate (mandatory, already met in-repo)

- **Conformance suite `providers/__tests__/bridge-conformance.spec.ts`: 40/40 PASS**
  (recorded in P10-evidence §3–§4; backend jest 251 suites / 3554 tests PASS,
  `nest build` clean, no migration, no drift).
- **Reference stub** (`providers/__tests__/reference-bridge.ts`) proves the
  adapter speaks only documented routes (anything undocumented 404s) — but it
  is test-only and does NOT substitute for this pilot.
- **Gate rule: do not start the pilot below until 40/40 is green on the exact
  commit being piloted.** If any adapter/provider file changed since the green
  run, re-run `npx jest bridge-conformance` and `npx jest provider-contract`
  first.

## Pilot prerequisites (operator supplies out of band — never in docs/chat/logs)

- Real bridge peer: base endpoint URL + bridge key (+ webhook secret if the
  peer signs webhooks).
- Peer implements Bridge v1 per `BRIDGE-V1-PROTOCOL.md` (manifest, bearer
  check, order pull, status targets, webhook registry/topics).
- A pilot product with a pilot-only SKU prefix (mirror the P9 `TEST-` convention:
  never touch real catalogue/orders).

## 1. Manifest discovery

Steps:
1. Connect store → **Custom (Bridge v1)** → endpoint + bridge key (+ optional
   webhook secret) → Create → Test connection.
2. Inspect the returned capability summary (stock fidelity, contact-check
   exposure, BR-22 row) rendered via the existing `CapabilityNotice` path.

Expected evidence:
- `testConnection` returns reachable/auth/permissions + media preflight +
  **manifest-resolved capabilities** (`providerStoreId` = bridge `storeId`;
  P10-evidence §2).
- Missing/empty `storeId` in manifest → `INVALID_REQUEST` (loud, not silent).

Stop/rollback:
- STOP if 200 + invalid manifest shape renders permissions-ok (must be
  `permissionsOk: false` per the taxonomy). Do not proceed to pushes.
- STOP on unreachable/auth failure — fix peer or credentials; nothing is
  written by a failed probe (missing keys = zero-call).

## 2. Authentication

Steps:
1. Correct key → Test connection ok.
2. Wrong key → expect 401 taxonomy result (reachable, not authenticated).
3. Missing key/settings → expect `INVALID_REQUEST` before any HTTP call.

Expected evidence:
- Wrong-key 401 and missing-settings guard both asserted in conformance
  (testConnection taxonomy + connection-guards vectors, P10-evidence §3);
  pilot must reproduce the same observable results against the real peer.

Stop/rollback:
- STOP if a call is attempted without credentials (check backend logs for
  `[custom] missing connection settings`) — file a bug, do not retry blindly.

## 3. Order pull + webhook intake

Steps:
1. Seed ≥3 pilot orders on the peer spanning a known window (mirrors the stub's
   5 seeded orders over 2026-09-20…24 pattern).
2. Run the hourly 3-day pull path (`GET /bridge/v1/orders?since&until&status&
   page&page_size` — inclusive window, 1-based pages, `has_more`) and confirm
   all seeded orders arrive exactly once (idempotency via `StoreOrderMapping` +
   `Order.idempotencyKey`).
3. Trigger an `order.created` webhook from the peer; confirm HMAC accept
   (`X-EcoMate-Signature` over `{deliveryId}.{timestamp}.{rawBody}` +
   `X-EcoMate-Delivery-Id` + `X-EcoMate-Timestamp`) and dedupe on redelivery.

Expected evidence:
- Window/status/paging results match the peer's seed (inclusive edges, status
  filter, empty window → empty, `orders: false` → loud throw, never silence).
- Webhook delivery row recorded; redelivery does not create a second order.

Stop/rollback:
- STOP on duplicates (two orders for one peer order) — halt pull + webhook,
  quarantine with `orders: false`-style loud errors, investigate mapping keys.
- STOP if `line_items[]`/`quantity` canonical vs `items[]`/`qty` accepted shapes
  mis-map quantities (Table A mapping — no cost/qty/secrets on the wire).

## 4. Status push + read-back

Steps:
1. Push `cancelled` (and `completed` if the peer lists it) for a PILOT order
   only → then `readOrderStatus` read-back (upper-cased canonical).
2. Push an off-list target → expect loud `ORDER_STATUS_TARGET_UNSUPPORTED`
   (never silent).

Expected evidence:
- Push + read-back round-trip agrees with peer-side state.
- Off-list target raises loudly; core `MANUAL_ACTION_REQUIRED` surfaces where
  applicable.

Stop/rollback:
- STOP if a push reports success but read-back disagrees — treat as
  truthfulness bug (cf. Q4 `bulkAssign` precedent); do not batch-push further.
- Never push status for non-pilot orders during the pilot.

## 5. Replay protection

Steps:
1. Replay a captured webhook with the same delivery id → must be rejected as
   duplicate.
2. Deliver with a stale timestamp (outside the 5-min window) → `stale-timestamp`.
3. Tamper the body / use the wrong secret → `bad-signature`.

Expected evidence: accept-fresh / reject-tamper / reject-wrong-secret /
reject-stale / reject-missing-fields — the same vectors asserted in
conformance signature tests (P10-evidence §3) and §5 (no secrets logged).

Stop/rollback:
- STOP if any replayed/stale/tampered delivery is accepted — disable the peer
  webhook registration (`ensureWebhooks` topics) until fixed; reconcile pull
  remains the fallback (BR-11).

## 6. Error handling

Steps:
1. Force peer 429 / 500 / 401 on pull and push paths.
2. Confirm classification via the shared taxonomy (`classifyHttpStatus` /
   `classifyProviderError` in `providers/retry-classifier.ts`): 429→retryable,
   401→terminal, with correlation-id propagation in sync logs.

Expected evidence: retryable errors enqueue retries (never silent drops);
terminal errors surface as failed attempts with `errorCategory` + audit trail
(`GET /sync/attempts`, `/sync/issues`, `/sync/health` all 200 — FINAL-REPORT §2c).

Stop/rollback:
- STOP on silent failures (success reported but nothing happened) or on
  uncapped retry storms — pause the six sync queues (see P12 package) and
  investigate before resuming.

## 7. Stock semantics + contact-check (observe, do not force)

- Faithful peers: `publishStockState` PUTs body **exactly**
  `{status: in_stock|out_of_stock}` (BR-06 wire-body scan in conformance).
  Capture one wire body and confirm no `quantity|inventory_quantity|available`.
- `unsupported` peers: publish attempts must throw **before any stock write**
  (zero writes, monitor-only — BR-08).
- Contact-check (`GET /store-bridge/v1/contact-check`) is exposure, never
  enforcement (BR-14): EcoMate never blocks on the peer's behalf.
- STOP on any quantity write to a peer (BR-08 violation) — same rollback as §6.

## Pilot exit criteria

- All seven items above recorded with evidence (not test-count-only: attach
  wire bodies, read-back outputs, delivery rows).
- Zero non-pilot artefacts created; pilot artefacts cleaned (products/orders
  removed, mappings verified empty).
- Open P10 gaps (§6 of P10-evidence: engine cost-push informational,
  variant-attributes read-back EcoMate-anchored) re-confirmed as still
  documented, not silently changed.
