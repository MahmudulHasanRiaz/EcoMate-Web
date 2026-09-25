# P9 — Live dev-store smoke · Report

Branch: `feature/central-commerce-p0` · HEAD `1c377c35` · **NOT committed** (per instruction).
Plan: `central-commerce-multistore-integration.md` P9 row (live dev-store smoke = P9 acceptance prerequisite; P10 follows P9).
Harness: workspace-root `.tmp-e2e/shopify-live-smoke.js` (env-driven only: `SHOPIFY_TEST_SHOP`, `SHOPIFY_TEST_TOKEN`; untracked; **deleted after the attempt**).
Backend during attempt: local `:4000` healthy (probe `/api/health` → `healthy`, DB ok); env left as found.
No secrets appear in this report, the harness output, or any doc (token masked last-4-only in harness stdout; token never written to disk).

## Verdict: BLOCKED (no credentials — zero network calls, nothing created, nothing mutated)

No Shopify credentials exist in this environment (verified: env shows no `SHOPIFY*`/`SHOP_*` entries). The harness asserted both
`SHOPIFY_TEST_SHOP` and `SHOPIFY_TEST_TOKEN`, found both unset, recorded BLOCKED for all 12 steps, and exited 0 — never fail-open,
never called a real store. This matches the standing P9-evidence position (`LIVE-SMOKE-PENDING`, the single operator prerequisite).

## 12-step table (attempt of 2026-09-25)

| # | Step | Verdict | Detail |
|---|---|---|---|
| 1 | testConnection (`GET shop.json`, Admin API `2024-01`) | BLOCKED | `SHOPIFY_TEST_SHOP`/`SHOPIFY_TEST_TOKEN` unset — no call made |
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

Operator supplies (out of band, never in docs/chat/logs): a Shopify **dev store** domain + a **custom-app Admin API token**
(products read/write, orders read, fulfils as needed for step 9) → re-run `node .tmp-e2e/shopify-live-smoke.js` with
`SHOPIFY_TEST_SHOP` / `SHOPIFY_TEST_TOKEN` set → expected PASS (or SKIP with reason on steps 5/9 if scopes are read-only) →
then P11-live-vectors RUN. Re-delete the script after the attempt; do not commit it.
