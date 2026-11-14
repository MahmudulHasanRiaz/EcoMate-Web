# P8 — Sales/Marketing Channel Migration · Evidence

Branch: `feature/central-commerce-p0` · **NOT committed** (per instruction).
Plan: `/Users/riaz/.commandcode/plans/central-commerce-multistore-integration.md`
§9 (9.1 model, 9.2 mapping table, 9.3 consumers), BR-18, P8 row.
Entry prerequisite P6 satisfied at `da2f4d0d`; P7 at `c577e80e`.

## 1. Migration (ONE, additive only)

- `apps/backend/prisma/migrations/20260925200000_p8_sales_marketing_channels/migration.sql`
  — `CREATE TYPE SalesChannelType (ONLINE, OFFLINE)`,
  `CREATE TYPE MarketingChannel (FACEBOOK, MESSENGER, INSTAGRAM,
  INSTAGRAM_INBOX, TIKTOK, TIKTOK_INBOX, WHATSAPP, THREADS, OTHER)` (no CALL),
  `ALTER TABLE "Order" ADD COLUMN salesChannelType/showroomId/marketingChannel`
  (all nullable), 3 indexes, FK `Order.showroomId → Warehouse(id) ON DELETE
  SET NULL`. No drops/renames/repurposing; legacy `SalesChannel` enum values
  untouched (no `DROP VALUE` anywhere).
- Applied via `migrate deploy` (126 migrations); `migrate status` = up to date;
  `prisma generate` clean; dev boot self-heal: "all required columns
  verified ✓".
- Drift notes: dev DB carried a stale singleton
  `PhysicalReservation_orderItemId_key` absent from migration history —
  dropped directly (`DROP INDEX IF EXISTS`, Q2 precedent: trust history, no
  migration file). Pre-existing unrelated drift (`MarketingFundingLedger.
  fundingType` TEXT-vs-enum, JournalEntry/AdAccount diffs) left untouched, as
  in P6/P7. One process note: the P0 `migration-safety` suite regex-scans
  migration files including comments, so the migration comment deliberately
  avoids the literal `DROP VALUE` phrase (comment-only; statements unchanged
  after apply).

## 2. Files

New backend (`apps/backend/src/orders/channels/`):
- `channel-resolver.ts` — the SINGLE deterministic `resolveChannels()`
  implementing the FULL §9.2 table + additional rules (CALL/PHONE/DIRECT never
  marketing; `CHAT` + platform → inbox variants incl. legacy `*_CHAT`
  salesChannel strings; canonical enum without CALL; `storeId` never touched;
  showroom returned as a name candidate for service-side FK resolution).
- `channel-flags.ts` — `newSalesChannelModelEnabled()` (`NEW_SALES_CHANNEL_
  MODEL_ENABLED === 'true'`, default off/fail-closed). Dual-write is
  unconditional; only READS branch.
- `channel-backfill.service.ts` — idempotent NULL-only (`salesChannelType IS
  NULL` indexed predicate), chunked cursor pagination (one write per row,
  resumable), session-utm batch lookup per chunk, showroom cache, structured
  `BackfillReport` + progress logs, per-row error capture, `dryRun` mode.
- `__tests__/` — resolver 29, backfill-idempotency 5, analytics-parity 7.

Modified backend:
- `prisma/schema.prisma` — the two enums + three Order columns + `OrderShowroom`
  relation + indexes (see §1).
- `orders/orders.service.ts` — `create()` dual-writes all three writers' shapes
  (storefront/admin/ingest) in the SAME `tx.order.create`: resolver over
  legacy + session utmSource (best-effort, never throws) + showroom (explicit
  `dto.showroomId` validated as a showroom row, else sourceEntity
  name-resolution); `findAll` predicates the REAL columns with the flag on,
  the P6 preview approximations with the flag off (identical reads);
  `findOne`/`findAll` include `showroom { id, name }` (additive).
- `orders/dto/order.dto.ts` — optional `showroomId` (whitelist-safe; R-1
  `statusId` prohibition untouched).
- `orders/orders.controller.ts` — comment update only (params unchanged, §10
  additive).
- `orders/orders.module.ts` — provides/exports `ChannelBackfillService`.
- `pos/pos-orders.service.ts` — dual-write with the REAL session
  `showroomId` FK (not name-resolved) + resolver marketing.
- `checkout-leads/checkout-leads.service.ts` — dual-write (OFFLINE/PHONE/CALL
  defaults → OFFLINE + NULL marketing: a call is an origin, never marketing).
- `business-analytics/analytics-filter.{dto,service}.ts` — 4 additive optional
  filters, honoured ONLY with the flag on (off ⇒ ignored ⇒ identical where).
