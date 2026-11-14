# P2 — Provider Generality · Evidence Report

Branch: `feature/central-commerce-p0` · Date: 2026-09-25
Commit: uncommitted (this pass — DO NOT COMMIT per instruction)

## DoD (plan §14, P2 row)

| Item | Status | Evidence |
|---|---|---|
| FakeProvider (in-memory, deterministic) | ✅ | `providers/__tests__/fake.provider.ts` — full contract, fixtures seeding, failure injection, call log |
| Contract suite green vs FakeProvider | ✅ | `providers/__tests__/provider-contract.spec.ts` — 89/89 |
| Contract suite gate vs each real adapter (mocked fetch) | ✅ | same spec — capability completeness, taxonomy, fidelity gate, webhook vectors per adapter |
| Shared fixture harness for P4/P9/P10 | ✅ | `providers/__tests__/fixtures.ts` — builders, MockFetch, delivery signers, `seedFakeProvider` |
| Adapter field list ⊆ §8.11 matrix | ✅ | `syncedFields ⊆ §8.11 Table A` describe — all 4 providers; exclusions documented |
| Stock fidelity: faithful never quantity, unsupported zero writes | ✅ | `stock fidelity (BR-06/BR-08)` — `{ref,state}`-only detail; Shopify throws pre-HTTP, 0 fetch calls |
| Order pagination + window boundaries | ✅ | 1-based pages 2/2/1 + hasMore; inclusive edges; status filter; empty window |
| Webhook accept/reject vectors | ✅ | WC/Shopify/Custom+Fake: valid, tampered, wrong secret, missing signature/delivery-id, stale timestamp, no secret |
| Retry classification (§8.1) | ✅ | status table, ProviderError passthrough, network transient, fail-closed unknown, ladder + cap locked |

## Files

- `providers/__tests__/fake.provider.ts` (new, ~590 lines): kind `custom`, `stockStatusFidelity faithful`, scripted products/variants/media/categories/orders, `injectFailure({method?, times, category})`, `calls`/`uploads` logs. TEST-ONLY — never registered in `StoresModule`, no route wiring.
- `providers/__tests__/fixtures.ts` (new): `buildProductFixture/Variant/Media/CategoryPaths`, `buildOrderFixtures` (5 orders 2026-09-20…24), `buildStoreUnit` (per-kind secrets), `MockFetch` (+`jsonResponse`, `networkError`), `buildWoo/Shopify/CustomDelivery` (sign via `webhook-crypto` — one implementation), `seedFakeProvider` (IN/OUT/variable/external-diff products + orders).
- `providers/__tests__/provider-contract.spec.ts` (new): 89 tests, all vectors above.
- `providers/{webhook-crypto,field-snapshot,retry-classifier}.ts` (new, additive): shared HMAC (WC/Shopify base64, Custom hex over `deliveryId.timestamp.body`) + 5-min replay window; stable-hash snapshots (P3/P4 baselines); pure `classifyHttpStatus/classifyProviderError` + `[30s,2m,10m,1h,6h]`/`MAX_SYNC_ATTEMPTS=5`.
- `provider.contract.ts` (+7): optional `syncedFields` (§8.11 subset, required by `BaseCommerceProvider`).
- `base-provider.ts` (+fetch seam `FetchFn`/`setFetchFn`/`probeJson`/`tryProbe`/`connectionFromProbe`, BR-08 `publishStockState` gate throwing pre-HTTP, abstract `syncedFields`).
- 3 adapters (+`testConnection` probe + `verifyWebhook` + `syncedFields` each): WC `system_status`+site_url, media HEAD preflight; Shopify `shop.json`+domain; Custom `bridge/v1/manifest`+storeId.
- Fixes applied during this pass (staged P2 work defects): dangling comment fragment in `base-provider.ts` (syntax error, build-breaking); adapters used throwing `probeJson` in `testConnection` — now `tryProbe` → unreachable-as-data per documented intent; base `resolveCapabilities/testConnection` zero-arg vs subclass one-arg (TS2416); `FixtureProductInput` → `Record<string,unknown>` spread at seed sites; Fake `syncedFields` dropped `costPrice` (declares `cost:false`, mirrors bridge safe default).

## Test/build results

backend **225 suites / 3209 tests pass** (baseline 224/3120 per P1 evidence +89 contract, net of harness-only files) · `nest build` exit 0 · no migration (additive code only, no schema touch) · no routes added/changed · `StoresModule` registrations unchanged (Fake never registered).

## Gaps / not in P2 scope

- Live HTTP for upsert/variants/media/orders/status-push/webhooks-ensure remains stubbed (`notImplemented`, loud) — lands in P4 (WooCommerce), P9 (Shopify), P10 (Custom bridge). The suite asserts the stubs throw.
- Table B per-field behaviour matrix (P4), ownership engine (P3/P4), stock/order engines (P5/P6) consume this harness; not implemented here.
- Unrelated pre-existing workspace noise left untouched: `.commandcode/taste/.../taste.md` (modified), `.tmp-e2e/` (untracked).
