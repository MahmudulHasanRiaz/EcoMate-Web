# Release Validation — Production Deployment + Post-Deployment Checklists

**Date:** 2026-08-02
**For:** Production deployment of CAPI Tracking Phase 0 + migration reconciliation
**Source:** `origin/main` = `4fb2be54` (pushed)
**Supersedes:** the command sections of `2026-08-02-deployment-handover.md` (this document corrects/refines them)

---

## 1. Deployment commands — verified

All commands below were verified for syntax and semantics (equivalent forms executed against disposable PostgreSQL databases in this session). Corrections vs. the handover are marked **★**.

```bash
# ── Pre-flight (run from the backend app directory where DATABASE_URL is exported) ──
export PROD_DATABASE_URL="postgresql://…"          # ★ must be set/exported in this shell or container

npx prisma migrate status
#   EXPECT: all migrations applied, NONE failed, exactly 2 pending, no "drift detected" warning

psql "$PROD_DATABASE_URL" -c \
  "SELECT count(*) FROM \"BackupJob\" WHERE id IS NULL; SELECT id, count(*) FROM \"BackupJob\" GROUP BY id HAVING count(*) > 1;"
#   EXPECT: first query = 0 ; second query = (0 rows)

npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
#   ★ PROD-CHECK #3 made executable. EXPECT output to be EXACTLY:
#     • 6 CREATE TABLE Tracking* (+ their indexes/constraints)
#     • ALTER TABLE "Order" ADD COLUMN "trackingSessionId" TEXT
#     • ALTER TABLE "BackupJob" ADD CONSTRAINT "BackupJob_pkey" PRIMARY KEY ("id")
#   ANY other statement (Security*, other tables/columns) = additional drift → STOP

# ── Backup (MANDATORY, before any change) ──
pg_dump -Fc "$PROD_DATABASE_URL" -f backup_$(date +%Y%m%d_%H%M%S).dump
ls -lh backup_*.dump        # ★ verify the file exists and is non-trivial (not 0 bytes)

# ── Migrations ──
npx prisma migrate deploy  # EXPECT: "All migrations have been successfully applied."
npx prisma migrate status  # ★ add: EXPECT 0 pending, none failed

# ── App image ──
# Build/deploy the backend image from origin/main (4fb2be54). ★ code tip = 4fb2be54 (the
# handover's "main@76c6424c" predates the docs-only commits; code is identical).
```

## 2. Rollback commands — verified + corrected

```sql
-- Revert tracking migration
DROP TABLE IF EXISTS "TrackingReplayArchive","TrackingDispatchEvent","TrackingDispatch","TrackingOutbox","TrackingSnapshot","TrackingContext";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "trackingSessionId";
-- Revert BackupJob PK (optional; harmless to leave)
ALTER TABLE "BackupJob" DROP CONSTRAINT IF EXISTS "BackupJob_pkey";
```
Then redeploy the previous backend image. All steps are lossless.

**★ Critical caveat:** manual rollback does NOT touch `_prisma_migrations`. After rollback, the two migration rows still read "applied", so `prisma migrate deploy` will **skip** them and the dropped objects stay gone. To re-apply later:
```sql
DELETE FROM _prisma_migrations WHERE migration_name IN
  ('20260802000000_add_tracking_pipeline','20260802000001_reconcile_backupjob_primary_key');
-- then re-run `npx prisma migrate deploy`
```
If the reverted migrations are never re-applied, leave the rows as-is (schema simply stays without the new objects).

## 3. Migration safety for an existing production DB — verified

| Migration | Safe? | Evidence |
|---|---|---|
| `20260802000000_add_tracking_pipeline` | Yes | 6 new `CREATE TABLE` + `ADD COLUMN ... TEXT` nullable on `Order` (metadata-only in PG, no rewrite, no data change). Determinism: fresh deploy → `migrate diff` = "No difference detected". |
| `20260802000001_reconcile_backupjob_primary_key` | Yes | Guarded `DO` block: skips if PK exists; raises a clear error only if `BackupJob.id` has NULL/duplicates (deploy stops, operator fixes data first). Verified over a live `BackupJob` row (row intact, PK added). Requires `BackupJob` table to exist — guaranteed by the chain (`20260724000002_add_backup_job`) and confirmed by PROD-CHECK A/C. |