- `business-analytics/analytics-overview.service.ts` — selects + additive
  `bySalesChannelType`/`byMarketingChannel` breakdowns, flag-gated.
- `business-analytics/analytics-sales.service.ts` — `SalesOrderInput` +
  selects + additive cancellation groupings, flag-gated.
- `business-analytics/analytics-marketing.service.ts` — selects +
  `aggregateSourceRevenue` additive groupings + `getSummary` pass-through,
  flag-gated.
- `business-analytics/analytics-envelope.util.ts` — cache key carries
  `:ch1`/`:ch0` (found live: without this, flag-on/off responses shared cache
  entries and canonical keys leaked across flag states).
- `tracking/meta-action-source.ts` — flag-on canonical-chat short-circuit
  (fixes legacy `TikTok Chat` → `physical_store` fallthrough); flag-off =
  legacy exactly.
- `tracking/order-source-policy.ts` — flag-on canonical `storeId` external
  signal beside the `store:` idempotency marker; off = legacy exactly.
- `tracking/tracking-eligibility-gate.ts` — selects + metadata carry canonical
  columns (policy decides; additive).
- `tracking/monitoring.service.ts` — flag-off = exact pre-P8 inline
  classifier; flag-on = shared policy resolver + `EXTERNAL_STORE` bucket and
  `tracking_send_external_store_orders` eligibility (fail-closed default off).

Admin (`apps/admin/src`):
- `features/orders/order-source.ts` — `MARKETING_CHANNEL_LABELS` (incl. inbox
  variants), `resolveMarketingChannel` (CALL/PHONE/DIRECT/BOGUS → null),
  `resolveSalesChannelType`, `OrderAttribution` + `resolveOrderAttribution`
  extended (canonical badges APPENDED after legacy; legacy-only rows identical).
- `features/orders/api.ts` — `OrderResponse` gains optional
  `salesChannelType/showroomId/showroom/marketingChannel`.
- `features/orders/index.tsx`, `routes/.../orders/$id.tsx` — pass canonical
  fields to badges (additive).
- `features/orders/create.tsx` — sends real `showroomId` when a POS showroom
  is picked (backend validates; name-resolution fallback retained).
- `features/business-analytics/{types,api}.ts` — optional canonical filters +
  query keys; response types gain optional canonical blocks.
- `features/business-analytics/components/AnalyticsFilterBar.tsx` — legacy
  Sales Channel untouched + new Sales Type (ONLINE/OFFLINE) and Marketing
  Channel (canonical 9) selects.
- `features/business-analytics/index.tsx`, `marketing.tsx` — canonical tabs /
  tables rendered ONLY when the backend sends them (flag-off: absent).

POS client: unchanged by design — it keeps writing the legacy channel +
session; the canonical `showroomId` comes from the REAL session FK and every
legacy channel value is resolver-covered (single-resolver rule R-9; no
scattered client conditional).

Storefront: `lib/api/orders.ts` `CreateOrderData` gains optional canonical
fields (normally omitted — backend derives via ChannelResolver from
`salesChannel: 'WEBSITE'` + landing session utm + `sourceEntity`); checkout
payload, `attribution.ts`, `tracking-client.ts` unchanged (raw-signal
collectors by contract).

## 3. Tests (§13) — all green

- Backend full: **245 suites / 3448 pass** (P7 baseline 242/3404 → +3 suites,
  +44 tests: resolver 29 + backfill 5 + parity 7 + filter-canonical 3);
  `nest build` clean; `prisma generate` clean.
- P8 suites: `channel-resolver` 29 (every §9.2 row incl. CALL→NULL marketing,
  CHAT/inbox variants, DIRECT/PHONE never, OTHER fallback, NULL-source
  derivation, EXTERNAL_STORE marker); `channel-backfill` 5 (NULL-only,
  second-apply no-op); `analytics-parity` 7 (flag-off ignores canonical in
  action-source/policy/aggregations/cancellations; flag-on additive).
- Consumer suites updated: `analytics-filter.spec` (F7 `storeId` half
  superseded — P6/P8 made it real; bare-`store` rejection kept + 3
  flag-off/flag-on cases), P0 `migration-safety` (comment reword, §1).
  Existing suites asserting legacy values untouched and green
  (`meta-action-source`, `tracking-gate`, `blocked-ingest` R-1 incl.
  byte-equality, `order-ingest`, `pos`, `checkout-leads` — 212 create-path
  tests pass with dual-write active).
- Admin vitest: **78 files / 766 pass** (baseline 753 → +13 canonical badge
  tests in `order-source.test.ts`); `tsc --noEmit` clean.
