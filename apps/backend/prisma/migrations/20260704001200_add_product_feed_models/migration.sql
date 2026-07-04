-- CreateTable
CREATE TABLE "ProductFeedConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "secureToken" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "excludeOutOfStock" BOOLEAN NOT NULL DEFAULT false,
    "minPriceFilter" DECIMAL(10,2),
    "lastFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductFeedConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductFeedLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductFeedLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductFeedConfig_secureToken_key" ON "ProductFeedConfig"("secureToken");

-- CreateIndex
CREATE INDEX "ProductFeedConfig_tenantId_idx" ON "ProductFeedConfig"("tenantId");

-- CreateIndex
CREATE INDEX "ProductFeedConfig_secureToken_isActive_idx" ON "ProductFeedConfig"("secureToken", "isActive");

-- CreateIndex
CREATE INDEX "ProductFeedLog_tenantId_idx" ON "ProductFeedLog"("tenantId");

-- CreateIndex
CREATE INDEX "ProductFeedLog_fetchedAt_idx" ON "ProductFeedLog"("fetchedAt");
