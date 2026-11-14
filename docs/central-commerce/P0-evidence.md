# P0 — Safety Net & Proofs · Evidence Report

Branch: `feature/central-commerce-p0` · Date: 2026-09-25
Plan: `.commandcode/plans/central-commerce-multistore-integration.md`

## Definition of Done (plan §14, P0 row)

| Item | Status | Evidence |
|---|---|---|
| Six raw-body proofs pass and are written down | ✅ | `apps/backend/src/stores/raw-body-proof.spec.ts` — 8/8 green |
| Baselines reproducible | ✅ | below |
| Consistency test reports exactly the six pre-existing mismatches | ✅ | `feature-catalog.spec.ts` — allow-list `admin_campaigns, admin_cms, admin_courier, admin_shipments, admin_import, admin_checkout_leads` |
| `store_webhook` rate-limit policy | ✅ | `rate-limit-policy.store.ts` + spec |
| Self-heal drift check | ✅ | `migrate status`: 119 migrations, "up to date"; `migration-safety.p0.spec.ts` green |
| `SeoMetaAccessor` with key-resolution tests | ✅ | `products/seo-meta.accessor.ts` + spec, 7/7 |

## Files changed

- `packages/shared-types/src/license-types.ts` — 5 new keys (`admin_stores`, `store_product_sync`, `store_order_sync`, `store_stock_sync`, `admin_sync_center`) + `DEPENDENCY_MAP`
- `packages/shared-types/src/__tests__/types.test.ts` — count 80 → 85
- `apps/backend/src/common/rate-limit/rate-limit-policy.store.ts` — `store_webhook` policy (60/min, burst 20/10s, track `ip`)
- `apps/backend/src/common/permissions/feature-catalog.spec.ts` — P0 keys + consistency test
- NEW `apps/backend/src/stores/store-flags.ts` + `store-flags.spec.ts` — fail-closed runtime flags (BR-25)
- NEW `apps/backend/src/stores/raw-body-capture.ts` + `raw-body-proof.spec.ts` — six §8.7 proofs
- NEW `apps/backend/src/products/seo-meta.accessor.ts` + `seo-meta.accessor.spec.ts`
- NEW `apps/backend/src/common/rate-limit/rate-limit-policy.store.spec.ts`
- NEW `apps/backend/src/prisma/migration-safety.p0.spec.ts`

Migrations: none (P0 is additive-code only, no schema change).
API changes: none (no routes added/modified).

## Baselines recorded (P0 entry snapshot)

| Suite | Result |
|---|---|
| backend jest | 222 suites / 3109 tests pass (incl. 6 new P0 suites, 45 new tests) |
| `nest build` | exit 0 |
| admin vitest | 74 files / 737 tests pass |
| admin `tsc --noEmit` | clean |
| storefront tests | 26 files / 285 tests pass |
| storefront `tsc --noEmit` | clean |
| storefront `next build` | success |
| shared-types vitest | 10/10 pass |
| `prisma migrate status` | 119 migrations, up to date, no drift |

(Note: plan §13 cited older totals 1670/308/199 — suites have grown since; the table above is the reproducible P0 baseline.)

## The six raw-body proofs (summary)

1. Adapter: NestJS 11 on `FastifyAdapter({trustProxy:true})`; no `rawBody:true`; no global `application/json` parser swap; only `@fastify/multipart` globally. Route-scoped precedent exists twice: `CsvBodyParser` (content-type parsers) and the better-auth `onRequest` hijack gated on `/api/better-auth/`.
2. Non-webhook JSON byte-identical: same payload object on both paths; `rawBody` present only on `/api/webhooks/stores/*`.
3. Memory: 50 concurrent normal requests, RSS delta < 32 MiB; per-request buffers never shared/retained.
4. Existing verifiers unchanged: RedX HMAC vector over `JSON.stringify` verifies; marketing + courier sources still `JSON.stringify`-based and import nothing from the new module.
5. Oversized → 413, malformed → 400, controller call count 0 in both cases.
6. Maintenance gate: new prefix is an `/api/` POST ⇒ already covered by the `system:backup-maintenance` gate; no new mechanism.

Fallback status: not triggered — proofs (2) and (4) proven directly.

## Walkthrough

P0 adds no user-visible flow. Operator-visible effect is zero by design:
all new code is pure helpers + specs except two catalog/policy
registrations that no controller references yet (reserved for P1).

## Explicitly not satisfied / deferred

- Copy-DB `migrate deploy` + backfill dry run: no migrations and no backfill exist in P0 — first exercised in P1 (Store tables) and P8 (channel backfill).
- Live Shopify dev store (P9 prerequisite): untouched, still external.
- Analytics metric snapshots for P8 dual-read comparison: P8 entry task; current analytics suites pass inside the backend/admin totals above.
