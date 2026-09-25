# P3 — Distribution & Ownership Model · Evidence Report

Branch: `feature/central-commerce-p0` · Date: 2026-09-25
Commit: uncommitted (this pass — DO NOT COMMIT per instruction)

## DoD (plan §14, P3 row)

| Item | Status | Evidence |
|---|---|---|
| `ProductStoreAssignment` | ✅ | model + migration `20260925150000_p3_distribution_ownership/` — `(storeId,productId)` unique, `source MANUAL\|RULE`, `available` |
| `StoreAvailabilityRule` | ✅ | model + migration — `(storeId,categoryId)` unique, `available`, `inheritFromParent` |
| Resolver + NATIVE short-circuit + write rejection | ✅ | `store-availability.service.ts` pure `resolve()`; NATIVE→global-only; service 400s; bulk `excludedNativeCount` |
| `ProductStoreFieldState` (ownership/baseline/rebase columns) | ✅ | model + migration — `(storeId,productId,field)` unique, `ECOMATE\|EXTERNAL\|CONFLICT`, `baselineHash`, `externalHash`, `ecoMateHashAtRebase`, `evidence PLUGIN\|INFERRED`, `lastPushedAt` |
| Precedence matrix passes | ✅ | `store-availability.service.spec.ts` — 13 tests (global gate, override??rule??default, NATIVE, full 2×2 matrix) |
| Ownership 4-case + first-contact adopt | ✅ | `field-ownership.service.spec.ts` — 9 tests incl. adopt_existing stability + post-adopt PUSH |
| NATIVE never targeted | ✅ | `native-isolation.spec.ts` — registry throws, endpoints 400, bulk excludes, visibility unchanged |
| Assignment OFF/ON → correct intent, zero provider calls | ✅ | `distribution.service.spec.ts` — view resolution; service never imports the registry (no provider calls possible) |
| `Disable all` requires confirmation | ✅ | `confirm === 'DISABLE'` else 400 + UI typed ConfirmDialog; spec asserts wrong/missing confirm 400s |
| Availability UI + bulk actions | ✅ | `/op/products/store-availability` — product search, store matrix (useReactTable), Sheet override editor, bulk ConfirmDialogs |
| Category-rules page | ✅ | `/mon/settings/store-availability` — store facet (?storeId=), rules table, Sheet editor, category tree select |

## Files

Backend `apps/backend/src/stores/distribution/` (new, wired into `StoresModule` — no `app.module.ts` change):
- `store-availability.service.ts` — pure `resolve()` (§8.2 verbatim)
- `field-ownership.service.ts` — pure `evaluate()` + `adoptExisting()` (§8.3; `ecoMateHashAtRebase` anchors eco-change after adopt/rebase)
- `distribution.service.ts` — availability view, MANUAL overrides (null clears), bulk (`>50` → background job + `GET …/bulk/:jobId` status), rules CRUD, nearest-rule resolution
- `distribution.controller.ts` — `GET/PUT /products/:id/store-availability`, `POST …/bulk`, `GET …/bulk/:jobId`, `GET/PUT /store-availability-rules[/:categoryId]`; `@Roles` (reads manager+, writes superadmin|admin) + `@RequiresFeature('admin_stores')` + runtime double-gate 403
- `dto/distribution.dto.ts` — class-validator DTOs (nullable `available` clears the override)
- Specs: `store-availability.service.spec.ts` (13), `field-ownership.service.spec.ts` (9), `distribution.service.spec.ts` (18), `native-isolation.spec.ts` (5)

Admin `apps/admin/src/features/channels/`:
- `distribution-api.ts` + `distribution-api.test.ts` (5 tests: source label, DISABLE confirm, category flatten)
- `distribution-hooks.ts` (`DISTRIBUTION_KEYS`, availability/rules/bulk/job hooks; job polling 1 s while RUNNING)
- `product-availability.tsx`, `availability-rules.tsx`; re-exported from `features/channels/index.tsx`
- Routes: `op/products/store-availability.tsx`, `mon/settings/store-availability/index.tsx`; `routeTree.gen.ts` regenerated via `@tanstack/router-generator` (+46 lines)
- Sidebar: Products → Store Availability (`admin_stores`); Settings → new Catalog group → Store Availability Rules

Schema: `prisma/schema.prisma` (+3 enums, +3 models, +relation fields on Store/Product/Category); migration `20260925150000_p3_distribution_ownership/` (hand-scoped, additive only); `prisma generate` run.

## Test/build results (full verification, this pass)

- backend jest: **229 suites / 3254 tests pass** (P2 baseline 225/3209 + 4 new P3 suites / +45 tests — exact)
- `nest build`: exit 0 · `migrate status`: **121 migrations, up to date** · `prisma generate` run
- admin vitest (browser): **76 files / 747 tests pass** (baseline 75/742 + 1 new file / +5 tests — exact) · `tsc --noEmit` clean
- storefront: untouched (no files changed) — isolation spec asserts the read-path filter is intact
- git: uncommitted on `cae6b3bc` (P2); pre-existing noise untouched (`.commandcode/taste/…/taste.md` modified, `.tmp-e2e/` untracked)

## Interpretation decisions (locked here, binding for P4)

1. **`inheritFromParent` semantics.** Plan text ("child overrides parent unless inheritFromParent = false") is ambiguous against the field name. Locked: `false` = own-value rule (governs its own category, beats ancestors); `true` (schema default) = defers upward / propagates downward. An explicit merchant toggle creates `false` unless stated; updates preserve the stored flag when omitted. Nearest hit wins; cross-category ties fail closed (OFF).
2. **Disable-all confirmation text** = `DISABLE` (exact match).
3. **Bulk background jobs are in-process** (`setImmediate` + status endpoint) — queues land in P4; re-issuing a bulk action is the retry path. P4 migrates these to BullMQ without API change.
4. **`GET /store-availability-rules?storeId=<NATIVE>` returns `[]`** (truthful: NATIVE can hold no rules); all writes 400.
5. **No `@Permissions()` on P3 routes** — follows the stores/products controller precedent; no `manage_stores`-style key exists, and a fabricated key risks guard-deny. RBAC (`@Roles`) + license feature + runtime double-gate all enforced and tested.
6. **Field-state writes belong to P4** (sync engine); P3 owns the shape + pure decision function. No override/resolve endpoints in P3 (P4 owns `/overrides/*` per §10).

## Drift note (repo precedent, cf. P1-evidence)

`migrate dev` was blocked by pre-existing drift (predates P3 — DB-local, git tree shows no migration modification):
- stale singleton `PhysicalReservation_orderItemId_key` (history expects only the composite `(orderItemId,cycleId)`; table **0 rows** — provably empty) → `DROP INDEX IF EXISTS` directly on the DB (Q2 precedent), no migration file.
- old-checksum mismatch on `20260924070009…` (file matches HEAD; record predates P3) → history untouched.
- `migrate diff` pulled unrelated pre-existing drift (JournalEntry/AdAccount/Attendance/Commission/Marketing hunks) → hand-scoped the migration to P3 objects only, applied via `migrate deploy`. `migrate status`: **121 migrations, up to date**.

## Gaps / not in P3 scope

- Sync-engine writes (provider calls, `SyncRun`, override queue, category lifecycle) → P4. `FieldOwnershipService` is wired into `StoresModule` but no caller yet — P4 is its first consumer.
- `>50` bulk uses in-process background work, not BullMQ (see decision 3).
- Storefront suites not re-run (zero files changed there; isolation spec asserts the read path filter is intact).
