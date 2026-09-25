# EcoMate Bridge v1 Protocol (Custom Provider)

Branch: `feature/central-commerce-p0` · plan
`/Users/riaz/.commandcode/plans/central-commerce-multistore-integration.md`
§7 (contract), §7.1 (Custom column), §8.4–§8.7, §8.9, §8.11, P10 row.

This document is the **published contract** a custom site implements so
EcoMate can connect to it using only this spec. The in-repo reference stub
bridge (`apps/backend/src/stores/providers/__tests__/reference-bridge.ts`,
test-only) implements exactly this document, and the conformance suite
(`bridge-conformance.spec.ts`) proves the adapter against it.

Conventions: `{endpoint}` is the bridge base URL entered in the connect
wizard (e.g. `https://store.example.com`, no trailing slash). JSON over
HTTPS. Timestamps are epoch **seconds**. Auth for EcoMate→bridge calls is
`Authorization: Bearer {bridgeKey}`. Auth for bridge→EcoMate webhooks is
HMAC (§2) with the shared webhook secret (entered as the optional webhook
secret in the same wizard step — the wizard flow is unchanged, P10 adds no
new fields).

No secrets appear in this document. All examples use placeholders.

---

## 1. Manifest discovery

```
GET {endpoint}/.well-known/ecomate-bridge
Authorization: Bearer {bridgeKey}
Accept: application/json
```

Success: `200` with:

```json
{
  "bridge": "ecomate-bridge/1.0",
  "storeId": "bridge-store-1",
  "displayName": "Dhaka flagship",
  "capabilities": {
    "products": true,
    "variations": true,
    "variantDelete": true,
    "categories": true,
    "media": true,
    "mediaReuse": true,
    "delete": true,
    "seo": true,
    "costPrice": false,
    "weight": true,
    "dimensions": true,
    "slug": true,
    "orders": true,
    "webhooks": true,
    "orderStatusUpdate": true,
    "orderStatusUpdateTargets": ["cancelled", "completed"],
    "stockStatusFidelity": "faithful",
    "contactCheckExposure": true,
    "combos": false
  },
  "categoryModel": "custom",
  "seoModel": "native",
  "mediaModel": "url-fetch",
  "webhookTopics": ["order.created", "order.updated", "product.updated"],
  "mediaProbeUrl": "https://store.example.com/cdn/probe.jpg"
}
```

Validation rules (enforced by `CustomBridgeProvider`, tested in
conformance):

1. `storeId` (non-empty string) is **required** — it feeds
   `Store.identityFingerprint` (§8.10 duplicate protection). A 200 without
   it is treated as `permissionsOk: false`, never as a connected store.
2. `capabilities` is optional; absent keys fall back to EcoMate's safe
   defaults (products/variations/categories/media/delete/seo/weight/
   dimensions/slug/orders/webhooks/order-status `true`, `variantDelete`
   `true`, `mediaReuse` `true`, `costPrice` `false`, `stockStatusFidelity`
   `"faithful"`, `contactCheckExposure` `true`,
   `orderStatusUpdateTargets` `["cancelled", "completed"]`).
3. **Narrowing only.** A manifest may turn a default-`true` capability to
   `false` (EcoMate then gates that surface: capability-gated skips with an
   explicit reason, never silent writes). A manifest may NOT widen a
   default-`false` capability, **except `costPrice`**, which the manifest
   may enable — cost stays push-only and is never customer-facing (BR-23).
4. **`combos` MUST be `false`.** EcoMate forces `false` even if the
   manifest claims `true`: combos are skipped with an explicit reason and
   never fabricated (BR-22).
5. `orderStatusUpdateTargets` is intersected with the canonical
   `["cancelled", "completed"]`; unknown targets are ignored. A push to an
   unlisted target fails loud (`ORDER_STATUS_TARGET_UNSUPPORTED`), never a
   silent no-op (§8.6).
6. `stockStatusFidelity` is `"faithful"` or `"unsupported"`.
   `"faithful"` means the bridge expresses IN/OUT faithfully via §4
   (status-only, **recommended default**). `"unsupported"` means EcoMate
   performs **zero writes** and runs read-only drift monitoring (BR-08,
   same as Shopify). No quantity, sentinel or placeholder value is ever
   written (BR-06).
