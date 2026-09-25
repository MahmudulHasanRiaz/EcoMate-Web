# P6 — Order Ingestion · Evidence

Branch: `feature/central-commerce-p0` · **NOT committed** (per instruction).
Plan: `/Users/riaz/.commandcode/plans/central-commerce-multistore-integration.md`
§8.5 (incl. 8.5.1 blocked-contact, 8.5.2 create contract, 8.5.3 tracking gate,
8.5.4 immutability), §8.7 (webhook receiver), BR-11/12/13/14/15/16/17/24,
§13 order + blocked-ingest + webhook-safety suites, P6 row.
Entry prerequisite P5 satisfied at `f4492267`.

## 1. Migration (ONE, additive only)

- `apps/backend/prisma/migrations/20260925180000_p6_order_ingestion/migration.sql`
  — applied via `migrate deploy` (92-history + 1 new): `Order` gains
  `storeId` (FK `Store`, `ON DELETE SET NULL`), `externalOrderId`,
  `ingestFlags TEXT[] DEFAULT []`, `storeMetadata JSONB`;
  new `StoreOrderMapping` (`@@unique([storeId, externalOrderId])`,
  `orderId @unique`, status mirror columns) and `StoreOrderStatusMap`
  (`@@unique([storeId, externalStatus])`). Zero drops/renames.
- Pre-existing drifts met while migrating (NOT introduced by P6, left
  untouched except where blocking):
  - `20260924070009_backfill…` checksum drift (file edited after local
    apply): re-ran the committed data-only UPDATE on dev DB + synced the
    `_prisma_migrations` checksum to git history. No schema effect.
  - `MarketingFundingLedger.fundingType` TEXT (history) vs enum (schema):
    `migrate diff` also wants unrelated destructive changes (JournalEntry
    drop column, index drops, id defaults) → wrote a P6-ONLY migration file
    by hand instead of `migrate dev`. The fundingType drift is reported,
    not fixed (needs its own migration; production unaffected — applies
    from git history).

## 2. Files

New backend (`apps/backend/src/stores/`):
- `orders/normalize-order.ts` — pure `normalizeOrder()` (WC/Shopify/bridge/
  fixture shapes → canonical; allowlist extraction only),
  `buildStoreDeliveryKey` (sha256(storeId:deliveryId)),
  `buildStoreOrderIdentity` (`store:{storeId}:order:{externalId}` — webhook
  ≡ reconcile identity), `clampReconcileWindow` (3d default / 30d hard max).
- `orders/store-order-ingest.service.ts` — §8.5 worker steps 1–6: mapping
  lookup → status-only reconcile; SKU resolution
  (`StoreSkuMapping` → variant → product → product-less + `UNMATCHED_SKU`
  issue + `mapSku` one-click action); status via `StoreOrderStatusMap`
  seeded from import `STATUS_MAP` (now exported); `ordersService.create`
  with 4th-arg `internal` (arity asserted by test — live-E2E find);
  `OrdersService` resolved via `ModuleRef` (see §7).
- `orders/store-order-reconcile.service.ts` — hourly tick (CONNECTED +
  `autoSyncEnabled`, NATIVE excluded) + `runStore` (3-day window,
  page-capped 20×50, 400 ms inter-page delay, `windowDays`+`wideningReason`
  recorded, at-limit issue).
- `orders/store-order-scheduler.ts` — idempotent hourly repeatable
  `order-reconcile-tick` (`0 * * * *`, Asia/Dhaka).
- `orders/store-orders.controller.ts` — `POST /stores/:id/sku-mappings`,
  `POST /stores/:id/reconcile-orders` (`@RequiresFeature('store_order_sync')`
  — already in catalog; `{runId}` immediate, BR-21).
- `webhooks/store-webhook.service.ts` — verify → dedupe → enqueue → 200;
  generic 401s (unknown/NATIVE/disconnected store, bad sig, missing
  delivery id, stale ts); duplicate delivery bumps counter, no re-enqueue.
- `webhooks/store-webhooks.controller.ts` —
  `POST /webhooks/stores/woocommerce|shopify|custom/:storeKey`
  (`@Public()` + `@RateLimitPolicy('store_webhook')`, no feature key like
  the marketing/courier precedents).
- `webhooks/store-webhook-rawbody.provider.ts` — `HttpAdapterHost`
  registration of the P0 `preParsing` capture (CsvBodyParser precedent);
  NO `main.ts` change for other routes.
- `webhooks/store-bridge.controller.ts` — `GET /store-bridge/v1/contact-check`
  (HMAC `phone.ip.timestamp` + 5-min window, `{blocked, reasons[]}`,
  zero writes, never consulted by ingest — statically asserted).