Both are additive + idempotent-ish (recovery self-guards; `migrate deploy` runs each migration once).

## 4. The three PROD-CHECKs — executable

| # | Check | Exact command | Pass condition |
|---|---|---|---|
| A | Migration chain state | `npx prisma migrate status` | All applied, none failed, exactly 2 pending, no drift warning |
| B | `BackupJob` data supports PK | `psql "$PROD_DATABASE_URL" -c "SELECT count(*) FROM \"BackupJob\" WHERE id IS NULL; SELECT id FROM \"BackupJob\" GROUP BY id HAVING count(*) > 1;"` | `0` and `(0 rows)` |
| C | No additional drift | `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` | Output is exactly §1's 3 DDL items and nothing else |

All three are executable by the operator (require production `DATABASE_URL` only). They gate the GO.

---

## Production Deployment Checklist

**Pre-flight (stop on any failure):**
- [ ] `git fetch origin` → `origin/main` = `4fb2be54`
- [ ] PROD-CHECK A: `migrate status` = all applied, none failed, 2 pending, no drift
- [ ] PROD-CHECK B: `BackupJob` id NULL = 0, duplicates = none
- [ ] PROD-CHECK C: pre-deploy diff = exactly the 2 known migrations' DDL only
- [ ] Backup taken (`pg_dump -Fc …`) and file verified non-empty
- [ ] Low-traffic window confirmed

**Deploy:**
- [ ] Build backend image from `origin/main` (`4fb2be54`)
- [ ] `npx prisma migrate deploy` → "All migrations have been successfully applied"
- [ ] `npx prisma migrate status` → 0 pending, none failed
- [ ] Deploy backend image
- [ ] Run Post-Deployment Validation (below)

---

## Post-Deployment Validation Checklist

- [ ] `npx prisma migrate status` → 0 pending, all applied, none failed
- [ ] `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` → **"No difference detected."**
- [ ] `SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'Tracking%';` → 6 tables
- [ ] `SELECT conname FROM pg_constraint WHERE conrelid='"BackupJob"'::regclass AND contype='p';` → `BackupJob_pkey`
- [ ] `SELECT column_name FROM information_schema.columns WHERE table_name='Order' AND column_name='trackingSessionId';` → present
- [ ] Backend `/health` OK; no new errors in app logs
- [ ] Smoke test (staging/test env): create an order, change status, refund → no errors
- [ ] Spot-check a `BackupJob` row is still queryable

---

## Immediate rollback triggers

Roll back (Section 2) **immediately** if any of:

1. `prisma migrate deploy` fails — especially the BackupJob PK `RAISE EXCEPTION` (NULL/dup ids) → stop, fix data, then re-deploy or roll back.
2. PROD-CHECK C reveals drift beyond the 2 known migrations → do not deploy; reconcile first.
3. `migrate status` after deploy shows drift or a failed migration.
4. Post-deploy `migrate diff` ≠ "No difference detected".
5. Backend fails to boot / `/health` fails / order create–refund regresses after the app deploy.
6. Unexpected long lock or timeout during migration (operator judgment).
7. No valid backup (backup file missing/empty) — deploy must not start.

---

## 5. Known blockers before production deployment: **NONE**

Confirmed:
- Code merged + pushed (`origin/main` = `4fb2be54`); feature branch deleted; working tree clean.
- Full backend suite 756/756 + build green on merged `main`.
- Migration chain deterministic (fresh deploy → no diff); both migrations additive + data-safe (verified over live rows).
- No pending implementation changes; no TODOs/dead code.

Not blockers (documented, unrelated or operator-gated):
- The 3 PROD-CHECKs require production access (operator-side) — they are **pre-flight gates**, not defects.
- GitHub dependabot high vulnerability = pre-existing, unrelated to this deploy (separate remediation).
- Background drift-reconciliation task = superseded for migration history (done + merged); only fixes the local dev DB.
- The `_prisma_migrations` rollback caveat (§2) is now documented, not a blocker.

**Verdict: GO** — deploy per the Production Deployment Checklist, subject only to the pre-flight gates passing.
