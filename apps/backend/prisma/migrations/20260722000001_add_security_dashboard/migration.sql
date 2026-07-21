-- CreateEnum
CREATE TYPE "SecurityEventSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "SecurityEventCategory" AS ENUM ('RATE_LIMIT', 'AUTH', 'FRAUD', 'BLOCK', 'SYSTEM', 'WAF', 'BOT', 'THREAT_INTEL');

-- CreateEnum
CREATE TYPE "SecurityActorType" AS ENUM ('IP', 'USER', 'SESSION', 'BROWSER_TRUST', 'SYSTEM');

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL DEFAULT 'default',
    "eventType" TEXT NOT NULL,
    "severity" "SecurityEventSeverity" NOT NULL,
    "category" "SecurityEventCategory" NOT NULL,
    "source" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" "SecurityActorType" NOT NULL,
    "ipAddress" TEXT,
    "userId" TEXT,
    "sessionId" TEXT,
    "browserTrustId" TEXT,
    "phone" TEXT,
    "trustTier" TEXT,
    "riskScore" INTEGER,
    "metadataVersion" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "correlationId" TEXT,
    "parentCorrelationId" TEXT,
    "description" TEXT,
    "retentionOverride" BOOLEAN NOT NULL DEFAULT false,
    "dedupKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEventHourly" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL DEFAULT 'default',
    "bucket" TIMESTAMPTZ NOT NULL,
    "eventType" TEXT NOT NULL,
    "severity" "SecurityEventSeverity" NOT NULL,
    "category" "SecurityEventCategory" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "SecurityEventHourly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEventDaily" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL DEFAULT 'default',
    "date" DATE NOT NULL,
    "eventType" TEXT NOT NULL,
    "severity" "SecurityEventSeverity" NOT NULL,
    "category" "SecurityEventCategory" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "SecurityEventDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityBlockDaily" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL DEFAULT 'default',
    "date" DATE NOT NULL,
    "blockSource" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "SecurityBlockDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityRetentionPolicy" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL DEFAULT 'default',
    "category" "SecurityEventCategory" NOT NULL,
    "severity" "SecurityEventSeverity" NOT NULL,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "criticalRetentionDays" INTEGER,

    CONSTRAINT "SecurityRetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecurityEvent_dedupKey_key" ON "SecurityEvent"("dedupKey");

-- CreateIndex
CREATE INDEX "SecurityEvent_tenant_timestamp_idx" ON "SecurityEvent"("tenant", "timestamp");

-- CreateIndex
CREATE INDEX "SecurityEvent_tenant_eventType_timestamp_idx" ON "SecurityEvent"("tenant", "eventType", "timestamp");

-- CreateIndex
CREATE INDEX "SecurityEvent_tenant_severity_timestamp_idx" ON "SecurityEvent"("tenant", "severity", "timestamp");

-- CreateIndex
CREATE INDEX "SecurityEvent_tenant_category_severity_timestamp_idx" ON "SecurityEvent"("tenant", "category", "severity", "timestamp");

-- CreateIndex
CREATE INDEX "SecurityEvent_tenant_ipAddress_timestamp_idx" ON "SecurityEvent"("tenant", "ipAddress", "timestamp");

-- CreateIndex
CREATE INDEX "SecurityEvent_tenant_userId_timestamp_idx" ON "SecurityEvent"("tenant", "userId", "timestamp");

-- CreateIndex
CREATE INDEX "SecurityEvent_tenant_correlationId_idx" ON "SecurityEvent"("tenant", "correlationId");

-- CreateIndex
CREATE INDEX "SecurityEvent_tenant_parentCorrelationId_idx" ON "SecurityEvent"("tenant", "parentCorrelationId");

-- CreateIndex
CREATE INDEX "SecurityEvent_createdAt_idx" ON "SecurityEvent"("createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_retentionOverride_createdAt_idx" ON "SecurityEvent"("retentionOverride", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityEventHourly_tenant_bucket_eventType_severity_cate_key" ON "SecurityEventHourly"("tenant", "bucket", "eventType", "severity", "category");

-- CreateIndex
CREATE INDEX "SecurityEventHourly_tenant_bucket_idx" ON "SecurityEventHourly"("tenant", "bucket");

-- CreateIndex
CREATE INDEX "SecurityEventHourly_tenant_bucket_severity_idx" ON "SecurityEventHourly"("tenant", "bucket", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityEventDaily_tenant_date_eventType_severity_categor_key" ON "SecurityEventDaily"("tenant", "date", "eventType", "severity", "category");

-- CreateIndex
CREATE INDEX "SecurityEventDaily_tenant_date_idx" ON "SecurityEventDaily"("tenant", "date");

-- CreateIndex
CREATE INDEX "SecurityEventDaily_tenant_date_severity_idx" ON "SecurityEventDaily"("tenant", "date", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityBlockDaily_tenant_date_blockSource_targetType_key" ON "SecurityBlockDaily"("tenant", "date", "blockSource", "targetType");

-- CreateIndex
CREATE INDEX "SecurityBlockDaily_tenant_date_idx" ON "SecurityBlockDaily"("tenant", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityRetentionPolicy_tenant_category_severity_key" ON "SecurityRetentionPolicy"("tenant", "category", "severity");
