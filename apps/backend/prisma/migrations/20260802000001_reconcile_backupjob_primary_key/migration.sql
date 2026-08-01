-- =============================================================================
-- Recovery migration: ensure BackupJob has its primary key.
--
-- WHY THIS EXISTS
--   The migration that created BackupJob (20260724000002_add_backup_job) did
--   not add a primary key, but the BackupJob model declares `id @id`. The
--   migration chain therefore does not reproduce schema.prisma exactly.
--   All other drift was resolved by aligning models to the deployed database
--   (@db.Timestamptz(6) / @db.Date / @default / index + constraint-name
--   alignment). This is the single remaining additive change.
--
-- SAFETY
--   Pure additive + idempotent. No DROP, no data loss, no table rewrite.
--   Skips when the constraint already exists (healthy servers no-op).
--   Raises a clear error only when existing rows cannot support a primary
--   key (NULL or duplicate ids) so the operator can fix the data first.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'BackupJob_pkey'
      AND conrelid = '"BackupJob"'::regclass
  ) THEN
    IF EXISTS (SELECT 1 FROM "BackupJob" WHERE "id" IS NULL) THEN
      RAISE EXCEPTION 'BackupJob has NULL id rows; cannot add primary key. Review data before retrying.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM (SELECT "id" FROM "BackupJob" GROUP BY "id" HAVING count(*) > 1) dup
    ) THEN
      RAISE EXCEPTION 'BackupJob has duplicate id rows; cannot add primary key. Review data before retrying.';
    END IF;
    ALTER TABLE "BackupJob" ADD CONSTRAINT "BackupJob_pkey" PRIMARY KEY ("id");
  END IF;
END $$;