7. `categoryModel` ∈ `custom|unsupported` (default `custom`);
   `seoModel` ∈ `native|unsupported` (default `native`);
   `mediaModel` ∈ `url-fetch|binary-upload|unsupported` (default
   `url-fetch`).
8. `webhookTopics` defaults to `["order.created", "order.updated",
   "product.updated"]` when absent.
9. `mediaProbeUrl` (optional) is HEAD-probed during Test Connection; when
   absent the media preflight reports `undefined` (not failure).

HTTP taxonomy for the manifest probe: `401` → reachable but not
authenticated; `403` → authenticated but not permitted; other non-200 →
reachable but not authenticated; network failure → unreachable as data,
never a throw. Missing `baseUrl`/`bridgeKey` → unreachable with zero HTTP
calls.

## 2. Webhook signing (bridge → EcoMate)

Deliveries POST to the URL registered via §6:

```
POST {callbackBaseUrl}/api/webhooks/stores/custom
```

Headers (all required except topic):

```
X-EcoMate-Signature:   hex HMAC-SHA256 over "{deliveryId}.{timestamp}.{rawBody}"
X-EcoMate-Delivery-Id: unique per delivery (e.g. UUID)
X-EcoMate-Timestamp:   epoch seconds
X-EcoMate-Topic:       order.created | order.updated | product.updated
```

The HMAC key is the shared webhook secret. The timestamp must be within
**5 minutes** of EcoMate's clock (replay window). Verification reasons:
`no-secret-configured`, `missing-signature`, `missing-delivery-id`,
`stale-timestamp`, `bad-signature`. Error bodies are generic (never the
secret or the expected signature). `deliveryKey` uniqueness is the
authoritative dedupe; EcoMate answers 200 only after enqueue (§8.5,
BR-11/BR-21).

## 3. Products, variants, media, categories, publication, delete

All calls carry `Authorization: Bearer {bridgeKey}`. All payloads are
§8.11 Table A shapes rendered in bridge vocabulary (names below); fields
the manifest disables are omitted by EcoMate (capability-gated, never
silent). EcoMate never sends quantities, secrets, or cost unless
`costPrice: true` was declared (§1 rule 3).

```
POST   /bridge/v1/products                 create {product}
PUT    /bridge/v1/products/{id}            update {product} (changed fields)
GET    /bridge/v1/products?sku={sku}&limit=1   first-contact lookup (BR-05)
DELETE /bridge/v1/products/{id}            capability-gated (BR-09, hard-delete path only)
POST   /bridge/v1/products/{id}/publication   {state: published|draft} (§8.8)
GET    /bridge/v1/products/{id}/variants?limit=250
POST   /bridge/v1/products/{id}/variants   create variant
PUT    /bridge/v1/variants/{id}            update variant
GET    /bridge/v1/categories?slug={slug}&parent={parentId}
POST   /bridge/v1/categories               {name, slug, parent_id}
PUT    /bridge/v1/categories/{id}          rename / re-parent
GET    /bridge/v1/media?hash={sha256}
POST   /bridge/v1/media                    url-fetch: {src, hash?} → {id} (hash enables reuse)
```

Bridge product shape (create/update accept partials on PUT):

```json
{
  "id": "br-9001",
  "name": "Fixture Tee",
  "short_description": "Short",
  "description": "Full",
  "sku": "SKU-001",
  "price": "250.00",
  "sale_price": null,
  "cost_price": "180.00",
  "weight": 0.5,
  "dimensions": { "length": 1, "width": 2, "height": 3 },
  "slug": "fixture-tee",
  "status": "published",
  "brand": "EcoMate",
  "tags": ["fixture", "tee"],
  "category_ids": ["12"],
  "images": [{ "src": "https://store.example.com/cdn/tee.jpg" }],
  "seo_title": "Tee",
  "seo_description": "Buy the tee",
  "custom_fields": { "material": "cotton" }
}
```

