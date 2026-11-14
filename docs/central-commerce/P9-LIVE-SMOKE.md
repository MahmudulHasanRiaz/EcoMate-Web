# P9 — Live dev-store smoke · Report

Branch: `feature/central-commerce-p0` · HEAD `1c377c35` · **NOT committed** (per instruction).
Plan: `central-commerce-multistore-integration.md` P9 row (live dev-store smoke = P9 acceptance prerequisite; P10 follows P9).
Harness: workspace-root `.tmp-e2e/shopify-live-smoke.js` (env-driven only: `SHOPIFY_TEST_SHOP`, `SHOPIFY_TEST_CLIENT_ID`,
`SHOPIFY_TEST_CLIENT_SECRET`; untracked; **deleted after the attempt**). Auth is Client Credentials Grant (per current Shopify
docs — no static access-token var; webhook HMAC uses the client secret, no separate webhook-secret var). Required scopes (unchanged):
`write_products`, `write_inventory`, `write_orders`.
Backend during attempt: local `:4000` healthy (probe `/api/health` → `healthy`, DB ok); env left as found.
No secrets appear in this report, the harness output, or any doc (token masked last-4-only in harness stdout; token never written to disk).

## Verdict: BLOCKED (no credentials — zero network calls, nothing created, nothing mutated)

No Shopify credentials exist in this environment (verified: env shows no `SHOPIFY*`/`SHOP_*` entries). The harness asserted
`SHOPIFY_TEST_SHOP`, `SHOPIFY_TEST_CLIENT_ID` and `SHOPIFY_TEST_CLIENT_SECRET`, found them unset, recorded BLOCKED for all
12 steps, and exited 0 — never fail-open,
never called a real store. This matches the standing P9-evidence position (`LIVE-SMOKE-PENDING`, the single operator prerequisite).

## 12-step table (attempt of 2026-09-25)

| # | Step | Verdict | Detail |
|---|---|---|---|
| 1 | testConnection (token exchange + `GET shop.json`, Admin API `2026-07`) | BLOCKED | `SHOPIFY_TEST_SHOP`/`SHOPIFY_TEST_CLIENT_ID`/`SHOPIFY_TEST_CLIENT_SECRET` unset — no call made |
| 2 | Product push (`TEST-` prefix, status draft) | BLOCKED | same — no artifact created |
| 3 | SKU idempotency (client-side scan → PUT, never duplicate POST) | BLOCKED | same |
| 4 | Media (image attach on TEST- product only) | BLOCKED | same |
| 5 | Order fetch (read-only; SKIP with reason if creation scopes unavailable) | BLOCKED | same — no order read, no order created |
| 6 | Webhook receive (backend intake reachability, reject-as-data) | BLOCKED | same — intake not probed without a store context |
| 7 | HMAC (accept good / reject tampered, `timingSafeEqual`) | BLOCKED | same (local crypto vector runs only inside a live attempt) |
| 8 | Replay rejection (stale-timestamp / missing-delivery-id) | BLOCKED | same |
| 9 | Cancel/fulfil push (TEST- order ONLY, else SKIP — never touch real orders) | BLOCKED | same |
| 10 | Read-back (re-GET TEST- product, SKU present) | BLOCKED | same |
| 11 | No stock-quantity write assert (wire-body scan, BR-08) | BLOCKED | same — zero wire bodies sent |
| 12 | Token-leak scan (full token absent from logs/disk) | BLOCKED | same — nothing logged beyond `(unset)`; nothing written to disk |

Harness exit code: `0` (BLOCKED is a verdict, not a failure; fail-open is forbidden).

## Isolation & safety properties (as built — verified by code path, not yet exercised live)

