# Backup System — Design Spec

## Overview

Full backup/restore system for EcoMate admin app at `/mon/backup/`. Supports manual and scheduled backups, database-only or database+content files, local or R2 storage, and restore from existing or uploaded backup files.

## Architecture

Monolithic NestJS module (`apps/backend/src/backup/`) using existing BullMQ queue pattern. Storage via existing `StorageService` (local disk or Cloudflare R2). Config via existing `SystemSetting` key-value table. Frontend in `apps/admin/src/features/backup/` with TanStack Router routes under `_authenticated/mon/backup/`.

## Prisma Schema

### BackupJob

```prisma
model BackupJob {
  id            String    @id @default(cuid())
  type          String    // manual | scheduled
  scope         String    // db_only | db_files
  status        String    // pending | running | completed | failed | restoring
  fileKey       String?   // storage path: backups/{id}/{filename}
  fileSize      BigInt?   // total backup file size in bytes
  checksum      String?   // SHA-256 hex
  dbDumpSize    BigInt?   // raw SQL dump size before compression
  filesSize     BigInt?   // content archive size (null if db_only)
  locked        Boolean   @default(false)
  errorMessage  String?
  startedAt     DateTime?
  completedAt   DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}
```

### Configuration

Stored in existing `SystemSetting` table as key-value pairs:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `backup_schedule_enabled` | boolean | `false` | Enable automatic backups |
| `backup_schedule_cron` | string | `0 2 * * *` | Cron expression (default 2am daily) |
| `backup_default_scope` | string | `db_only` | `db_only` or `db_files` |
| `backup_retention_daily` | number | `7` | Max daily backups to retain |
| `backup_retention_weekly` | number | `4` | Max weekly backups |
| `backup_retention_monthly` | number | `3` | Max monthly backups |
| `backup_retention_yearly` | number | `1` | Max yearly backups |
| `backup_max_total` | number | `30` | Absolute max backup count |
| `backup_include_paths` | json | `["uploads"]` | File paths to include with db_files scope |
| `backup_restore_auto_backup` | boolean | `true` | Auto-backup before restore |

## Data Flow

### Manual Backup

1. `POST /v1/backup` → creates BackupJob (status: `pending`) → adds BullMQ job
2. `BackupJobProcessor` picks up:
   - status → `running`, startedAt → now
   - `pg_dump --no-owner --no-acl --clean dbname` → gzip → `.sql.gz`
   - If scope=db_files: `tar -czf` with SQL dump + configured paths
   - Compute SHA-256 checksum
   - Upload to `StorageService` at `backups/{id}/{filename}`
   - status → `completed`, fileSize/checksum/dbDumpSize set
3. On failure: status → `failed`, errorMessage set

### Scheduled Backup

1. BullMQ repeatable job fires at configured cron expression
2. Same `BackupJobProcessor` runs with `type: "scheduled"`
3. Auto-cleanup runs after completion

### Auto-Cleanup Retention

Runs after each completed scheduled backup:
1. Fetch all `completed` backups ordered by newest
2. Group by age bucket using completion date:
   - Today-7days → daily bucket (keep N daily)
   - 8-31 days → weekly bucket (rest are weekly, keep N weekly)
   - 32-365 days → monthly bucket (keep N monthly)
   - 366+ → yearly bucket (keep N yearly)
3. Skip locked backups and pending/running ones
4. Oldest beyond retention → delete (storage + DB record)
5. Enforce `backup_max_total` ceiling (delete oldest regardless of bucket)
6. Log deletions to SecurityEvent

### Restore Flow

**From existing backup (`POST /v1/backup/:id/restore`):**
1. Auto-create safety backup (if enabled)
2. Validate no other restore in progress → status conflict
3. Download backup file from storage via StorageService
4. Decompress → if tar.gz, extract SQL dump
5. Run `psql -c "SELECT pg_terminate_backend(...)"` to kill connections
6. `psql < dump.sql` to restore
7. If db_files scope: extract archive contents to restore file paths
8. Log via SecurityEvent
9. Re-enable app (good to have toggle for maintenance mode)

**From uploaded file (`POST /v1/backup/restore/upload`):**
1. Accept multipart upload (validated .sql.gz or .tar.gz, max 5GB)
2. Save to temp dir, verify gzip/tar header + checksum
3. Same restore pipeline as above
4. Delete temp file after

## API Endpoints

All under `/v1/backup`:

| Method | Path | Description |
|--------|------|-------------|
| GET | /v1/backup | Paginated backup list (query: page, limit, search, type, scope, status) |
| POST | /v1/backup | Trigger manual backup (body: {scope, type: "manual"}) |
| GET | /v1/backup/:id | Backup detail |
| GET | /v1/backup/:id/download | Stream file download |
| POST | /v1/backup/:id/restore | Restore from existing backup |
| POST | /v1/backup/restore/upload | Upload file and restore |
| PATCH | /v1/backup/:id/lock | Toggle lock (body: {locked: boolean}) |
| DELETE | /v1/backup/:id | Delete backup (file + record) |
| GET | /v1/backup/settings | Get backup configuration |
| PUT | /v1/backup/settings | Update backup configuration |

## Backend Structure

```
apps/backend/src/backup/
├── backup.module.ts
├── backup.controller.ts       — REST endpoints
├── backup.service.ts          — pg_dump/psql orchestration, cleanup, settings
├── backup-job.processor.ts    — BullMQ job processor
├── backup-job.constant.ts     — queue name, job names
├── dto/
│   ├── create-backup.dto.ts
│   ├── restore-backup.dto.ts
│   └── update-settings.dto.ts
└── interfaces/
    └── backup.interface.ts
```

### Services

**BackupService:**
- `createBackup(type, scope)` — creates DB record, enqueues job
- `runBackupPipeline(job)` — pg_dump → compress → checksum → upload
- `runRestore(backupId, uploadedFile?)` — download/read → decompress → psql → file restore
- `performCleanup()` — retention logic
- `getSettings()` / `updateSettings(dto)` — SystemSetting CRUD
- `listBackups(page, limit, filters)` — paginated query
- `downloadBackup(id)` — stream from storage

**BackupJobProcessor (BullMQWorkerHost):**
- `process(job)` — receives BullMQ job, delegates to `BackupService.runBackupPipeline()`

## Queue Configuration

- Queue name: `backup`
- Concurrent jobs: 1 (prevent overlapping backup operations)
- Job attempts: 3 with exponential backoff (2s, 4s, 8s)
- Repeatable job: registered on module init based on scheduler settings

## Frontend Structure

```
apps/admin/src/
├── features/backup/
│   ├── components/
│   │   ├── BackupTable.tsx           — paginated table, status badges
│   │   ├── BackupActions.tsx         — download/restore/lock/delete per row
│   │   ├── RunBackupDialog.tsx       — scope selector + trigger
│   │   ├── RestoreConfirmDialog.tsx  — confirm with "RESTORE" input
│   │   ├── UploadRestoreDialog.tsx   — file picker + restore
│   │   ├── BackupSettingsForm.tsx    — schedule/retention/paths form
│   │   └── BackupStats.tsx           — summary cards
│   ├── hooks.ts                      — React Query hooks
│   ├── backup-index.tsx              — list + actions + dialogs
│   └── backup-settings.tsx           — settings form
└── routes/_authenticated/mon/backup/
    ├── index.tsx                     → backup-index.tsx
    └── settings.tsx                  → backup-settings.tsx
```

### React Query Hooks

- `useBackups(filters)` — GET /v1/backup (paginated)
- `useBackup(id)` — GET /v1/backup/:id
- `useTriggerBackup()` — POST /v1/backup mutation
- `useRestoreBackup()` — POST /v1/backup/:id/restore mutation
- `useRestoreUpload()` — POST /v1/backup/restore/upload mutation
- `useToggleLock()` — PATCH /v1/backup/:id/lock mutation
- `useDeleteBackup()` — DELETE /v1/backup/:id mutation
- `useBackupSettings()` — GET /v1/backup/settings
- `useUpdateSettings()` — PUT /v1/backup/settings mutation

## Error Handling

- pg_dump/psql timeout: 30 min default (configurable)
- Shell execution: `execFile` (no shell injection), stderr captured
- Partial failure: db dump succeeds but files fail → still save db-only backup
- Temp file cleanup in `finally` blocks
- Concurrent restore: `status` field lock (no restore if any backup in `restoring` status)
- File upload validation: header magic bytes, extension, max 5GB

## Security

- Postgres credentials via `PGPASSWORD` env var (never command arg)
- All endpoints behind admin auth guard
- Restore requires explicit "RESTORE" typed confirmation in UI
- Audit trail via `SecurityEvent` for all destructive operations
- Deletion requires confirmation
- No sensitive data exposure in responses

## Testing Strategy

**Backend:**
- Unit: `BackupService` with mocked `execFile`, `StorageService`
- Unit: retention/cleanup logic with sample BackupJob array
- E2E: full backup → restore cycle (if DB available in CI)

**Frontend:**
- Component: render states (empty, loading, error, populated)
- Integration: mutation flows with MSW

## Future Considerations (Not in Scope)

- Incremental backups (only changed files)
- Backup encryption (client-side before upload)
- Backup health check / periodic verification
- Multi-region storage replication