Modified backend:
- `orders/orders.service.ts` — `create(dto, clientIp?, user?, internal?)`
  (§8.5.2): status override, idempotency passthrough, `allowStockShortfall`
  (validation + reservation sites → flag + `STOCK_SHORTFALL`, never throw),
  3 blocked checks skipped for `ingest==='external_store'` and evaluated
  read-only (`BLOCKED_PHONE/BLOCKED_IP/SUSPENDED_CUSTOMER` + timeline
  notes), `allowProductlessItems`, provenance write (external path only —
  R-1 byte-equality), `skipPurchaseTracking` bypass + policy gates (§8.5.3
  audit: firePurchaseInstant / fireOrderPlacedEvent / lifecycle+refund
  (policy-gated) / `order.created` bus (internal, no CAPI) / marketing
  attribution (internal read-only)).
- `tracking/order-source-policy.ts` — `EXTERNAL_STORE` (idempotencyKey
  `store:` prefix wins first), `tracking_send_external_store_orders`
  default-off (BR-24).
- `stores.module.ts`, `sync/sync.processors.ts` (real ingest + reconcile
  jobs; push stays P7-deferred), `sync/sync-queues.service.ts` (jobId
  `:`→`-` sanitize — BullMQ rejects `:`; also fixes latent P4 jobIds),
  `orders.controller.ts` + `findAll` (`storeId` real; `salesChannelType`
  ONLINE≡WEBSITE / OFFLINE≡¬WEBSITE and `marketingChannel`≡sourcePlatform
  documented approximations; `showroomId` accepted, P8-owned),
  `import/order-import.service.ts` (`STATUS_MAP` exported).

New admin:
- `features/orders/ingest-flag-badges.tsx` (+ test) — neutral informational
  badges (copy asserted to never imply rejection, BR-15).
- `features/orders/api.ts` (`OrderResponse` provenance fields),
  `routes/…/orders/$id.tsx` (ext id + badges),
  `stores/orders-filter-store.ts` + `features/orders/index.tsx` (Source
  filter: All/Native/per-store, server-backed).

## 3. Tests (§13) — all green

Backend full: **241 suites / 3381 tests pass**; `nest build` clean.
P6 suites (6 files, 50 tests):
`normalize-order` 10 (3 provider shapes, fixtures, sanitization, identity,
bounds) · `order-ingest` 10+1 arity (exactly-one across funnels, window,
widening clamp, shortfall, seed-once, failed-webhook recovery) ·
`blocked-ingest` 11 (3 blocked scenarios → flags, native 400s unchanged,
R-1 byte-equality + static contract, BR-13 static, bridge read-only +
auth vectors) · `webhook-safety` 11 (tamper/wrong/truncated/replay/
stale-ts/413/400/disconnected-parity/verifiers-unchanged) ·
`order-immutability` 3 (delta-noted-never-rewritten, fail-closed
transition, P7 mapping mirror) · `tracking-gate` 5 (precedence, natives
unchanged, fail-closed, policy deny + opt-in).
Admin: **78 files / 753 tests pass**, `tsc` clean. Storefront untouched
(no suite run per rules).

## 4. Live E2E (built backend + Postgres + Redis, flags on) — 17/17 PASS

Custom bridge store → signed webhook 201 → exactly one order with
`storeId` + `store:{id}:order:{ext}` + `UNMATCHED_SKU` product-less item;
replay → `duplicate:true`, still one order; tamper → 401; blocked phone →
ingested with `["BLOCKED_PHONE"]`; `?storeId=` filter; disconnect →
webhook 401. Finds fixed live: BullMQ `:` jobId (central sanitize),
worker 3rd-vs-4th-arg `internal` (+ arity test). Env left clean: 0 test
orders (trashed via API), 0 blocks, test store row hard-deleted with its
cascade mappings (script removed).

## 5. Example walkthrough

`POST /api/webhooks/stores/custom/<storeId>` (HMAC `X-EcoMate-Signature`
over `delivery.ts.body`, delivery id + fresh timestamp) → 201
`{received:true, duplicate:false}` → worker normalizes, resolves SKUs,
creates the order (`Confirmed` via seeded `processing→Confirmed` map,
flags if blocked/short) + mapping + run item → operator sees it under
Orders (Source filter) with info badges; `UNMATCHED_SKU` issues map via
`POST /stores/:id/sku-mappings`; hourly reconcile recovers misses.

## 6. Gaps / follow-ups (nothing blocking P6)

- P4 latent: `store-sync:*` jobIds contained `:` (would have failed live
  the same way) — fixed centrally by the P6 sanitizer; P4 suite unaffected.
- `MarketingFundingLedger.fundingType` TEXT-vs-enum drift needs its own
  migration (out of P6 scope; production applies cleanly from history).
- Full channel columns + `showroomId` predicate + channel badge columns
  are P8 (backend params accepted now, documented approximations).
- Cancel/Delivered provider push is P7 (mapping + idempotency ready here).
- Shopify live-store prerequisite (§18 P9 gate) untouched.
