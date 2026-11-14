# P9 — Shopify Provider (live adapter) · Evidence

Branch: `feature/central-commerce-p0` · base `cff92c4b` (P12 report) /
`e473a9ff` (P11) · **NOT committed** (per instruction).
Plan: `/Users/riaz/.commandcode/plans/central-commerce-multistore-integration.md`
§7 (contract), §7.1 (capability matrix — Shopify column), §8.4 (BR-08
fidelity gate), §8.5 (ingest — adapter side), §8.6 (status push), §8.7
(webhooks), §8.9 (categories), §8.11 (field matrix), §13 (contract suite),
P9 row. Plus the canonical connection-model clarification (binding):
provider = integration type, connected store = sales-channel instance
(`Store.kind` + `@@unique([kind, domainNormalised])` — NOT remodelled,
wizard structure NOT rewritten; additive gaps only).

No live Shopify credentials exist in this environment (verified: env shows
no `SHOPIFY`/`SHOP_` entries) — provider behaviour is proven by
MockFetch fixture-replay + the FakeProvider whole-engine suites (§13 E2E
clause). The live dev-store smoke is the single remaining operator
prerequisite (§8, LIVE-SMOKE-PENDING). No secrets appear in this report or
any doc.

## 1. Migration

**None.** Additive only: no schema change, no new migration, no drift.
The Shopify adapter needs no new tables/columns (credentials ride the
existing write-only `StoreCredential` row; mappings ride the P4
`StoreProductMapping`/`StoreCategoryMapping`/`StoreSkuMapping` rows).

## 2. Files

Backend `apps/backend/src/stores/providers/`:
- `shopify.provider.ts` — REWRITTEN (was the P1 capability stub, 149
  lines → full live adapter, ~880 lines). Admin API `2024-01` over the
  custom-app token (`X-Shopify-Access-Token`; OAuth-ready field shape —
  the token field also carries an OAuth token in a later phase — but the
  custom-app token is the phase-1 mechanism):
  - `testConnection`: `GET shop.json` (reachability/auth/permissions via
    the shared `connectionFromProbe` taxonomy), media preflight (HEAD
    `settings.mediaProbeUrl` when set, else `undefined`),
    `providerStoreId` = `myshopify_domain` with `shop:{id}` fallback
    (feeds `Store.identityFingerprint`, §8.10 duplicate protection).
  - `findBySku`: `GET products.json?limit=250&fields=id,variants`,
    client-side SKU scan (first-contact BR-05 probe).
  - `upsertProduct`: REST create (SKU-match first → idempotent update);
    `title/body_html/vendor/tags(handle)/status/images`,
    variants ride the create payload with `options[]` semantics, price
    pair `price = sale ?? base` / `compare_at_price = sale ? base : null`,
    `weight + weight_unit` (default `kg`), `handle`, allowlisted
    metafields (`namespace: ecomate`, `isAllowedCustomField` — secrets
    structurally excluded), collection membership via `collects` for
    numeric ids only (unresolved EcoMate UUIDs never sent — no doomed
    422), cost push-only via `inventory_items` (BR-23), SEO via GraphQL
    `productUpdate` (`seo.title/description`), combo input throws loud
    `COMBO_SKIPPED` (BR-22, never fabricated).
  - `upsertVariants`: variant list → SKU match → PUT/POST, per-variant
    cost follow-up, price pair + weight_unit.
  - `ensureCategories`/`renameCategory`/`moveCategory`: one
    `custom_collection` per level name (handle lookup before create —
    duplicate prevention), rename PUTs the mapped collection, move is a
    loud flat-model skip (`skipped: true`, `COLLECTION_FLAT_MODEL` —
    never a duplicate, never silence). Collections + `product_type` stay
    adapter-internal and never leak to core (core only sees `category`).
  - `readProductFields`: `GET products/{id}.json` → matrix snapshots
    (excerpt for shortDescription — not native; price/salePrice pair;
    `handle`; `vendor`; tags array; `publicationState`); SEO read via
    GraphQL only when requested. `costPrice` snapshot is always null
    (push-only, never read back as truth — BR-23).
  - `setPublication`: `status: active/draft`. `deleteProduct`:
    GraphQL `productDelete` mutation (BR-09, hard-delete path only).
  - `readStockState`: read-only — variants' `inventory_quantity` summed
    → `IN_STOCK`/`OUT_OF_STOCK` (one GET, zero writes; the daily audit
    raises `STOCK_DRIFT_MONITOR_ONLY`).
  - `publishStockState`/`publishVariantStockState`: INTENTIONALLY NOT
    overridden — the base BR-08 gate throws BEFORE any HTTP seam is
    touched (zero writes, asserted).
  - `fetchOrders`: `GET orders.json?status=any&created_at_min/max&limit/
    page/fields` (window + pagination, `financial_status` filter
    passthrough; raw Shopify shapes flow into the existing
    `normalizeOrder`, which already handles them — no core change).
  - `pushOrderStatus`: canonical `cancelled` → `POST .../cancel.json`,
    `completed` → `POST .../fulfillments.json` (CANCELLED/FULFILLED
    rendered inside the adapter — core never branches on a slug).
    `readOrderStatus`: `cancelled_at` → CANCELLED, `fulfilled` →
    FULFILLED, else raw (read-back verification seam, read-only).
  - `verifyWebhook`: P2 HMAC + delivery-id + topic, extended with the
    5-minute replay check where `X-Shopify-Timestamp` is supplied
    (`stale-timestamp`); absent timestamps rely on the authoritative
    `deliveryKey` dedupe in `StoreWebhookService` (unchanged).
  - `ensureWebhooks`: `orders/create`, `orders/updated`,
    `products/update` — registers missing topics only (idempotent),
    address `${callbackBaseUrl}/api/webhooks/stores/shopify`.
  - Missing settings throw `INVALID_REQUEST` before any HTTP call
    (never an unauthed call).
