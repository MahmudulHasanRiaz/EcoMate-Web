-- Courier Settlement & Invoice Management (PRD §5–§14) — Phase 1 schema.
-- Purely additive: new enums + tables + indexes + FKs for the courier settlement
-- domain. No ALTER TABLE on existing tables: Order.shippingCostSource and the
-- JournalEntry courierSettlementInvoice relation are both already present / implicit.
-- The pre-existing drift between schema.prisma and earlier migration files (e.g. the
-- central-commerce P0 JournalEntry/Order changes) is intentionally NOT bundled here.

-- CreateEnum
CREATE TYPE "CourierSettlementInvoiceState" AS ENUM ('UPLOADED', 'ANALYZED', 'MAPPING_REQUIRED', 'IMPORTING', 'READY_FOR_REVIEW', 'REVIEW_REQUIRED', 'ISSUE_FOUND', 'FINALIZING', 'FINALIZED_PENDING_ACCOUNTING', 'ACCOUNTING_POSTED', 'ACCOUNTING_SKIPPED_ACCOUNTING_DISABLED', 'ACCOUNTING_FAILED', 'DISCARDED', 'SUPERSEDED_BY_REVISION');

-- CreateEnum
CREATE TYPE "CourierSettlementRowClass" AS ENUM ('DATA', 'SUMMARY', 'FOOTER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CourierSettlementRowKind" AS ENUM ('DELIVERY', 'RETURN', 'FEE_ONLY', 'BILLING_ONLY', 'ADJUSTMENT', 'SUMMARY', 'FOOTER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CourierSettlementMatchMethod" AS ENUM ('BY_CONSIGNMENT', 'BY_TRACKING', 'BY_ORDER_DISPLAYID', 'BY_ORDER_EXTERNALID', 'BY_ORDER_CUSTOMER', 'MANUAL', 'NONE');

-- CreateEnum
CREATE TYPE "CourierSettlementAccountingStatus" AS ENUM ('PENDING', 'POSTED', 'SKIPPED_ACCOUNTING_DISABLED', 'FAILED');

-- CreateEnum
CREATE TYPE "CourierSettlementActivityAction" AS ENUM ('IMPORTED', 'MAPPED', 'MATCHED', 'FINALIZED', 'SNAPSHOT_TAKEN', 'POSTED_ACCOUNTING', 'ADJUSTED', 'REVISED', 'SUPERSEDED_BY_REVISION', 'EFFECTIVE_STATE_CHANGED');

-- CreateEnum
CREATE TYPE "CourierSettlementAliasOrigin" AS ENUM ('SYSTEM', 'LEARNED', 'MANUAL');

-- CreateTable
CREATE TABLE "CourierSettlementInvoice" (
    "id" TEXT NOT NULL,
    "displayId" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "provider" TEXT,
    "invoiceNo" TEXT,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "fileStorageId" TEXT,
    "fileOriginalName" TEXT,
    "fileSha256" TEXT,
    "fileMime" TEXT,
    "fileSize" INTEGER,
    "rawTotals" JSONB,
    "effectiveTotals" JSONB,
    "isRevision" BOOLEAN NOT NULL DEFAULT false,
    "revisionOfId" TEXT,
    "supersedesInvoiceId" TEXT,
    "state" "CourierSettlementInvoiceState" NOT NULL DEFAULT 'UPLOADED',
    "finalizingToken" TEXT,
    "finalizingStartedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "finalizedBy" TEXT,
    "journalEntryId" TEXT,
    "accountingStatus" "CourierSettlementAccountingStatus" NOT NULL DEFAULT 'PENDING',
    "accountingError" TEXT,
    "accountingAttemptedAt" TIMESTAMP(3),
    "accountingAttemptedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierSettlementInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierSettlementRow" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rowClass" "CourierSettlementRowClass" NOT NULL,
    "rowKind" "CourierSettlementRowKind" NOT NULL,
    "consignmentId" TEXT,
    "orderId" TEXT,
    "dispatchId" TEXT,
    "identifier" TEXT,
    "declaredCollected" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "declaredCharges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "declaredNet" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "declaredResidual" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "effectiveCollected" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "effectiveCharges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "effectiveNet" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "effectiveResidual" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "matchMethod" TEXT NOT NULL,
    "matchedAt" TIMESTAMP(3),
    "matchContext" JSONB,
    "rawJson" JSONB,
    "normalized" JSONB,
    "hasAdjustment" BOOLEAN NOT NULL DEFAULT false,
    "reviewState" TEXT NOT NULL DEFAULT 'green',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierSettlementRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierSettlementException" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "rowId" TEXT,
    "orderId" TEXT,
    "dispatchId" TEXT,
    "ruleId" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'yellow',
    "status" TEXT NOT NULL DEFAULT 'open',
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT,
    "context" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierSettlementException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierSettlementAdjustment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "rowId" TEXT,
    "orderId" TEXT,
    "adjustmentClass" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "originalValue" TEXT,
    "adjustedValue" TEXT,
    "difference" DECIMAL(14,2),
    "reason" TEXT,
    "counterpart" TEXT,
    "userId" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversalOfId" TEXT,
    "reversedById" TEXT,

    CONSTRAINT "CourierSettlementAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierSettlementActivity" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "action" "CourierSettlementActivityAction" NOT NULL,
    "actor" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detail" JSONB,
    "dedupeKey" TEXT,

    CONSTRAINT "CourierSettlementActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierSettlementColumnAlias" (
    "id" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "sourceHeader" TEXT NOT NULL,
    "normalizedHeader" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "confidence" DECIMAL(5,2) NOT NULL DEFAULT 0.0,
    "origin" "CourierSettlementAliasOrigin" NOT NULL DEFAULT 'LEARNED',
    "ambiguityCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierSettlementColumnAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierSettlementFinalizationSnapshot" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "takenById" TEXT,
    "journalEntryId" TEXT,
    "reason" TEXT,
    "totals" JSONB NOT NULL,
    "rows" JSONB NOT NULL,

    CONSTRAINT "CourierSettlementFinalizationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierSettlementFinanceRule" (
    "id" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "format" TEXT,
    "netRule" TEXT NOT NULL,
    "chargeComponents" JSONB NOT NULL,
    "residualThreshold" DECIMAL(12,2) NOT NULL DEFAULT 100.0,
    "tolerance" DECIMAL(12,2) NOT NULL DEFAULT 1.0,
    "identifierOrder" JSONB NOT NULL,
    "isPrecedence" INTEGER NOT NULL DEFAULT 0,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierSettlementFinanceRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementInvoice_displayId_key" ON "CourierSettlementInvoice"("displayId");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementInvoice_journalEntryId_key" ON "CourierSettlementInvoice"("journalEntryId");

-- CreateIndex
CREATE INDEX "CourierSettlementInvoice_state_idx" ON "CourierSettlementInvoice"("state");

-- CreateIndex
CREATE INDEX "CourierSettlementInvoice_courier_idx" ON "CourierSettlementInvoice"("courier");

-- CreateIndex
CREATE INDEX "CourierSettlementInvoice_finalizedAt_idx" ON "CourierSettlementInvoice"("finalizedAt");

-- CreateIndex (displayId already unique above; this index is a no-op-safe covering
-- hint — kept because the schema.prisma @@index regenerates it)
CREATE INDEX "CourierSettlementInvoice_displayId_idx" ON "CourierSettlementInvoice"("displayId");

-- CreateIndex
CREATE INDEX "CourierSettlementRow_invoiceId_idx" ON "CourierSettlementRow"("invoiceId");

-- CreateIndex
CREATE INDEX "CourierSettlementRow_orderId_idx" ON "CourierSettlementRow"("orderId");

-- CreateIndex
CREATE INDEX "CourierSettlementRow_consignmentId_idx" ON "CourierSettlementRow"("consignmentId");

-- CreateIndex
CREATE INDEX "CourierSettlementRow_reviewState_idx" ON "CourierSettlementRow"("reviewState");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementRow_invoiceId_rowNumber_key" ON "CourierSettlementRow"("invoiceId", "rowNumber");

-- CreateIndex
CREATE INDEX "CourierSettlementException_invoiceId_idx" ON "CourierSettlementException"("invoiceId");

-- CreateIndex
CREATE INDEX "CourierSettlementException_rowId_idx" ON "CourierSettlementException"("rowId");

-- CreateIndex
CREATE INDEX "CourierSettlementException_orderId_idx" ON "CourierSettlementException"("orderId");

-- CreateIndex
CREATE INDEX "CourierSettlementException_status_idx" ON "CourierSettlementException"("status");

-- CreateIndex
CREATE INDEX "CourierSettlementException_severity_idx" ON "CourierSettlementException"("severity");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementAdjustment_journalEntryId_key" ON "CourierSettlementAdjustment"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementAdjustment_reversalOfId_key" ON "CourierSettlementAdjustment"("reversalOfId");

-- CreateIndex
CREATE INDEX "CourierSettlementAdjustment_invoiceId_idx" ON "CourierSettlementAdjustment"("invoiceId");

-- CreateIndex
CREATE INDEX "CourierSettlementAdjustment_rowId_idx" ON "CourierSettlementAdjustment"("rowId");

-- CreateIndex
CREATE INDEX "CourierSettlementAdjustment_invoiceId_field_idx" ON "CourierSettlementAdjustment"("invoiceId", "field");

-- CreateIndex
CREATE INDEX "CourierSettlementActivity_invoiceId_idx" ON "CourierSettlementActivity"("invoiceId");

-- CreateIndex
CREATE INDEX "CourierSettlementActivity_timestamp_idx" ON "CourierSettlementActivity"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementActivity_invoiceId_action_dedupeKey_key" ON "CourierSettlementActivity"("invoiceId", "action", "dedupeKey");

-- CreateIndex
CREATE INDEX "CourierSettlementColumnAlias_courier_idx" ON "CourierSettlementColumnAlias"("courier");

-- CreateIndex
CREATE INDEX "CourierSettlementColumnAlias_active_idx" ON "CourierSettlementColumnAlias"("active");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementColumnAlias_courier_sourceHeader_key" ON "CourierSettlementColumnAlias"("courier", "sourceHeader");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementFinalizationSnapshot_journalEntryId_key" ON "CourierSettlementFinalizationSnapshot"("journalEntryId");

-- CreateIndex
CREATE INDEX "CourierSettlementFinalizationSnapshot_invoiceId_idx" ON "CourierSettlementFinalizationSnapshot"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementFinalizationSnapshot_invoiceId_version_key" ON "CourierSettlementFinalizationSnapshot"("invoiceId", "version");

-- CreateIndex
CREATE INDEX "CourierSettlementFinanceRule_courier_idx" ON "CourierSettlementFinanceRule"("courier");

-- CreateIndex
CREATE INDEX "CourierSettlementFinanceRule_approved_idx" ON "CourierSettlementFinanceRule"("approved");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementFinanceRule_courier_format_key" ON "CourierSettlementFinanceRule"("courier", "format");

-- AddForeignKey
ALTER TABLE "CourierSettlementInvoice" ADD CONSTRAINT "CourierSettlementInvoice_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementInvoice" ADD CONSTRAINT "CourierSettlementInvoice_revisionOfId_fkey" FOREIGN KEY ("revisionOfId") REFERENCES "CourierSettlementInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementRow" ADD CONSTRAINT "CourierSettlementRow_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CourierSettlementInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementRow" ADD CONSTRAINT "CourierSettlementRow_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementException" ADD CONSTRAINT "CourierSettlementException_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CourierSettlementInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementException" ADD CONSTRAINT "CourierSettlementException_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "CourierSettlementRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementException" ADD CONSTRAINT "CourierSettlementException_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementAdjustment" ADD CONSTRAINT "CourierSettlementAdjustment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CourierSettlementInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementAdjustment" ADD CONSTRAINT "CourierSettlementAdjustment_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "CourierSettlementRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementAdjustment" ADD CONSTRAINT "CourierSettlementAdjustment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementActivity" ADD CONSTRAINT "CourierSettlementActivity_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CourierSettlementInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementFinalizationSnapshot" ADD CONSTRAINT "CourierSettlementFinalizationSnapshot_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CourierSettlementInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
