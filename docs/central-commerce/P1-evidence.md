# P1 — Store Foundation · Evidence Report

Branch: `feature/central-commerce-p0` · Date: 2026-09-25
Commit: P1 scaffold (this pass)

## DoD (plan §14, P1 row)

| Item | Status | Evidence |
|---|---|---|
| WooCommerce test store connects | ✅ (smoke, FakeProvider-free live API) | connect 201, health probe row written |
| Credentials never returned | ✅ | create/list/detail return no secret fields (smoke asserted) |
| Health probe populates vocabulary | ✅ | `StoreHealthCheck` rows, `HEALTHY/ATTENTION_REQUIRED/ERROR/DISCONNECTED` |
| Duplicate connect → 409 "reconnect to existing" | ✅ | `STORE_ALREADY_EXISTS` payload (smoke asserted) |
| NATIVE guard test passes | ✅ | `provider-registry.spec.ts` — `providerFor(NATIVE)` throws |
| Nothing else changes behaviour | ✅ | full backend 3120/3120, admin 742/742 |

## Files

Backend `apps/backend/src/stores/`: `provider.contract.ts` (§7 verbatim), `base-provider.ts` (loud stubs — P4/P9/P10 own live HTTP), 3 providers (WC `faithful`, Shopify `unsupported` zero-write, bridge manifest defaults), `provider-registry.service.ts` (throws for NATIVE), `store-identity.ts` (pure fingerprint), `dto/stores.dto.ts` (no delete-mode field, BR-09), `stores.service.ts`, `stores.controller.ts` (§10 routes, `admin_stores`, double-gated; sync/webhook routes 501 — P4/P6 own them), `stores.module.ts`; wired in `app.module.ts`.
Migration `20260925143000_p1_store_foundation/`: 3 enums + `Store` (+`identityFingerprint`, `@@unique([kind, domainNormalised])`), `StoreCredential`, `StoreHealthCheck` — additive only.
Admin `features/channels/` + `op/channels/**` routes: Overview, Stores, detail 6-tab shell, connect wizard; later-phase tabs are explicit placeholders.

## Test/build results

backend 224 suites / 3120 tests pass · `nest build` 0 · admin 75 files / 742 tests pass · `tsc` clean · `migrate status`: 120 migrations, up to date · live smoke 15/15, dev DB left clean (0 stores).

## Drift note (repo precedent)

`migrate dev` was blocked by pre-existing drift (stale singleton index, self-heal-created `StoreCredential`, one modified old migration). Empty artifacts dropped, migration hand-scoped to P1 objects via `migrate diff`, applied with `migrate deploy`. Old-checksum mismatch predates P1; history untouched.
