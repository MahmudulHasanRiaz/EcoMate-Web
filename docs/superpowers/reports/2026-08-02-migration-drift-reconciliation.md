# Prisma Migration Drift — Reconciliation Report

**Date:** 2026-08-02
**Status:** Complete — chain is deterministic, recovery migration verified
**Scope:** Pre-existing drift in `SecurityEvent` / `SecurityBlockDaily` / `SecurityEventDaily` / `SecurityEventHourly` / `BackupJob` (unrelated to the tracking pipeline)

---

## 1. Problem

`prisma migrate deploy` of the committed migration chain did **not** reproduce `schema.prisma`. A fresh database built from the 72-migration history differed from the models in 14 places. This meant:

- `migrate dev` would keep demanding drift fixes.
- A new production database built from the chain would be missing schema objects the generated Prisma client expects.
- The chain was not deterministic or repeatable.

## 2. Methodology

1. Built a fresh disposable PostgreSQL database from the full migration chain (`prisma migrate deploy`).
2. Ran `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` to enumerate every difference.
3. Classified each difference as **intentional-in-DB** (the migration deliberately created it, production was built from it) vs **genuine gap** (the chain is missing something the model requires).
4. Per the approved strategy (**production DB is the source of truth unless a difference is a confirmed bug**): aligned models to the deployed database for intentional differences, and created a guarded additive recovery migration for the one genuine gap.
5. Re-verified on a fresh database (deterministic chain) and with representative data (data compatibility).

## 3. Drift inventory & resolution

### 3.1 Aligned models to the deployed database (zero DDL on production)

These differences were **intentional in the database** — the migrations used `timestamptz`/`date` deliberately, production was built from them, and the app already works against them. The models simply did not declare them. Resolution: model annotation (Prisma native types / defaults / indexes / constraint-name mapping). **No production DDL; no data rewrite; no downtime.**

| # | Table / field | Deployed DB | Model had | Model now | Impact |
|---|---|---|---|---|---|
| 1 | `SecurityEvent.timestamp` | `timestamptz` | `DateTime` | `DateTime @db.Timestamptz(6)` | No type change on prod; tz-awareness preserved |
| 2 | `SecurityEvent.createdAt` | `timestamptz` | `DateTime` | `DateTime @db.Timestamptz(6)` | Same |
| 3 | `SecurityEvent.metadata` | `DEFAULT '{}'` | no default | `@default("{}")` | Aligns to existing default; new rows keep the empty-object default |
| 4 | `SecurityBlockDaily.date` | `date` | `DateTime` | `DateTime @db.Date` | Date-only semantics preserved (no time data lost) |
| 5 | `SecurityBlockDaily.updatedAt` | `timestamptz` | `DateTime` | `DateTime @db.Timestamptz(6)` | No type change |
| 6 | `SecurityEventDaily.date` | `date` | `DateTime` | `DateTime @db.Date` | Date-only preserved |
| 7 | `SecurityEventDaily.updatedAt` | `timestamptz` | `DateTime` | `DateTime @db.Timestamptz(6)` | No type change |
| 8 | `SecurityEventDaily` index `(tenant, date)` | exists | absent | added `@@index([tenant, date])` | Index already on prod; model now declares it |
| 9 | `SecurityEventDaily` unique `...categor_key` (63-char truncation) | exists | generated full name | `map:` to existing truncated name | No rename on prod; deterministic |
| 10 | `SecurityEventHourly.bucket` | `timestamptz` | `DateTime` | `DateTime @db.Timestamptz(6)` | No type change |
| 11 | `SecurityEventHourly.updatedAt` | `timestamptz` | `DateTime` | `DateTime @db.Timestamptz(6)` | No type change |
| 12 | `SecurityEventHourly` index `(tenant, bucket)` | exists | absent | added `@@index([tenant, bucket])` | Index already on prod; model now declares it |
| 13 | `SecurityEventHourly` unique `...cate_key` (63-char truncation) | exists | generated full name | `map:` to existing truncated name | No rename on prod; deterministic |

**Why not the alternative:** converting `timestamptz` → `timestamp(3)` and `date` → `timestamp` on production would drop timezone awareness from `SecurityEvent.timestamp`, rewrite hot tables, and lose the date-only intent — a data-semantics regression and downtime risk. The user-approved strategy avoids all of that.

### 3.2 Genuine gap — guarded additive recovery migration

| # | Table | Deployed DB | Model requires | Resolution |
|---|---|---|---|---|
| 14 | `BackupJob` | **no primary key** | `id @id` | `20260802000001_reconcile_backupjob_primary_key/migration.sql` |

The creating migration (`20260724000002_add_backup_job`) omitted the primary key, but a Prisma model must have `@id`. This is the **only** real DDL. The recovery migration:
- **Additive + idempotent**: adds `PRIMARY KEY ("id")` only if it does not already exist (healthy servers no-op).
- **Data-safe**: raises a clear error only if existing rows have NULL or duplicate `id` values (so the operator can fix data first), never drops or rewrites.
- **No table rewrite** — adding a PK on an existing unique column is metadata-only in PostgreSQL.

## 4. Verification (all passed)

| Test | Setup | Result |
|---|---|---|
| **Determinism** | Fresh DB → `migrate deploy` (73 migrations) → `migrate diff` vs `schema.prisma` | ✅ **"No difference detected."** 73/73 migrations applied |
| **Data round-trip** | Insert representative rows into `BackupJob`, `SecurityEvent`, `SecurityBlockDaily`, `SecurityEventDaily`, `SecurityEventHourly` on the reconciled schema | ✅ All rows round-trip; `date` stores `2026-08-02`, `updatedAt` stores `timestamptz +06` |
| **Recovery over live data** | Simulated production pre-recovery (drop PK, mark migration pending, insert a `BackupJob` row) → `migrate deploy` | ✅ Row intact (1), PK `BackupJob_pkey` added |
| **Client + build** | `prisma generate` + `npm run build --workspace=backend` | ✅ No TS errors |

## 5. Production deployment note

- Deploying to production runs **one new migration**: `20260802000001_reconcile_backupjob_primary_key` (BackupJob PK).
- It is additive, idempotent, and data-safe; no column rewrites, no downtime, no data loss.
- The 13 model-alignment items generate **no DDL** — they only change how Prisma maps the already-deployed columns.
- The tracking pipeline migration `20260802000000_add_tracking_pipeline` (6 new tables + `Order.trackingSessionId` nullable) is likewise purely additive.
- Full sequence: `prisma migrate deploy` applies both pending migrations in order.

## 6. Files changed

- `apps/backend/prisma/schema.prisma` — model alignments (#1–#13)
- `apps/backend/prisma/migrations/20260802000001_reconcile_backupjob_primary_key/migration.sql` — BackupJob PK (new)
- `apps/backend/prisma/migrations/20260802000000_add_tracking_pipeline/` — tracking schema (from Phase 0)