- Storefront: **26 files / 285 pass** (untouched suites, still green);
  `tsc --noEmit` clean; `next build` SUCCESS (type-only touch).

## 4. Metric baselines + parity (R-3)

- BEFORE: analytics unit baseline 84/84 (filter/overview/sales/marketing +
  meta-action-source) recorded pre-change.
- AFTER flag-off: full analytics suites green; live `GET
  /business-analytics/overview?preset=last_30_days` legacy breakdowns
  (`bySalesChannel/bySource/byCategory`) are **byte-identical** flag-on vs
  flag-off, and flag-off carries **zero** canonical keys (verified after the
  cache-key fix; before the fix the shared cache entry leaked canonical keys
  across flag states — caught and fixed, §2).

## 5. Backfill run (dev DB, chunked/resumable/observable + dry-run)

- Dry-run (`--dry-run --chunk=200`): scanned 203, would-update 203, 0 errors
  (203 ONLINE, 0 marketing — dev data is 171 NULL-channel + 32 WEBSITE,
  all ECOMMERCE, no sessions/platforms).
- Real run 1: scanned 202 / updated 202 (1 row created concurrently between
  runs); run 2 (resumability): scanned 1 / updated 1; run 3 (idempotency):
  scanned 0 / updated 0. Final at the time: **203/203 typed, 0 errors**.
- Post-verify finding: the repo's own marketing integration suite
  (`campaign-deletion-preservation.integration.spec.ts`) writes `ORD-DP-*`
  orders DIRECTLY via Prisma to the dev DB during every full `jest` run
  (pre-existing behavior — it bypasses `create()`, so no dual-write, and its
  `afterAll` leaves the order rows). The final full-suite run left 4 such
  rows untyped; a fourth backfill run typed them (scanned 4 / updated 4 →
  ONLINE, correct for NULL-channel/ECOMMERCE). Final: **219/219 typed**.
  Not deleted (suite-owned rows, recreated by every full run).
- Runners: `.tmp-e2e/p8-backfill-run.ts` (tsx + pg/PrismaPg adapter),
  `.tmp-e2e/p8-live-e2e.js`, `.tmp-e2e/p8-flagon-verify.js`,
  `.tmp-e2e/p8-overview-flagon.json` (workspace-root only, per the
  watch-restart trap; untracked like P7).

## 6. Live E2E (P8 build, Postgres)

Flag off (`p8-live-e2e.js`, temp showroom + ALWAYS_IN_STOCK product, all
purged): **20/21** —
guest WEBSITE → ONLINE/NULL ✓; admin CALL → OFFLINE/NULL ✓ (call ≠
marketing); admin OFFLINE+CHAT/TIKTOK → TIKTOK_INBOX ✓; admin POS +
showroomId → OFFLINE + real FK ✓; detail exposes `showroom {id,name}` ✓;
Q3 intact (staff blocked-phone 201 + "blocked for storefront ordering"
warning; guest same phone 400; unblocked after) ✓; OFFLINE filter (preview)
matched all 4 created OFFLINE rows ✓; cleanup (orders trashed, product +
showroom hard-deleted, 0 leftovers) ✓. The 1 FAIL is the documented
flag-off preview gap: `marketingChannel=TIKTOK_INBOX` matches 0 rows because
the preview maps it onto legacy `sourcePlatform` (`TIKTOK`) — expected with
the flag off.
Flag on (`p8-flagon-verify.js`, fresh temp artifacts, all purged): **13/13**
— REAL `marketingChannel`/`showroomId`/`salesChannelType` filters find
exactly the created rows (ONLINE excludes OFFLINE) ✓; overview + marketing
summary return legacy blocks PLUS additive `bySalesChannelType` /
`byMarketingChannel` / `salesChannelTypes` / `marketingChannels` ✓.
Backend left running on the P8 build, flag off (default), healthy.
Environment check: 0 `p8*` products/warehouses, 0 live `P8%` orders, test
phone `+8801755555555` inactive (`isActive=false` — unblocked); remaining
`BlockedPhone` rows pre-date P8.

## 7. Gaps / follow-ups (nothing blocking P8)

- Dev data has no platform-attributed/showroom orders, so backfill marketing
  (0) and showroom linkage (0) are proven by unit + live-created rows, not by
  historical rows. First production-copy dry run should confirm non-zero
  coverage before P11.
- `store_webhook` rate-limit / license-catalog additions were not needed: P8
  adds no routes and no `@RequiresFeature` keys (filters are additive query
  params; flag is a runtime env) — consistency suite green unchanged.
- Shopify/Custom richannel values and the Sync Center UI surface are P9/P10/P11.
- Pre-existing unrelated drift (fundingType/JournalEntry, `costingLotId` boot
  warning) untouched.
