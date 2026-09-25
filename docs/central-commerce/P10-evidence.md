# P10 — Custom Provider (Bridge v1) · Evidence

Branch: `feature/central-commerce-p0` · base `692ffddb` (P9) · **NOT
committed** (per instruction).
Plan: `/Users/riaz/.commandcode/plans/central-commerce-multistore-integration.md`
§7 (contract), §7.1 (capability matrix — Custom column), §8.4 (BR-08
fidelity gate), §8.5 (ingest — adapter side), §8.6 (status push), §8.7
(webhooks), §8.9 (categories), §8.11 (field matrix), §13 (contract suite),
P10 row. Plus the canonical principle (binding, same as P9): the Custom
connection flows through the single common wizard (which already has the
Custom auth step — endpoint + bridge key + optional webhook secret — P10
needs no more fields), no bespoke workflow, no hard-coupling to core.

No live custom bridge exists in this environment — provider behaviour is
proven by the reference stub bridge (in-repo, test-only, implements only
the documented spec) + MockFetch fixture-replay, plus the FakeProvider
whole-engine suites (§13 E2E clause). No secrets appear in this report or
any doc.

## 1. Migration

**None.** Additive only: no schema change, no new migration, no drift.
The bridge adapter needs no new tables/columns (credentials ride the
existing write-only `StoreCredential` row — `baseUrl`/`bridgeKey`/
`webhookSecret`, already collected by the wizard's Custom auth step;
mappings ride the P4 `StoreProductMapping`/`StoreCategoryMapping`/
`StoreSkuMapping` rows; orders ride `StoreOrderMapping` + `Order.
idempotencyKey`).

## 2. Files

Published protocol:
- `docs/central-commerce/BRIDGE-V1-PROTOCOL.md` — NEW. Manifest
  discovery (`GET {endpoint}/.well-known/ecomate-bridge` → capabilities
  incl. stock model, order pull, webhook registration, contact-check),
  HMAC signing (`X-EcoMate-Signature` + delivery id + timestamp, 5-min
  replay), order pull + webhook payloads (NormalizedOrder shape —
  `line_items[]`/`quantity` canonical, `items[]`/`qty` accepted),
  status push + read-back, contact-check endpoint contract (EcoMate-side
  `GET /store-bridge/v1/contact-check`, exposure never enforcement —
  BR-14), stock status-only semantics (faithful-status recommended
  default; unsupported → zero-write monitor), error taxonomy
  (bridge-code → `ProviderErrorCategory` table, §8.1 backoff), and the
  conformance runbook (`npx jest bridge-conformance` /
  `npx jest provider-contract`).

Backend `apps/backend/src/stores/providers/`:
- `custom-bridge.provider.ts` — REWRITTEN (was the P1 capability stub +
  P2 testConnection/verifyWebhook, 161 lines → full live adapter, ~640
  lines). Bearer auth; `BRIDGE_API_VERSION = '1.0'`,
  `BRIDGE_MANIFEST_PATH = '/.well-known/ecomate-bridge'`,
  `BRIDGE_WEBHOOK_TOPICS = [order.created, order.updated,
  product.updated]`, canonical targets `[cancelled, completed]`:
  - `fetchManifest`: GET manifest, `storeId` required (missing/empty →
    `INVALID_REQUEST`), capabilities-object validation; HTTP statuses
    classified via `classifyHttpStatus`.
  - `bridgeManifestToCapabilities` (pure, exported): declared safe
    defaults overlaid with manifest **narrowing only** — except
    `costPrice`, which the manifest may enable (still push-only, never
    customer-facing — BR-23); `combos` forced `false` even when the
    manifest claims `true` (BR-22); targets intersected with the
    canonical vocabulary; invalid enums fall back to declared.
  - `resolveCapabilities`: live manifest → resolved; **any failure →
    declared safe defaults, never a throw** (core calls this in workers;
    the actual sync calls surface outages loudly).
  - `testConnection`: missing keys → unreachable zero-call; manifest
    probe with the shared taxonomy (200 + valid manifest → full ok +
    `providerStoreId` = bridge `storeId` + **manifest-resolved
    capabilities** so the wizard renders the real fidelity/contact-check
    summary; 200 + invalid shape → auth ok, `permissionsOk: false`;
    401/403/500 per taxonomy; network → unreachable); media preflight
    from `manifest.mediaProbeUrl` ?? `settings.mediaProbeUrl`.
  - Products/variants (SKU-idempotent create, field-scoped PUT via
    `scopePayload` — price pair travels together; `MISSING_SKU` and
    `COMBO_SKIPPED` throw before any HTTP call), categories (slug⊂parent
    lookup before create; rename PUTs the mapped term; move re-parents,
    `422 capability_unsupported` → loud `skipped` with reason),
    media (url-fetch, hash lookup first — mapped media never
    re-uploaded), `setPublication` (`published`/`draft`), `deleteProduct`
    (manifest `delete: false` → loud `CAPABILITY_UNSUPPORTED`, core
    raises `MANUAL_ACTION_REQUIRED` — BR-09).
  - Stock: `readStockState`/`readVariantStockState` read-only;
    `publishStockState`/`publishVariantStockState` resolve the manifest
    first — `faithful` → PUT with body **only** `{status:
    in_stock|out_of_stock}`; `unsupported` → throw **before any HTTP
    write beyond the manifest GET** (zero writes, monitor-only like
    Shopify — BR-08); manifest outage → fail closed (throw, retryable),
    never a blind write (BR-06).
  - `fetchOrders`: `GET /bridge/v1/orders?since&until&status&page&
    page_size` (inclusive window, 1-based pages, `has_more`;
    `orders: false` → loud throw).
  - `pushOrderStatus`: target ∩ manifest targets, else loud
    `ORDER_STATUS_TARGET_UNSUPPORTED` (never silent — §8.6);
    `readOrderStatus` read-back (upper-cased canonical).
  - `ensureWebhooks`: registers missing topics only (idempotent),
    address `{callbackBaseUrl}/api/webhooks/stores/custom`;
    `webhooks: false` → loud throw (reconcile remains — BR-11).
  - `verifyWebhook`: unchanged P2 (HMAC + delivery id + 5-min replay).
  - Missing settings throw `INVALID_REQUEST` before any HTTP call.