`status` is `published|draft`. `cost_price` is accepted only when the
manifest declares `costPrice: true`, is never returned by GET (push-only,
BR-23), and is never rendered into any customer-facing field.
`custom_fields` keys SHOULD be allowlisted (`material, care, fit, origin,
warranty, purchaseNote, visibility, taxClass, taxStatus`); keys matching
`secret|token|password|api[_-]?key|private` are never sent by EcoMate.
Idempotency is by SKU: a create whose SKU already exists updates in place
(same id, no duplicate). EcoMate sends a combo product **never** — the
adapter throws `COMBO_SKIPPED` before any HTTP call (BR-22).

Categories: lookup by `slug` **within** `parent` precedes create
(duplicate prevention, §8.9); rename PUTs the mapped id (never a second
term); re-parent PUTs `parent_id` — a bridge that cannot re-parent answers
`422 capability_unsupported` and EcoMate records a loud skip (never a
duplicate). `categories: false` in the manifest → EcoMate raises the
`CATEGORY_UNSUPPORTED` notice and product sync proceeds (§8.9).

Media (`media: false` → images omitted, informational row): url-fetch —
EcoMate sends `{src}`; the bridge fetches the bytes. Reuse is by sha256
`hash`: `GET /bridge/v1/media?hash=` first; mapped media is never
re-uploaded (Table B rows 7–8).

Delete (`delete: false` → loud `CAPABILITY_UNSUPPORTED`, EcoMate raises
`MANUAL_ACTION_REQUIRED`, BR-09): unpublish and assignment-OFF move the
remote product to `draft` and are never deletion.

## 4. Stock (status-only)

**Recommended default: faithful status.** The bridge exposes per-product
(and per-variant) availability as status only:

```
GET /bridge/v1/products/{id}/stock              → {"status": "in_stock"}
PUT /bridge/v1/products/{id}/stock              {"status": "in_stock"}
GET /bridge/v1/products/{id}/variants/{vid}/stock
PUT /bridge/v1/products/{id}/variants/{vid}/stock
```

`status` ∈ `in_stock|out_of_stock`. EcoMate's PUT body carries **only**
`{"status"}` — no quantity field exists in this protocol (BR-06). A push
is `SUCCESS` only after a read-back confirms the remote state (§8.4).

When the manifest declares `stockStatusFidelity: "unsupported"`, EcoMate
performs **zero writes**: the PUT endpoints are never called (the adapter
throws before any HTTP write beyond the manifest GET), the daily audit
reads `GET …/stock` and raises `STOCK_DRIFT_MONITOR_ONLY` on mismatch
(BR-08, same path as Shopify).

## 5. Order pull + webhook payloads

```
GET /bridge/v1/orders?since={ISO}&until={ISO}&status={csv}&page={1-based}&page_size={n}
→ {"orders": [Order], "has_more": false}
```

`since`/`until` are inclusive ISO-8601 bounds (the 3-day reconcile window,
BR-10); `page` is 1-based; `page_size` is clamped to 1…100. `status` is an
optional CSV of bridge status strings (passthrough filter). `has_more`
drives pagination; the worker caps pages per BR-10.

Order shape (webhook `order.created`/`order.updated` bodies use the same
object):

```json
{
  "id": "ext-order-1",
  "status": "processing",
  "total": "250.00",
  "currency": "BDT",
  "created_at": "2026-09-20T10:00:00.000Z",
  "updated_at": "2026-09-20T10:05:00.000Z",
  "customer": { "name": "Order One", "phone": "+8801700000001", "email": "one@example.com" },
  "billing": { "phone": "+8801700000001", "email": "one@example.com" },
  "shipping": { "city": "Dhaka", "country": "BD" },
  "line_items": [{ "sku": "SKU-001", "name": "Fixture Tee", "quantity": 1, "price": "250.00" }]
}
```

`line_items[]` with `quantity` is canonical; `items[]` with `qty` is also
accepted (EcoMate's `normalizeOrder` already handles both, plus
`customer{}`/`billing{}` phone/name/email variants — no core change). Every
already-created bridge order is always ingested (BR-13); totals/items are
immutable after ingest (BR-17); tracking dispatch for external orders is
off by default (BR-24).

## 6. Webhook registration (EcoMate → bridge)

