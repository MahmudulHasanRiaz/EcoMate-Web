-- CreateEnum
CREATE TYPE "MarketingPlatformSlug" AS ENUM ('facebook', 'google_ads', 'tiktok', 'linkedin');

-- CreateEnum
CREATE TYPE "MarketingConnectionStatus" AS ENUM ('connected', 'disconnected', 'expired', 'error');

-- CreateEnum
CREATE TYPE "MarketingFundingStatus" AS ENUM ('draft', 'confirmed', 'posted', 'partially_consumed', 'fully_consumed', 'archived');

-- CreateEnum
CREATE TYPE "MarketingAllocationMethod" AS ENUM ('equal', 'product_value', 'quantity');

-- CreateEnum
CREATE TYPE "OrderAttributionMethod" AS ENUM ('fbclid', 'conversion_api', 'pixel', 'session', 'utm', 'manual');

-- CreateTable
CREATE TABLE "MarketingPlatform" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" "MarketingPlatformSlug" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingPlatform_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingConnection" (
    "id" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "providerUserId" TEXT,
    "providerBusinessId" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "tokenType" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "status" "MarketingConnectionStatus" NOT NULL DEFAULT 'connected',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingBusiness" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerBusinessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingBusiness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdAccount" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "businessId" TEXT,
    "providerAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "providerCampaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "buyingType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "effectiveStatus" TEXT,
    "dailyBudget" DECIMAL(14,2),
    "lifetimeBudget" DECIMAL(14,2),
    "createdTime" TIMESTAMP(3),
    "updatedTime" TIMESTAMP(3),
    "startTime" TIMESTAMP(3),
    "stopTime" TIMESTAMP(3),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "deletedFromProvider" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAdSet" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "providerAdSetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "optimizationGoal" TEXT,
    "billingEvent" TEXT,
    "bidStrategy" TEXT,
    "budget" DECIMAL(14,2),
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "deletedFromProvider" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingAdSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAd" (
    "id" TEXT NOT NULL,
    "adSetId" TEXT NOT NULL,
    "providerAdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "creativeId" TEXT,
    "creativeName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "landingUrl" TEXT,
    "previewUrl" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "deletedFromProvider" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingAd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaignInsight" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "cpc" DECIMAL(14,4),
    "cpm" DECIMAL(14,4),
    "ctr" DECIMAL(14,4),
    "spend" DECIMAL(14,4) NOT NULL,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "purchaseValue" DECIMAL(14,4),
    "roas" DECIMAL(14,4),
    "frequency" DECIMAL(14,4),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingCampaignInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAdSetInsight" (
    "id" TEXT NOT NULL,
    "adSetId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "cpc" DECIMAL(14,4),
    "cpm" DECIMAL(14,4),
    "ctr" DECIMAL(14,4),
    "spend" DECIMAL(14,4) NOT NULL,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "purchaseValue" DECIMAL(14,4),
    "roas" DECIMAL(14,4),
    "frequency" DECIMAL(14,4),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingAdSetInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAdInsight" (
    "id" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "cpc" DECIMAL(14,4),
    "cpm" DECIMAL(14,4),
    "ctr" DECIMAL(14,4),
    "spend" DECIMAL(14,4) NOT NULL,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "purchaseValue" DECIMAL(14,4),
    "roas" DECIMAL(14,4),
    "frequency" DECIMAL(14,4),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingAdInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingFundingEntry" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'facebook',
    "adAccountId" TEXT NOT NULL,
    "fundingSource" TEXT NOT NULL,
    "fundingDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "currencyAmount" DECIMAL(14,4) NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'BDT',
    "baseAmount" DECIMAL(14,2) NOT NULL,
    "effectiveRate" DECIMAL(14,4) NOT NULL,
    "reference" TEXT,
    "remarks" TEXT,
    "journalEntryId" TEXT,
    "status" "MarketingFundingStatus" NOT NULL DEFAULT 'draft',
    "createdBy" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingFundingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingFundingLedger" (
    "id" TEXT NOT NULL,
    "fundingEntryId" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "receivedAmount" DECIMAL(14,4) NOT NULL,
    "remainingAmount" DECIMAL(14,4) NOT NULL,
    "effectiveRate" DECIMAL(14,4) NOT NULL,
    "consumedAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "status" "MarketingFundingStatus" NOT NULL DEFAULT 'confirmed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingFundingLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingConsumption" (
    "id" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "campaignId" TEXT,
    "orderId" TEXT,
    "consumedAmount" DECIMAL(14,4) NOT NULL,
    "effectiveRate" DECIMAL(14,4) NOT NULL,
    "calculatedCost" DECIMAL(14,2) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'spend_sync',
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingSession" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "fbclid" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "referrer" TEXT,
    "landingUrl" TEXT,
    "campaignId" TEXT,
    "adSetId" TEXT,
    "adId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAttribution" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sessionId" TEXT,
    "campaignId" TEXT,
    "adSetId" TEXT,
    "adId" TEXT,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "method" "OrderAttributionMethod" NOT NULL,
    "explanation" TEXT,
    "attributionVersion" INTEGER NOT NULL DEFAULT 1,
    "attributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCostAllocation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "attributionId" TEXT,
    "campaignId" TEXT NOT NULL,
    "allocatedSpend" DECIMAL(14,4) NOT NULL,
    "allocatedCurrency" TEXT NOT NULL DEFAULT 'USD',
    "allocatedRate" DECIMAL(14,4) NOT NULL,
    "allocatedCost" DECIMAL(14,2) NOT NULL,
    "allocationMethod" "MarketingAllocationMethod" NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingCostAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMarketingCost" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "marketingCost" DECIMAL(14,2) NOT NULL,
    "allocationRatio" DECIMAL(14,6) NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductMarketingCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingSyncStatus" (
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'facebook',
    "status" TEXT NOT NULL DEFAULT 'idle',
    "stage" TEXT,
    "progressPct" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "recordsImported" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingSyncStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingRawPayload" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'facebook',
    "endpoint" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT,
    "payloadJson" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingRawPayload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingDailySummary" (
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spend" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "purchaseValue" DECIMAL(14,4),
    "orders" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(14,2),
    "marketingCost" DECIMAL(14,2),
    "profit" DECIMAL(14,2),
    "roas" DECIMAL(14,4),
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingDailySummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPlatform_slug_key" ON "MarketingPlatform"("slug");

-- CreateIndex
CREATE INDEX "MarketingPlatform_slug_idx" ON "MarketingPlatform"("slug");

-- CreateIndex
CREATE INDEX "MarketingConnection_platformId_idx" ON "MarketingConnection"("platformId");

-- CreateIndex
CREATE INDEX "MarketingConnection_status_idx" ON "MarketingConnection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingBusiness_providerBusinessId_key" ON "MarketingBusiness"("providerBusinessId");

-- CreateIndex
CREATE INDEX "MarketingBusiness_connectionId_idx" ON "MarketingBusiness"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "AdAccount_providerAccountId_key" ON "AdAccount"("providerAccountId");

-- CreateIndex
CREATE INDEX "AdAccount_connectionId_idx" ON "AdAccount"("connectionId");

-- CreateIndex
CREATE INDEX "AdAccount_businessId_idx" ON "AdAccount"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCampaign_providerCampaignId_key" ON "MarketingCampaign"("providerCampaignId");

-- CreateIndex
CREATE INDEX "MarketingCampaign_adAccountId_idx" ON "MarketingCampaign"("adAccountId");

-- CreateIndex
CREATE INDEX "MarketingCampaign_status_idx" ON "MarketingCampaign"("status");

-- CreateIndex
CREATE INDEX "MarketingCampaign_name_idx" ON "MarketingCampaign"("name");

-- CreateIndex
CREATE INDEX "MarketingCampaign_providerCampaignId_idx" ON "MarketingCampaign"("providerCampaignId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingAdSet_providerAdSetId_key" ON "MarketingAdSet"("providerAdSetId");

-- CreateIndex
CREATE INDEX "MarketingAdSet_campaignId_idx" ON "MarketingAdSet"("campaignId");

-- CreateIndex
CREATE INDEX "MarketingAdSet_providerAdSetId_idx" ON "MarketingAdSet"("providerAdSetId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingAd_providerAdId_key" ON "MarketingAd"("providerAdId");

-- CreateIndex
CREATE INDEX "MarketingAd_adSetId_idx" ON "MarketingAd"("adSetId");

-- CreateIndex
CREATE INDEX "MarketingAd_providerAdId_idx" ON "MarketingAd"("providerAdId");

-- CreateIndex
CREATE INDEX "MarketingCampaignInsight_date_idx" ON "MarketingCampaignInsight"("date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCampaignInsight_campaignId_date_key" ON "MarketingCampaignInsight"("campaignId", "date");

-- CreateIndex
CREATE INDEX "MarketingAdSetInsight_date_idx" ON "MarketingAdSetInsight"("date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingAdSetInsight_adSetId_date_key" ON "MarketingAdSetInsight"("adSetId", "date");

-- CreateIndex
CREATE INDEX "MarketingAdInsight_date_idx" ON "MarketingAdInsight"("date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingAdInsight_adId_date_key" ON "MarketingAdInsight"("adId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingFundingEntry_journalEntryId_key" ON "MarketingFundingEntry"("journalEntryId");

-- CreateIndex
CREATE INDEX "MarketingFundingEntry_adAccountId_idx" ON "MarketingFundingEntry"("adAccountId");

-- CreateIndex
CREATE INDEX "MarketingFundingEntry_fundingDate_idx" ON "MarketingFundingEntry"("fundingDate");

-- CreateIndex
CREATE INDEX "MarketingFundingEntry_status_idx" ON "MarketingFundingEntry"("status");

-- CreateIndex
CREATE INDEX "MarketingFundingLedger_fundingEntryId_idx" ON "MarketingFundingLedger"("fundingEntryId");

-- CreateIndex
CREATE INDEX "MarketingFundingLedger_adAccountId_idx" ON "MarketingFundingLedger"("adAccountId");

-- CreateIndex
CREATE INDEX "MarketingFundingLedger_status_idx" ON "MarketingFundingLedger"("status");

-- CreateIndex
CREATE INDEX "MarketingConsumption_ledgerId_idx" ON "MarketingConsumption"("ledgerId");

-- CreateIndex
CREATE INDEX "MarketingConsumption_campaignId_idx" ON "MarketingConsumption"("campaignId");

-- CreateIndex
CREATE INDEX "MarketingConsumption_orderId_idx" ON "MarketingConsumption"("orderId");

-- CreateIndex
CREATE INDEX "MarketingConsumption_allocatedAt_idx" ON "MarketingConsumption"("allocatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingSession_sessionToken_key" ON "MarketingSession"("sessionToken");

-- CreateIndex
CREATE INDEX "MarketingSession_visitorId_idx" ON "MarketingSession"("visitorId");

-- CreateIndex
CREATE INDEX "MarketingSession_fbclid_idx" ON "MarketingSession"("fbclid");

-- CreateIndex
CREATE INDEX "MarketingSession_utmCampaign_idx" ON "MarketingSession"("utmCampaign");

-- CreateIndex
CREATE INDEX "MarketingSession_createdAt_idx" ON "MarketingSession"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderAttribution_orderId_key" ON "OrderAttribution"("orderId");

-- CreateIndex
CREATE INDEX "OrderAttribution_sessionId_idx" ON "OrderAttribution"("sessionId");

-- CreateIndex
CREATE INDEX "OrderAttribution_campaignId_idx" ON "OrderAttribution"("campaignId");

-- CreateIndex
CREATE INDEX "OrderAttribution_adId_idx" ON "OrderAttribution"("adId");

-- CreateIndex
CREATE INDEX "OrderAttribution_attributedAt_idx" ON "OrderAttribution"("attributedAt");

-- CreateIndex
CREATE INDEX "MarketingCostAllocation_campaignId_idx" ON "MarketingCostAllocation"("campaignId");

-- CreateIndex
CREATE INDEX "MarketingCostAllocation_calculatedAt_idx" ON "MarketingCostAllocation"("calculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCostAllocation_orderId_campaignId_key" ON "MarketingCostAllocation"("orderId", "campaignId");

-- CreateIndex
CREATE INDEX "ProductMarketingCost_allocationId_idx" ON "ProductMarketingCost"("allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMarketingCost_orderItemId_allocationId_key" ON "ProductMarketingCost"("orderItemId", "allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingSyncStatus_adAccountId_key" ON "MarketingSyncStatus"("adAccountId");

-- CreateIndex
CREATE INDEX "MarketingAuditLog_entityType_entityId_idx" ON "MarketingAuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "MarketingAuditLog_action_idx" ON "MarketingAuditLog"("action");

-- CreateIndex
CREATE INDEX "MarketingAuditLog_createdAt_idx" ON "MarketingAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "MarketingRawPayload_objectType_objectId_idx" ON "MarketingRawPayload"("objectType", "objectId");

-- CreateIndex
CREATE INDEX "MarketingRawPayload_receivedAt_idx" ON "MarketingRawPayload"("receivedAt");

-- CreateIndex
CREATE INDEX "MarketingDailySummary_date_idx" ON "MarketingDailySummary"("date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingDailySummary_adAccountId_date_key" ON "MarketingDailySummary"("adAccountId", "date");

-- AddForeignKey
ALTER TABLE "MarketingConnection" ADD CONSTRAINT "MarketingConnection_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "MarketingPlatform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingBusiness" ADD CONSTRAINT "MarketingBusiness_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MarketingConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdAccount" ADD CONSTRAINT "AdAccount_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MarketingConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdAccount" ADD CONSTRAINT "AdAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "MarketingBusiness"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAdSet" ADD CONSTRAINT "MarketingAdSet_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAd" ADD CONSTRAINT "MarketingAd_adSetId_fkey" FOREIGN KEY ("adSetId") REFERENCES "MarketingAdSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaignInsight" ADD CONSTRAINT "MarketingCampaignInsight_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAdSetInsight" ADD CONSTRAINT "MarketingAdSetInsight_adSetId_fkey" FOREIGN KEY ("adSetId") REFERENCES "MarketingAdSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAdInsight" ADD CONSTRAINT "MarketingAdInsight_adId_fkey" FOREIGN KEY ("adId") REFERENCES "MarketingAd"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingFundingEntry" ADD CONSTRAINT "MarketingFundingEntry_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingFundingEntry" ADD CONSTRAINT "MarketingFundingEntry_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingFundingLedger" ADD CONSTRAINT "MarketingFundingLedger_fundingEntryId_fkey" FOREIGN KEY ("fundingEntryId") REFERENCES "MarketingFundingEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingFundingLedger" ADD CONSTRAINT "MarketingFundingLedger_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingConsumption" ADD CONSTRAINT "MarketingConsumption_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "MarketingFundingLedger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingConsumption" ADD CONSTRAINT "MarketingConsumption_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingSession" ADD CONSTRAINT "MarketingSession_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingSession" ADD CONSTRAINT "MarketingSession_adId_fkey" FOREIGN KEY ("adId") REFERENCES "MarketingAd"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAttribution" ADD CONSTRAINT "OrderAttribution_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAttribution" ADD CONSTRAINT "OrderAttribution_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MarketingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAttribution" ADD CONSTRAINT "OrderAttribution_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAttribution" ADD CONSTRAINT "OrderAttribution_adSetId_fkey" FOREIGN KEY ("adSetId") REFERENCES "MarketingAdSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAttribution" ADD CONSTRAINT "OrderAttribution_adId_fkey" FOREIGN KEY ("adId") REFERENCES "MarketingAd"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCostAllocation" ADD CONSTRAINT "MarketingCostAllocation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCostAllocation" ADD CONSTRAINT "MarketingCostAllocation_attributionId_fkey" FOREIGN KEY ("attributionId") REFERENCES "OrderAttribution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCostAllocation" ADD CONSTRAINT "MarketingCostAllocation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMarketingCost" ADD CONSTRAINT "ProductMarketingCost_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "MarketingCostAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMarketingCost" ADD CONSTRAINT "ProductMarketingCost_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingSyncStatus" ADD CONSTRAINT "MarketingSyncStatus_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingDailySummary" ADD CONSTRAINT "MarketingDailySummary_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
