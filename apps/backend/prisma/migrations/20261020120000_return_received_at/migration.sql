-- Return.receivedAt: first transition into RECEIVED-or-later.
-- Event date for analytics deductions (item-level partial returns). Never
-- derived from mutable updatedAt. Existing restocked rows are backfilled from
-- the durable stock-restore timestamp.
ALTER TABLE "Return" ADD COLUMN "receivedAt" TIMESTAMP(3);

UPDATE "Return"
SET "receivedAt" = "stockReconciledAt"
WHERE "stockReconciledAt" IS NOT NULL
  AND "receivedAt" IS NULL;
