-- ReconciliationRun audit records for stock-reconciliation Apply runs
-- (2026-10-30 reconciliation directive §2.8). DDL-only: creates one new
-- table; no existing data is read or written.
CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL,
    "performedBy" TEXT NOT NULL,
    "backupId" TEXT,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReconciliationRun_status_createdAt_idx" ON "ReconciliationRun"("status", "createdAt");
