-- Courier Settlement scalability + rule governance pass (§11/§12/§14/§15/§16/§17):
-- background-import progress columns, finance-rule versioning, and the query-
-- pattern indexes identified in the N+1/index audit.

-- AlterTable
ALTER TABLE "CourierSettlementFinanceRule" ADD COLUMN     "note" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "CourierSettlementInvoice" ADD COLUMN     "importProgress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "importStage" TEXT;

-- CreateTable
CREATE TABLE "CourierSettlementFinanceRuleVersion" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierSettlementFinanceRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourierSettlementFinanceRuleVersion_ruleId_idx" ON "CourierSettlementFinanceRuleVersion"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementFinanceRuleVersion_ruleId_version_key" ON "CourierSettlementFinanceRuleVersion"("ruleId", "version");

-- CreateIndex
CREATE INDEX "CourierSettlementActivity_invoiceId_timestamp_idx" ON "CourierSettlementActivity"("invoiceId", "timestamp");

-- CreateIndex
CREATE INDEX "CourierSettlementColumnAlias_courier_field_idx" ON "CourierSettlementColumnAlias"("courier", "field");

-- CreateIndex
CREATE INDEX "CourierSettlementException_invoiceId_createdAt_idx" ON "CourierSettlementException"("invoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "CourierSettlementException_severity_status_idx" ON "CourierSettlementException"("severity", "status");

-- CreateIndex
CREATE INDEX "CourierSettlementInvoice_fileSha256_idx" ON "CourierSettlementInvoice"("fileSha256");

-- CreateIndex
CREATE INDEX "CourierSettlementInvoice_createdAt_idx" ON "CourierSettlementInvoice"("createdAt");

-- CreateIndex
CREATE INDEX "CourierSettlementInvoice_state_createdAt_idx" ON "CourierSettlementInvoice"("state", "createdAt");

-- CreateIndex
CREATE INDEX "CourierSettlementRow_rowClass_supersededByRowId_idx" ON "CourierSettlementRow"("rowClass", "supersededByRowId");

-- CreateIndex
CREATE INDEX "CourierSettlementRow_invoiceId_matchMethod_idx" ON "CourierSettlementRow"("invoiceId", "matchMethod");

-- CreateIndex
CREATE INDEX "CourierSettlementRow_supersededAt_idx" ON "CourierSettlementRow"("supersededAt");

-- CreateIndex
CREATE INDEX "Dispatch_consignmentId_idx" ON "Dispatch"("consignmentId");

-- CreateIndex
CREATE INDEX "Dispatch_trackingCode_idx" ON "Dispatch"("trackingCode");

-- AddForeignKey
ALTER TABLE "CourierSettlementFinanceRuleVersion" ADD CONSTRAINT "CourierSettlementFinanceRuleVersion_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CourierSettlementFinanceRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