```
GET  /bridge/v1/webhooks                 → {"webhooks": [{"topic": "order.created", "url": "…"}]}
POST /bridge/v1/webhooks                 {"url": "…", "topics": ["order.created", …]} → {"ok": true}
```

EcoMate registers the missing canonical topics only (idempotent):
`order.created`, `order.updated`, `product.updated`, with
`url = {callbackBaseUrl}/api/webhooks/stores/custom`. Delivery failures on
the bridge side SHOULD retry locally (durable relay); EcoMate's hourly
reconcile recovers anything missed (BR-11).

## 7. Status push + read-back

```
POST /bridge/v1/orders/{id}/status   {"target": "cancelled"}   → {"ok": true, "status": "cancelled"}
GET  /bridge/v1/orders/{id}          → the §5 order object (read-back verification, read-only)
```

`target` ∈ `cancelled|completed` intersected with the manifest's
`orderStatusUpdateTargets`. Unsupported targets fail loud, idempotent via
`lastPushedStatus`, verified by read-back (§8.6).

## 8. Contact-check (exposure, never enforcement — BR-14)

The custom site calls **EcoMate** during *its own* checkout so it may
prevent an order before creating it. Enforcement is entirely the external
channel's responsibility; EcoMate's ingest path never consults this
endpoint (BR-13).

```
GET /store-bridge/v1/contact-check?storeId={id}&phone={p}&ip={ip}&timestamp={epoch}&signature={hex}
signature = hex HMAC-SHA256 over "{phone}.{ip}.{timestamp}" with the store's webhook secret
→ {"blocked": false, "reasons": []}
```

`reasons` ⊆ `ip_blocked|phone_blocked|account_suspended`. Read-only: no
order, no audit row, no counters. 5-minute replay window; failures are
generic `401 Unauthorized`. The manifest's `contactCheckExposure: true`
(required default) declares the bridge surfaces this flow to its
storefront.

## 9. Error taxonomy

Bridge errors use the envelope `{"error": {"code": "…", "message": "…"}}`.
EcoMate classifies (§8.1) as:

| Bridge `code` / HTTP | EcoMate category | Retryable |
|---|---|---|
| `unauthorized` / 401 | AUTHENTICATION_FAILED | never (store → AUTH_FAILED) |
| `forbidden` / 403 | INVALID_REQUEST (permission) | never |
| `not_found` / 404 | REMOTE_NOT_FOUND (remote-deleted recovery) | never |
| `validation_failed` / 400, 422 | INVALID_REQUEST | never |
| `capability_unsupported` / 422 | INVALID_REQUEST (loud skip, actionable issue) | never |
| `conflict` / 409 | INVALID_REQUEST | never |
| `rate_limited` / 429 | RATE_LIMITED | backs off `[30s, 2m, 10m, 1h, 6h]`, ≤5 attempts |
| `internal` / 408, 5xx | TEMPORARY_FAILURE | backs off, ≤5 attempts → DEAD + issue |
| network failure | TEMPORARY_FAILURE | backs off |

Permanent failures never loop; transient failures become `DEAD` + an
actionable issue after 5 attempts.

## 10. Conformance (proving a custom site)

A custom site runs the documented suite against its own bridge by pointing
the reference harness at it, or self-checks with the in-repo suite:

```bash
cd apps/backend && npx jest bridge-conformance   # reference stub bridge + MockFetch
cd apps/backend && npx jest provider-contract    # multi-provider gate incl. bridge vectors
```

Conformance covers: manifest validation (good / missing-`storeId` /
`combos:true` forced false / narrowing / target intersection),
testConnection taxonomy (200/401/403/500/unreachable/missing-keys/media
preflight), signature vectors (accept / tampered / wrong secret / missing
fields / stale timestamp), order-pull window (inclusive edges, 1-based
pages, `has_more`, status filter), product/variant/category/media/
publication/delete round-trips, status push + read-back, stock status-only
wire shape (`{"status"}` only — a full flow is scanned for
`quantity|inventory_quantity|available` in write bodies), and the
unsupported-fidelity zero-write gate (no PUT/POST beyond the manifest
GET).
