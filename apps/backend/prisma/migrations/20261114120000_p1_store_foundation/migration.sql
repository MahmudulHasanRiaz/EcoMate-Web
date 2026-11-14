-- Central Commerce P1 — Store foundation (plan §7, §8.10, P1 row).
-- Additive only (§16.1): three new enums, three new tables. No drops,
-- no renames, no in-place enum changes.
-- Note: authored via `prisma migrate diff` output scoped to the new
-- models (migrate dev is blocked by pre-existing drift — see P1 evidence).

-- CreateEnum
CREATE TYPE "StoreKind" AS ENUM ('NATIVE', 'WOOCOMMERCE', 'SHOPIFY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('PENDING', 'CONNECTED', 'DISCONNECTED', 'AUTH_FAILED', 'ATTENTION_REQUIRED');

-- CreateEnum
CREATE TYPE "StoreHealthState" AS ENUM ('HEALTHY', 'ATTENTION_REQUIRED', 'ERROR', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "kind" "StoreKind" NOT NULL,
    "name" TEXT NOT NULL,
    "domainNormalised" TEXT,
    "identityFingerprint" TEXT,
    "providerStoreId" TEXT,
    "status" "StoreStatus" NOT NULL DEFAULT 'PENDING',
    "healthState" "StoreHealthState" NOT NULL DEFAULT 'DISCONNECTED',
    "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB DEFAULT '{}',
    "pluginVersion" TEXT,
    "capabilities" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCredential" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "credentialsEnc" TEXT NOT NULL,
    "keyFingerprint" TEXT,
    "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreHealthCheck" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "state" "StoreHealthState" NOT NULL,
    "reason" TEXT,
    "reachable" BOOLEAN NOT NULL DEFAULT false,
    "authenticated" BOOLEAN NOT NULL DEFAULT false,
    "permissionsOk" BOOLEAN NOT NULL DEFAULT false,
    "mediaReachable" BOOLEAN,
    "detail" JSONB,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreHealthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Store_identityFingerprint_key" ON "Store"("identityFingerprint");

-- CreateIndex
CREATE INDEX "Store_kind_idx" ON "Store"("kind");

-- CreateIndex
CREATE INDEX "Store_status_idx" ON "Store"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Store_kind_domainNormalised_key" ON "Store"("kind", "domainNormalised");

-- CreateIndex
CREATE INDEX "StoreCredential_storeId_idx" ON "StoreCredential"("storeId");

-- CreateIndex
CREATE INDEX "StoreHealthCheck_storeId_idx" ON "StoreHealthCheck"("storeId");

-- CreateIndex
CREATE INDEX "StoreHealthCheck_checkedAt_idx" ON "StoreHealthCheck"("checkedAt");

-- AddForeignKey
ALTER TABLE "StoreCredential" ADD CONSTRAINT "StoreCredential_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreHealthCheck" ADD CONSTRAINT "StoreHealthCheck_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
