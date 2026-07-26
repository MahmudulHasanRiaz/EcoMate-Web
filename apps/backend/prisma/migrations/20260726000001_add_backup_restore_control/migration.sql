-- This control plane intentionally lives outside `public`.
-- Backup dumps exclude it so a historical restore cannot erase the only
-- durable record that tells crash recovery whether the database committed.
CREATE SCHEMA IF NOT EXISTS "ecomate_control";

REVOKE ALL ON SCHEMA "ecomate_control" FROM PUBLIC;

CREATE TABLE IF NOT EXISTS "ecomate_control"."backup_restore_operation" (
    "operation_id" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "execution_role" TEXT,
    "source_snapshot" JSONB,
    "catalog_snapshots" JSONB NOT NULL DEFAULT '[]'::JSONB,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "backup_restore_operation_pkey" PRIMARY KEY ("operation_id"),
    CONSTRAINT "backup_restore_operation_phase_check"
        CHECK ("phase" IN ('preparing', 'database_committed', 'failed_after_commit'))
);

REVOKE ALL ON TABLE "ecomate_control"."backup_restore_operation" FROM PUBLIC;
