-- CreateTable
CREATE TABLE "MobileBuild" (
    "id" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "versionName" TEXT NOT NULL DEFAULT '1.0.0',
    "versionCode" INTEGER NOT NULL DEFAULT 1,
    "artifactPath" TEXT,
    "buildLogUrl" TEXT,
    "triggeredBy" TEXT,
    "triggeredById" TEXT,
    "clientDomain" TEXT,
    "packageId" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileBuild_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MobileBuild_app_idx" ON "MobileBuild"("app");

-- CreateIndex
CREATE INDEX "MobileBuild_status_idx" ON "MobileBuild"("status");

-- CreateIndex
CREATE INDEX "MobileBuild_createdAt_idx" ON "MobileBuild"("createdAt");