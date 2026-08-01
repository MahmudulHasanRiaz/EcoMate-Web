# Final Deployment Handover — CAPI Tracking Phase 0 + Migration Reconciliation

**Date:** 2026-08-02
**Branch:** merged to `main` at `76c6424c` (feature branch deleted)
**Status:** Ready for production deploy, **pending operator approval + push to `origin/main`**

---

## 1. What changed

| Area | Change | Runtime impact |
|---|---|---|
| **DB schema** | 2 new migrations (below) | Purely additive |
| **Tracking schema** | 6 new tables (`TrackingContext`, `TrackingSnapshot`, `TrackingOutbox`, `TrackingDispatch`, `TrackingDispatchEvent`, `TrackingReplayArchive`) + `Order.trackingSessionId` (nullable) | None — no code reads/writes them yet |
| **Migration reconciliation** | `SecurityEvent`/`SecurityBlockDaily`/`SecurityEventDaily`/`SecurityEventHourly`/`BackupJob` models aligned to the deployed DB (native types, defaults, indexes, constraint names); `BackupJob` primary key added via guarded migration | None (annotation-only) except BackupJob PK |
| **Backend code** | `tracking.constants.ts` (status/event-type constants), `tracking-settings.service.ts` (central settings + gated test codes, fixes D10) | None — additive modules, no dispatch/capture yet |

This is **Phase 0** of the tracking redesign: schema + constants + settings only. No runtime tracking behavior changes.

## 2. Database migrations

| Migration | DDL | Destructive? |
|---|---|---|
| `20260802000000_add_tracking_pipeline` | 6 `CREATE TABLE` + `ALTER TABLE "Order" ADD COLUMN "trackingSessionId" TEXT` (nullable) | No |
| `20260802000001_reconcile_backupjob_primary_key` | Guarded `ADD CONSTRAINT "BackupJob_pkey" PRIMARY KEY ("id")` (skips if exists; raises only on NULL/dup ids) | No |

Verified: fresh DB → `migrate deploy` → `prisma migrate diff` = **"No difference detected"**; recovery migration applied over a live `BackupJob` row → row intact.

## 3. Deployment order

```
1. Backup  → 2. Push/release  → 3. migrate deploy  → 4. deploy app image  → 5. verify
```

**Migrate before app** (both additive; app-before-migrate would be harmless in Phase 0, but migrate-first is the safe documented order).

## 4. Required commands

```bash
# 0. Pre-flight (operator, against production)
cd apps/backend
npx prisma migrate status                      # expect: all applied, none failed, 2 pending
psql "$PROD_DATABASE_URL" -c \
  "SELECT count(*) FROM \"BackupJob\" WHERE id IS NULL; SELECT id, count(*) FROM \"BackupJob\" GROUP BY id HAVING count(*) > 1;"  # expect: 0 / empty

# 1. Backup (MANDATORY)
pg_dump -Fc "$PROD_DATABASE_URL" -f backup_$(date +%Y%m%d_%H%M%S).dump

# 2. Release: push main to origin (operator-approved) + build/release pipeline

# 3. Migrations
cd apps/backend
npx prisma migrate deploy                      # applies the 2 pending migrations

# 4. App image — deploy the backend image built from main@76c6424c

# 5. Post-deploy verification (below)
```

## 5. Rollback procedure

All DDL is additive — rollback is safe and lossless:

```sql
-- Revert tracking migration
DROP TABLE IF EXISTS "TrackingReplayArchive","TrackingDispatchEvent","TrackingDispatch","TrackingOutbox","TrackingSnapshot","TrackingContext";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "trackingSessionId";
-- Revert BackupJob PK
ALTER TABLE "BackupJob" DROP CONSTRAINT IF EXISTS "BackupJob_pkey";
```
Then redeploy the previous backend image. No existing data is affected by any step.

## 6. Post-deployment verification checklist

- [ ] `npx prisma migrate status` → all applied, none failed
- [ ] `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` → **"No difference detected."**
- [ ] `SELECT count(*) FROM pg_constraint WHERE conname='BackupJob_pkey'` → 1
- [ ] 6 `Tracking*` tables exist; `Order.trackingSessionId` column present
- [ ] Backend boots; `/health` OK; existing order create / refund flows unaffected
- [ ] `npm run build --workspace=backend` green; tracking tests 11/11 pass (full suite 756/756 green on merged `main`)

## 7. Manual steps required

1. **Push `main` to `origin/main`** (local `main` is 11 commits ahead of `origin/main`; the deploy source). Not yet pushed — awaiting your approval.
2. Confirm the 3 **PROD-CHECK** items from the safety review:
   - `prisma migrate status` on production matches the chain (no failed).
   - `BackupJob` has no NULL/duplicate `id` rows.
   - Production has no **additional** drift beyond the 14 reconciled items (broader `migrate diff` will confirm; the tracking migration is independent/additive regardless).
3. Run the backup + migrations in a low-traffic window (no downtime required, but standard practice).
4. The **background drift-reconciliation task** you started is now **largely superseded** for migration-history purposes (reconciled + merged to `main`). Its remaining value is fixing the **local dev database** (`ecomate_web`, 5 unapplied migrations) so `prisma migrate dev` works locally again — review/dismiss accordingly.

## 8. Final GO / NO-GO

### **GO** — conditional on the manual steps above.

**Rationale:**
- Zero runtime behavior change (Phase 0 ships no dispatch/capture code).
- Both migrations are purely additive; no data loss, no table rewrites, no required downtime; rollback is lossless.
- Migration chain is now **deterministic** (fresh deploy → "No difference detected") and **data-safe** (recovery verified over live rows).
- Full test suite (756/756) + backend build pass on merged `main`; working tree clean; docs match implementation; no TODOs/dead code.

**Conditions before deploy:**
1. Production DB backup taken.
2. Pre-flight checks (#0) pass.
3. Push to `origin/main` approved.
4. Deploy in a low-traffic window.

**NO-GO triggers:** pre-flight check failures (drift beyond reconciliation, BackupJob id anomalies, failed migrations), backup unavailable, or any of the verification checklist items failing post-deploy.