- `__tests__/reference-bridge.ts` — NEW (test-only). In-memory Bridge v1
  server on the MockFetch seam implementing **only** the documented spec
  (any undocumented path 404s): manifest (configurable caps/storeId/
  corruption modes/re-parent support), idempotent products, variants,
  categories, media-with-hash, status-only stock (unsupported mode
  422s PUTs), 5 seeded orders over 2026-09-20…24 with window/status/
  paging, order status targets, webhook registry, bearer check (wrong key
  → 401).
- `__tests__/bridge-conformance.spec.ts` — NEW (40 tests, §3).
- `__tests__/provider-contract.spec.ts` — the ONLY touched non-adapter
  backend file, and only phase-evolution assertions (mirrors the P4/P9
  precedent): `resolveCapabilities` static-pair (Woo/Shopify) + Custom
  live-manifest/fallback spoof; stock vector → bridge faithful wire +
  unsupported zero-write; `fetchOrders` → live over
  `/bridge/v1/orders`. Contract header comment updated (P9/P10 live).
  No service, controller, worker or engine file changed — the acceptance
  test for the abstraction holds for the second provider in a row
  (`git diff --name-only`: backend shows exactly these two modified
  files + two new specs + the protocol doc).

Admin / storefront: **untouched.** The wizard's Custom auth step
(endpoint + bridge key + optional webhook secret) already collects every
protocol credential; `testConnection` now returns manifest-resolved
capabilities through the existing `CapabilityNotice` path (stock fidelity
+ contact-check + BR-22 rows render generically — proven by the P9 caps
test). No new fields, no new workflow.

## 3. Suites (new: 43 tests)

| Suite | Tests | Proves |
|---|---|---|
| `providers/__tests__/bridge-conformance.spec.ts` | 40 | manifest validation (full/narrow/combos-forced/targets-intersect/cost-enable/no-widen/unreachable-fallback/missing-storeId); testConnection taxonomy (200+storeId+caps, wrong-key 401, 403/500, unreachable, zero-call, media preflight ×3); signature vectors (accept/tamper/wrong-secret/stale/missing ×2); order-pull window (1-based 2/2/1, `has_more`, inclusive edges, status filter, empty window, `orders:false` loud); payload mapping (Table A, no cost/qty/secrets; narrowing omissions); combo throw pre-HTTP; missing-SKU zero-call; idempotent create + field-scoped PUT; snapshots (cost null); slugify; variants SKU match; categories no-dup + rename + move + unsupported-move skip; media hash reuse (1 POST); publication; delete + `delete:false` loud; faithful PUT `{status}`-only + variant round-trip + full-flow zero-quantity scan; unsupported zero-write + read-available; push + read-back round-trip + off-list target loud; ensureWebhooks missing-only + idempotent + `webhooks:false` loud; missing-settings guard |
| contract suite (bridge vectors) | evolved (+1 net) | `resolveCapabilities` live-manifest + unreachable-fallback; faithful publish wire `{status: out_of_stock}` + unsupported zero-write; `fetchOrders` live paging |
| reference bridge | harness | every adapter call above terminates at documented routes only (undocumented → 404) |

