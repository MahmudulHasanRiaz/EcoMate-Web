-- CreateEnum
CREATE TYPE "SyncRunScope" AS ENUM ('PRODUCT', 'STOCK', 'ORDER_INGEST', 'ORDER_PUSH', 'RECONCILE', 'MAINTENANCE', 'PUBLISH');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SyncTriggerType" AS ENUM ('MANUAL', 'SCHEDULED', 'WEBHOOK', 'RETRY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SyncItemStatus" AS ENUM ('PENDING', 'SUCCESS', 'SKIPPED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "SyncObjectType" AS ENUM ('PRODUCT', 'VARIANT', 'CATEGORY', 'MEDIA', 'ORDER', 'PUBLICATION', 'DELETION');

-- CreateEnum
CREATE TYPE "SyncIssueStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "scope" "SyncRunScope" NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "triggerType" "SyncTriggerType" NOT NULL DEFAULT 'MANUAL',
    "storeId" TEXT,
    "initiatedById" TEXT,
    "windowDays" INTEGER,
    "wideningReason" TEXT,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "correlationId" TEXT,
    "errorCategory" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRunItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "storeId" TEXT,
    "productId" TEXT,
    "objectType" "SyncObjectType" NOT NULL,
    "externalObjectId" TEXT,
    "status" "SyncItemStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "field" TEXT,
    "auditLevel" TEXT,
    "durationMs" INTEGER,
    "errorCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncAttempt" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "storeId" TEXT,
    "objectType" "SyncObjectType" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "productId" TEXT,
    "field" TEXT,
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "status" "SyncItemStatus" NOT NULL DEFAULT 'PENDING',
    "errorCategory" TEXT,
    "errorMessage" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSyncIssue" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "objectType" "SyncObjectType" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "productId" TEXT,
    "field" TEXT,
    "message" TEXT NOT NULL,
    "status" "SyncIssueStatus" NOT NULL DEFAULT 'OPEN',
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolveNote" TEXT,

    CONSTRAINT "StoreSyncIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreWebhookDelivery" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "deliveryKey" TEXT NOT NULL,
    "retryKey" TEXT,
    "topic" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreWebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreProductMapping" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalUrl" TEXT,
    "lastEvaluatedVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreProductMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreVariantMapping" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreVariantMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCategoryMapping" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "externalTermId" TEXT NOT NULL,
    "externalPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCategoryMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSkuMapping" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSkuMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreMediaMapping" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "mediaKey" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreMediaMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncRun_storeId_idx" ON "SyncRun"("storeId");

-- CreateIndex
CREATE INDEX "SyncRun_scope_idx" ON "SyncRun"("scope");

-- CreateIndex
CREATE INDEX "SyncRun_status_idx" ON "SyncRun"("status");

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

-- CreateIndex
CREATE INDEX "SyncRunItem_runId_idx" ON "SyncRunItem"("runId");

-- CreateIndex
CREATE INDEX "SyncRunItem_storeId_productId_idx" ON "SyncRunItem"("storeId", "productId");

-- CreateIndex
CREATE INDEX "SyncRunItem_status_idx" ON "SyncRunItem"("status");

-- CreateIndex
CREATE INDEX "SyncAttempt_storeId_objectKey_idx" ON "SyncAttempt"("storeId", "objectKey");

-- CreateIndex
CREATE INDEX "SyncAttempt_runId_idx" ON "SyncAttempt"("runId");

-- CreateIndex
CREATE INDEX "SyncAttempt_createdAt_idx" ON "SyncAttempt"("createdAt");

-- CreateIndex
CREATE INDEX "StoreSyncIssue_storeId_status_idx" ON "StoreSyncIssue"("storeId", "status");

-- CreateIndex
CREATE INDEX "StoreSyncIssue_status_idx" ON "StoreSyncIssue"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StoreSyncIssue_storeId_code_objectKey_key" ON "StoreSyncIssue"("storeId", "code", "objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "StoreWebhookDelivery_deliveryKey_key" ON "StoreWebhookDelivery"("deliveryKey");

-- CreateIndex
CREATE INDEX "StoreWebhookDelivery_storeId_idx" ON "StoreWebhookDelivery"("storeId");

-- CreateIndex
CREATE INDEX "StoreProductMapping_storeId_externalId_idx" ON "StoreProductMapping"("storeId", "externalId");

-- CreateIndex
CREATE INDEX "StoreProductMapping_productId_idx" ON "StoreProductMapping"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreProductMapping_storeId_productId_key" ON "StoreProductMapping"("storeId", "productId");

-- CreateIndex
CREATE INDEX "StoreVariantMapping_storeId_productId_idx" ON "StoreVariantMapping"("storeId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreVariantMapping_storeId_variantId_key" ON "StoreVariantMapping"("storeId", "variantId");

-- CreateIndex
CREATE INDEX "StoreCategoryMapping_storeId_externalTermId_idx" ON "StoreCategoryMapping"("storeId", "externalTermId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreCategoryMapping_storeId_categoryId_key" ON "StoreCategoryMapping"("storeId", "categoryId");

-- CreateIndex
CREATE INDEX "StoreSkuMapping_productId_idx" ON "StoreSkuMapping"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreSkuMapping_storeId_sku_key" ON "StoreSkuMapping"("storeId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "StoreMediaMapping_storeId_mediaKey_key" ON "StoreMediaMapping"("storeId", "mediaKey");

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRunItem" ADD CONSTRAINT "SyncRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncAttempt" ADD CONSTRAINT "SyncAttempt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSyncIssue" ADD CONSTRAINT "StoreSyncIssue_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreWebhookDelivery" ADD CONSTRAINT "StoreWebhookDelivery_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreProductMapping" ADD CONSTRAINT "StoreProductMapping_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreVariantMapping" ADD CONSTRAINT "StoreVariantMapping_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCategoryMapping" ADD CONSTRAINT "StoreCategoryMapping_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSkuMapping" ADD CONSTRAINT "StoreSkuMapping_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreMediaMapping" ADD CONSTRAINT "StoreMediaMapping_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