- Credential gate precedes ALL network I/O (first branch in `main()`); BLOCKED path performs zero `fetch` calls.
- Shop guard: refuses non-`*.myshopify.com` shops outright; refuses non-dev shops unless `SHOPIFY_ALLOW_NONDEV=true`.
- All artifacts carry the `TEST-` prefix (`TEST-smoke-<stamp>` / `TEST-SKU-<stamp>`); status `draft` on create.
- Before/after `products/count.json` comparison; any mismatch flags the run and forces investigation.
- Cleanup in `finally`: `DELETE /products/{id}.json` for the TEST- product; cancel/fulfil touches a TEST- order only, otherwise SKIP.
- Order creation is NEVER attempted against the store (step 5 is GET-only).
- Token: read from env only, masked to last-4 in every log line, never written to any file (asserted by step 12's log-buffer scan).

## P11-live-vectors: NOT-YET

P11-live-vectors (retry classification 429→retryable / 401→terminal, correlation-id propagation, health transition probe) run only
on smoke PASS per the directive. Smoke is BLOCKED → vectors recorded **NOT-YET**. The pure retry-classifier units
(`retry-classifier.ts`: `classifyHttpStatus`/`classifyProviderError`) remain covered by the existing backend suites; no live vector ran.

## What unblocks this

Operator supplies (out of band, never in docs/chat/logs): a Shopify **dev store** domain + the Dev Dashboard app's **Client ID**
and **Client Secret** (Client Credentials Grant; scopes `write_products`, `write_inventory`, `write_orders`; webhook HMAC uses the
client secret) → re-run `node .tmp-e2e/shopify-live-smoke.js` with
`SHOPIFY_TEST_SHOP` / `SHOPIFY_TEST_CLIENT_ID` / `SHOPIFY_TEST_CLIENT_SECRET` set → expected PASS (or SKIP with reason on steps 5/9 if scopes are read-only) →
then P11-live-vectors RUN. Re-delete the script after the attempt; do not commit it.

## LIVE RUN 2026-09-26 — dev store ecomate-rq7rmj4g (operator-connected, no secrets below)

The operator connected the store through the wizard, unblocking the live
sequence. Executed through backend APIs (stored encrypted credentials —
values never printed, logged, or committed).

| # | Step | Verdict + evidence |
|---|---|---|
| 1 | testConnection | **PASS** — reachable/authenticated/permissionsOk true, providerStoreId resolved, apiVersion `{requested 2026-07, served 2026-07, fallForward false}`. Store PENDING → CONNECTED, health HEALTHY |
| 2 | Product push | **PASS** — TEST product pushed, remote id assigned, run SUCCESS |
| 3 | Variant/SKU idempotency | **PASS** — 3 syncs, same remote id, no duplicate. **Live-found gap FIXED**: simple products pushed with empty SKU + 0.00 price (adapter dropped product-level sku/price) → default-variant synthesis on create + id-attached patch on update, 3 new unit tests |
| 4 | Media | **SKIP** — test product carried no media (MediaService ingest path covered by existing suites + fixture vectors) |
| 5 | Order fetch | **BLOCKED (app)** — `orders.json` 403: order endpoints require protected-customer-data approval (proven: even `fields=id` 403s). PII-stripped fallback attempted and reverted — endpoint-level gate, no degraded path exists. Needs dashboard approval |
| 6 | Webhook receive | **PASS** — `products/update` delivery row recorded from our own push (tunnel → HMAC → dedupe → 200) |
| 7 | HMAC verification | **PASS** (same delivery accepted) |
| 8 | Delivery-ID replay | **PASS by suite** (live replay not forced against merchant store; dedupe unit + keyed-intake vectors green) |
| 9 | Cancel/fulfil push | **PENDING** — no test order on the dev store; operator to create one (or approve data access first: cancel/fulfil endpoints likely share the order gate) |
| 10 | Read-back | **PASS** — remote variant read back sku + 150.00 after Force + fix; deletion read-back 404 |
| 11 | No stock write | **PASS** — zero stock-quantity writes (unit-gated + no stock path executed; remote inventory untouched) |
| 12 | Secret leakage | **PASS** — responses/logs scanned, no credential values (secret-leak suite extended: 400-mapping, PENDING→CONNECTED) |

Additional live finds fixed in this run: stale backend process (restarted on current build); single-use fetch-body bug hiding HTML OAuth refusals (now loud `app_not_installed`); generic-500 masking → 400 with action; install-landing 404 → HMAC-verified `/` handler (replayed install URL → 200); missing PENDING→CONNECTED transition; keyed webhook registration vs relative `PUBLIC_API_BASE_URL` (loud 400 guard + env set); protected-data webhook topics skip with reason (reconcile covers ingestion); unwired BR-09 `deleteRemote` (now enqueued post-commit; live 404 + mapping cleanup proven).

Cleanup: both TEST products deleted remotely, 0 mappings, 0 test orders, 0 blocks. P11-live-vectors: correlationId on runs + ORDER_RECONCILE_FAILED issue + DISCONNECTED→ERROR→HEALTHY transition observed live; forced-transient retry remains unit-covered.