BR-06/08/22/23 enforcement points (all asserted): BR-06 — PUT bodies
equal `{status}` exactly + full-flow write-body scan rejects
`quantity|inventory_quantity|available`; BR-08 — unsupported publishes
throw before any stock write (PUT/POST count zero), engine
`UNSUPPORTED_FIDELITY` skip + audit-only `STOCK_DRIFT_MONITOR_ONLY` in
`stock-status-sync.service.ts` (UNTOUCHED — proven by its unsupported
vectors, which consume `resolveCapabilities` live); BR-22 — pure +
adapter combo throws + engine skip (P4 suites, untouched); BR-23 — cost
absent from every wire body (scans), snapshot null, engine informational
row on declared `costPrice: false` (P4, untouched — manifest-enabled cost
is honored at the adapter payload layer for field-scoped pushes).
R-2/BR-21: adapter methods run only in queued workers (no caller changed;
providers referenced only from services/processors that enqueue or run in
workers).

## 4. Totals (final, all green)

- Backend jest: **251 suites / 3554 tests PASS** — P9 recorded 250/3513,
  so the P10 delta is exactly **+1 suite / +41 tests** (40 new
  `bridge-conformance` + 1 net from the contract split: the
  `resolveCapabilities` static test became static-pair + live-manifest).
- `npx nest build`: **clean** (4 strict-mode literal errors in the new
  stub found and fixed before the final run).
- Prisma: no migration (no schema edit); no drift.
- Admin vitest / storefront suite: **not re-run — untouched** (no admin/
  storefront file changed; `git diff --name-only` shows backend + docs
  only). No regression vector.

## 5. HMAC + replay vectors (no secrets)

Bridge webhook verification is hex HMAC-SHA256 over
`{deliveryId}.{timestamp}.{rawBody}` (`X-EcoMate-Signature`) +
`X-EcoMate-Delivery-Id` + `X-EcoMate-Timestamp` (epoch seconds, 5-min
window) + `X-EcoMate-Topic`; fresh → accept, tampered/wrong-secret →
`bad-signature`, epoch `0` → `stale-timestamp`, missing fields named.
Fixture signing and provider verification share `webhook-crypto.ts`.
Contact-check is the P6-signed read-only endpoint (unchanged); the
manifest's `contactCheckExposure` declares the bridge surfaces it
(BR-14 — exposure, never enforcement).

## 6. Gaps (honest)

- **No live bridge smoke:** no real custom site exists in this
  environment, so connect → push → order-pull → status-push → webhook
  delivery against a production bridge has NOT run. The reference stub
  implements the full wire surface and the adapter speaks only documented
  routes (stub 404s anything else), which is the strongest available
  proof short of a live peer.
- **Engine-level cost to bridges stays informational:** core gates cost
  on *declared* `costPrice: false` (P4, untouched per the no-core-change
  rule), so manifest `costPrice: true` is honored only at the adapter
  payload layer. Wiring engine cost pushes to manifest caps needs a core
  change — deferred, BR-23-safe as-is.
- **Manifest caching:** `resolveCapabilities` fetches the manifest per
  call (correctness first; calls happen in queued workers with per-store
  serialization). If bridge RTT ever dominates sync time, add a short-TTL
  cache — not now (no measurement shows a problem).
- **Variant attributes read-back:** snapshots report `variantAttributes:
  []` (bridge `attributes` are write-accepted; the stub echoes them only
  inside variant objects, not aggregated). Ownership baselines for
  variant attributes on bridges therefore anchor on EcoMate values until
  first push — same posture as Shopify's composed excerpt, documented,
  no silent overwrite (BR-02 holds: drift is detected, never
  auto-resolved).

## 7. Walkthrough (operator-visible)

1. Stores → Connect store → **Custom (Bridge v1)** → bridge endpoint URL
   + bridge key (+ optional webhook secret) → Create → Test connection:
   reachable/auth/permissions + media preflight + capability summary
   with the bridge's real stock fidelity and contact-check exposure.
2. Assign a product → Product Sync pushes the manifest-enabled Table A
   fields (SKU-idempotent, field-scoped) → publication follows
   availability; unsupported surfaces raise capability notices, never
   failures.
3. Stock moves → faithful bridges get `{status}`-only PUTs with read-back;
   `unsupported` bridges get zero writes and audit-only drift issues.
4. A bridge order arrives via webhook (HMAC, deduped) or the hourly 3-day
   pull → normalized → ingested once with `ingestFlags` where applicable.
   Cancel/Delivered pushes the manifest-listed targets with read-back.
5. The bridge's own checkout calls
   `GET /store-bridge/v1/contact-check` (signed) to decide whether to
   prevent an order — EcoMate never enforces on its behalf (BR-14).

## 8. DEFERRED (explicitly NOT in P10)

- Live peer smoke (no custom site available — §6).
- Engine cost-push to manifest-enabled bridges (core change — §6).
- Admin/storefront work (none required — wizard already complete).