- `__tests__/shopify-live.spec.ts` — NEW (30 tests, §3).
- `__tests__/provider-contract.spec.ts` — the ONLY touched non-adapter
  backend file, and only the phase-evolution assertion (mirrors the P4
  precedent): the P2 `Shopify/Custom stub fetchOrders` vector splits
  into `Shopify P9: fetchOrders pages live` + `Custom still stubs loud
  (P10)`. No service, controller, worker or engine file changed —
  this is the acceptance test for the abstraction (prove with
  `git diff --name-only`: backend shows exactly these two modified
  files + one new spec).

Admin `apps/admin/src/features/channels/` (the two additive canonical gaps):
- `stores.tsx` — Connected Stores list gains the **Domain** column
  (`domainNormalised`, `—` when unset): Name, Type, Domain, Status,
  Health, Last sync, Actions (colSpan 6→7).
- `store-connect-dialog.tsx` — the single wizard keeps its flow; only
  the middle auth step switches fields/labels by platform: Shopify →
  shop-domain + Admin API access-token (+ optional webhook secret,
  custom-app-token note + BR-08 monitor-only note); WooCommerce → store
  URL + consumer key/secret; Custom → bridge endpoint + bridge key.
  Credential payloads are now per-provider and complete (`baseUrl` for
  Woo/Custom, `shop` for Shopify — previously the domain never reached
  the probe secrets). Connection/availability/sync states untouched.
- `api.test.ts` — +1 test: Shopify P9 caps render monitor-only +
  BR-22 + Dimensions rows, no cost row (`costPrice: true`), no SEO
  plugin row (`seo: true`), never failure language.

## 3. Suites (new: 39 tests)

| Suite | Tests | Proves |
|---|---|---|
| `providers/__tests__/shopify-live.spec.ts` | 38 | pure mapping units (version pin, field map, price pair, weight+unit, combo throw, slugify, excerpt, snapshots); testConnection (domain id, `shop:{id}` fallback, 401/403 taxonomy, unreachable, zero-call, media preflight ×3); create (payload, no cost/qty/dims) + idempotent update (no POST); cost ONLY via `inventory_items` PUT; SEO via GraphQL; collects numeric-only; metafield allowlist (material in, secret out); missing-settings guard; variants create/update + price pair; categories no-dup + rename + flat-model move skip; media zero-HTTP; publication active/draft; `productDelete` GraphQL; read-only stock ×2 + publish unreachable ×2; full-flow zero-quantity-write scan; orders window/paging; CANCELLED/FULFILLED push; push→read-back round-trip + FULFILLED map; HMAC accept/tamper/missing ×2 + replay fresh/stale; ensureWebhooks missing-only |
| `channels/api.test.ts` | +1 | Shopify fidelity notice renders (monitor-only + BR-22 + Dimensions, no cost/SEO-failure rows, never failure language) |
| contract suite (Shopify vectors) | evolved | `fetchOrders` live over REST; unsupported-publish zero-write, HMAC, taxonomy vectors unchanged and green |

BR-08/BR-22/BR-23 enforcement points (all asserted): BR-08 — base gate
(no override) + `publishStockState`/`publishVariantStockState` zero-call
throws + per-change `UNSUPPORTED_FIDELITY` skip and audit-only
`STOCK_DRIFT_MONITOR_ONLY` in `stock-status-sync.service.ts`
(UNTOUCHED — proven by `sync/__tests__/stock-status-sync.spec.ts`
unsupported vectors); BR-22 — adapter combo throw + engine skip (P4
suites, untouched); BR-23 — cost absent from every product/variant
payload (wire scans), `inventory_item.cost` only, cost snapshot null.
R-2/BR-21: no provider call from any mutation — adapter methods run only
in queued workers/processors (no caller changed in P9; `grep` shows
providers referenced only from services/processors/controllers that
enqueue or run in workers).

## 4. Totals (final, all green)

- Backend jest: **250 suites / 3513 tests PASS** — P11 recorded
  249/3474 (P12 was docs-only, zero test delta), so the P9 delta is
  exactly **+1 suite / +39 tests** (38 new `shopify-live` + 1 net from
  the contract split). `git diff --name-only` backend scope: exactly
  `providers/shopify.provider.ts`,
  `providers/__tests__/provider-contract.spec.ts` (+ new
  `providers/__tests__/shopify-live.spec.ts`).
