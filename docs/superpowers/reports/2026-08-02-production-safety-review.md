# Production Safety Review — CAPI Tracking Phase 0 + Migration Reconciliation

**Date:** 2026-08-02
**Audit scope:** External production-readiness review of the Phase 0 tracking pipeline (schema, constants, settings service) and the migration-history reconciliation.
**Auditor note:** No access to the live production database; production-specific items are marked **[PROD-CHECK]** for the operator to confirm. Everything else was verified empirically on disposable PostgreSQL databases.

---

## 1. What is being deployed

| Change | Type | Runtime behavior |
|---|---|---|
| `20260802000000_add_tracking_pipeline` | 6 `CREATE TABLE` + `ALTER TABLE "Order" ADD COLUMN "trackingSessionId"` (nullable) | Additive DDL only |
| `20260802000001_reconcile_backupjob_primary_key` | Guarded `ADD CONSTRAINT ... PRIMARY KEY ("id")` on `BackupJob` | Additive DDL only |
| `schema.prisma` model alignments (#1–#13) | Annotation only (`@db.Timestamptz(6)`, `@db.Date`, `@default`, indexes, `map:`) | **No DDL** |
| `tracking.constants.ts`, `tracking-settings.service.ts` | New NestJS modules | **No behavior change** — Phase 0 ships no dispatch/capture code |

Phase 0 intentionally changes **nothing at runtime**: orders, refunds, leads, and the existing Meta/TikTok/GA4 senders are untouched. The new tracking tables are not read or written by any code yet.

## 2. Deployment risks

| Risk | Assessment | Mitigation |
|---|---|---|
| Tracking migration on `Order` (hot table) | `ADD COLUMN ... nullable` is metadata-only in PostgreSQL (no table rewrite). Sub-second `ACCESS EXCLUSIVE` | Low; still deploy in a low-traffic window |
| `BackupJob` PK add | Guarded `DO` block; skips if constraint exists; raises only on NULL/duplicate `id` rows. `id` is `cuid()` (non-null, unique) | **[PROD-CHECK]** confirm `SELECT count(*) FROM "BackupJob" WHERE id IS NULL` = 0 (expected; the migration raises a clear error otherwise) |
| App/client mismatch | `prisma generate` produces a client matching the new models; must ship with the deploy | Deploy app image built from this branch |
| Pre-existing chain drift | Fully reconciled (§3 of the reconciliation report); fresh deploy now reproduces `schema.prisma` exactly | Verified empirically |
| Unknown production migration state | Production `_prisma_migrations` may differ from expectation | **[PROD-CHECK]** run `npx prisma migrate status` on production before deploying; it must report all migrations applied and **no failed**, and show exactly 2 pending |

## 3. Data-loss risk: **NONE**

Both migrations are **purely additive** — no `DROP`, no column/data transforms, no table rewrites, no truncation. Verified:
- Migration diff vs fresh deployed DB: **"No difference detected"** (deterministic).
- Representative rows round-tripped intact on all five touched tables.
- Recovery migration applied over a pre-existing `BackupJob` row: **row intact, PK added**.

## 4. Downtime requirements

**None required.** All DDL is additive; the only lock is the brief `ACCESS EXCLUSIVE` on `Order` (sub-second, no rewrite) and on `BackupJob` while validating the PK (fast on a small table). Recommendation: run `prisma migrate deploy` in a maintenance/low-traffic window as standard practice, but no downtime window is mandated.

## 5. Rollback strategy

`prisma migrate deploy` has no rollback command; recovery is manual and safe because both migrations are additive:

| Step | Command (as superuser) |
|---|---|
| Revert tracking migration | `DROP TABLE IF EXISTS "TrackingReplayArchive","TrackingDispatchEvent","TrackingDispatch","TrackingOutbox","TrackingSnapshot","TrackingContext"; ALTER TABLE "Order" DROP COLUMN IF EXISTS "trackingSessionId";` |
| Revert BackupJob PK | `ALTER TABLE "BackupJob" DROP CONSTRAINT IF EXISTS "BackupJob_pkey";` |
| Revert app | Redeploy the previous backend image (constants/settings services are additive and safe to leave, but reverting the image is cleanest) |

No existing data is affected by any rollback step.

## 6. Backup requirements

- **Mandatory before deploy:** full database backup (e.g., `pg_dump -Fc` or the app's own BackupJob feature) of the production database.
- Prisma migrations are transactional per migration; a failed migration rolls back atomically and `_prisma_migrations` stays consistent, so the backup is the safety net for operator error, not for migration failure.

## 7. Failure scenarios & recovery

| Scenario | Behavior | Recovery |
|---|---|---|
| `migrate deploy` fails on BackupJob PK (NULL/dup ids) | Migration raises a clear exception; deploy stops; nothing partial | Fix the offending rows (backfill/merge ids), then re-run `migrate deploy` |
| Connection drops mid-migration | PG DDL is transactional; the in-flight migration rolls back | Re-run `migrate deploy`; it applies only un-applied migrations |
| `_prisma_migrations` out of sync on production | `migrate deploy` applies only migrations not recorded as applied | Run `prisma migrate status`; if drift is reported, reconcile before deploy |
| App queries new tables before migration | Phase 0 ships **no** code touching the new tables | Order safe either way; documented order is **migrate → app** |
| Concurrent writes during BackupJob PK add | PK add takes a brief `ACCESS EXCLUSIVE` lock | Acceptable on a small table; low-traffic window recommended |

## 8. Post-deployment verification checklist

- [ ] `npx prisma migrate status` → all migrations applied, none failed.
- [ ] `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` → **"No difference detected."**
- [ ] `SELECT count(*) FROM pg_constraint WHERE conname='BackupJob_pkey'` → 1.
- [ ] `SELECT column_name FROM information_schema.columns WHERE table_name='Order' AND column_name='trackingSessionId'` → present.
- [ ] The 6 `Tracking*` tables exist.
- [ ] Backend boots; `/health` OK; existing order create/refund flows unaffected.
- [ ] `npm run build --workspace=backend` green; tracking unit tests (11/11) pass.

## 9. Production compatibility caveats **[PROD-CHECK]**

Verified locally on fresh + data-populated databases. What still needs operator confirmation against the **actual** production database (I have no access):
1. Production `_prisma_migrations` matches the expected chain (run `prisma migrate status`).
2. `BackupJob` has no NULL/duplicate `id` rows (the migration self-guards, but confirm count = 0 first).
3. Production has no **additional** drift beyond the 14 items reconciled (a broader `migrate diff` will reveal this; if additional drift exists, `migrate deploy` of the tracking migration is still safe — it is independent/additive — but the chain should be reconciled in a follow-up).

---

## 10. Recommendation: **GO**

**Conditional GO for production deployment**, subject to:
1. Full DB backup taken first.
2. `prisma migrate status` on production confirms the chain state (no failed migrations, ≤2 pending).
3. BackupJob `id` null/dup check = 0 rows.
4. Deploy order: **backup → `prisma migrate deploy` → deploy app image → post-deploy checklist**.
5. Low-traffic window.

Risk is **LOW**: zero runtime behavior change, purely additive DDL, no data loss, no required downtime, fully reversible rollback, deterministic chain verified on fresh and data-populated databases. The only unknowns are production-environment specifics, covered by the three operator checks above.
