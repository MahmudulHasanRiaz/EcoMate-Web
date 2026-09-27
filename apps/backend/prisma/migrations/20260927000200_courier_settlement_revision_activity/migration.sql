-- Courier Settlement — revision/supersession fields (§14) + activity actions (§5/§14.3).
-- Purely additive: three nullable columns on CourierSettlementRow + indexes, and
-- four new enum values on CourierSettlementActivityAction.

-- AlterEnum: append revision/activity lifecycle actions (additive, no value removed)
ALTER TYPE "CourierSettlementActivityAction" ADD VALUE IF NOT EXISTS 'ACCOUNTING_REPAIRED';
ALTER TYPE "CourierSettlementActivityAction" ADD VALUE IF NOT EXISTS 'REVISION_LINKED';
ALTER TYPE "CourierSettlementActivityAction" ADD VALUE IF NOT EXISTS 'ACKNOWLEDGED';
ALTER TYPE "CourierSettlementActivityAction" ADD VALUE IF NOT EXISTS 'DISCARDED';

-- AlterTable: row supersession (§14.1) — nullable, no default, non-destructive
ALTER TABLE "CourierSettlementRow" ADD COLUMN "supersededByRowId" TEXT;
ALTER TABLE "CourierSettlementRow" ADD COLUMN "supersededByInvoiceId" TEXT;
ALTER TABLE "CourierSettlementRow" ADD COLUMN "supersededAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "CourierSettlementRow_supersededByRowId_idx" ON "CourierSettlementRow"("supersededByRowId");
CREATE INDEX "CourierSettlementRow_supersededByInvoiceId_idx" ON "CourierSettlementRow"("supersededByInvoiceId");