- `npx nest build`: **clean**.
- Admin vitest: **78 files / 768 tests PASS** (incl. +1 P9).
- Admin `npx tsc --noEmit`: **clean**.
- Prisma: no migration (tail still
  `20260925200000_p8_sales_marketing_channels`, 127 entries incl. lock
  file); no drift introduced (no schema edit).
- Storefront untouched (no P9 surface) — suite not re-run; no
  regression vector.

## 5. HMAC + replay vectors (no secrets)

Shopify webhook verification is HMAC-SHA256 (base64) over the raw body
(`X-Shopify-Hmac-Sha256`) + `X-Shopify-Webhook-Id` + `X-Shopify-Topic`,
with a 5-minute replay window where `X-Shopify-Timestamp` is supplied
(fresh → accept, epoch `0` → `stale-timestamp`); tampered body,
wrong secret, missing signature and missing delivery id all reject with
named reasons. Fixture signing and provider verification share
`webhook-crypto.ts`, so the two can never drift apart. Intake-layer
replay (`StoreWebhookService` timestamp headers incl.
`x-shopify-timestamp`) and `deliveryKey` dedupe are unchanged.

## 6. Gaps (honest)

- **LIVE-SMOKE-PENDING (single operator prerequisite):** no live
  Shopify dev store + custom-app token exists in this environment, so
  the P9-row live dev-store smoke (connect → testConnection →
  product push → drift read → order fetch → status push → webhook
  delivery against a real dev store) has NOT run. Everything else in
  the P9 row is complete and fixture-proven. Do NOT downgrade this to
  a pass without credentials; P10 follows the smoke per the dependency
  graph.
- Variant-with-orders archive path: `variantDelete: false` is declared
  and core never auto-deletes remote extras (P4 behaviour, untouched);
  the explicit archive+issue flow for Shopify variants is exercised
  through the same core path as Woo's delete-false branch — no
  Shopify-specific variant-delete call exists by design.
- `product_type` leaf naming on create relies on the optional
  `__productTypeLeaf` routing hint (adapter-internal); core does not
  send it today (no core change per the acceptance rule), so fresh
  creates carry an empty product_type until the mapping hint flows —
  collections (the primary category vehicle) are fully wired.

## 7. Walkthrough (operator-visible, post-smoke)

1. Stores → Connect store → **Shopify** → shop domain + Admin API
   access token → Create → Test connection: reachable/auth/permissions
   badges + media preflight + capability summary incl. the monitor-only
   stock notice → store row shows the **Domain** column.
2. Assign a product to the Shopify store → Product Sync pushes
   title/handle/vendor/tags/price-pair/images → collections ensured per
   path (adapter-internal) → publication follows availability.
3. Stock moves on EcoMate → per-change path skips with
   `UNSUPPORTED_FIDELITY` (zero writes); the 03:00 audit reads Shopify
   inventory and raises `STOCK_DRIFT_MONITOR_ONLY` on mismatch.
4. A Shopify order arrives via webhook (HMAC verified, deduped) or the
   hourly 3-day reconcile → normalized → ingested once. Cancel/Delivered
   pushes CANCELLED/FULFILLED with read-back verification.

## 8. DEFERRED (explicitly NOT in P9)
- P10 Custom provider (Bridge v1): protocol spec, manifest discovery,
  conformance suite. The `CustomBridgeProvider` stub and its
  contract-suite loud vectors are untouched.
- Live dev-store smoke (blocked on operator credentials — §6).
- Storefront work (none required by P9).

## 9. API version alignment 2024-01 → 2026-07 (post-P9 fix-forward)

Finding: `SHOPIFY_API_VERSION` was pinned to `2024-01`, which is
unsupported — Shopify fall-forwards such requests to the oldest
accessible stable, silently changing behavior, and the pin mismatched
the Dev Dashboard app version (2026-07). Verified against the live
2026-07 release notes + versioning docs (Sep 2026).

Endpoint-by-endpoint safety (all calls flow through the one constant):
- products/variants REST: deprecated since 2024-04 but functional for
  custom apps within 100 variants / 3 options → enforced client-side
  (`VARIANT_LIMIT_EXCEEDED`, zero HTTP, explicit issue).
- orders GET / cancel.json, fulfillments.json, collects/custom_collections,
  metafields, inventory_items (cost), shop.json: current under 2026-07.
- GraphQL productUpdate (SEO-only) + productDelete: current.
- Events payload/subscription change: Events (developer preview) only —
  classic HTTPS webhooks unaffected.
- Webhook POST now pins `api_version: 2026-07` (was dashboard-default).
- testConnection reports served `X-Shopify-API-Version` with a
  `fallForward` flag — silent reinterpretation is now loud.
- 2026-07 `FULFILLMENT_NOT_REQUIRED` status value flows through as a raw
  string (no wrong mapping); variant-level publishing untouched.

Tests: version pin, webhook api_version body, cap-guard zero-call ×2,
fall-forward flagged/clean. Backend 3568/3568, build clean.
