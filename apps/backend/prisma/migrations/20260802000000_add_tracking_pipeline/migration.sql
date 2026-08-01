
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "trackingSessionId" TEXT;

-- CreateTable
CREATE TABLE "TrackingContext" (
    "id" TEXT NOT NULL,
    "ctxId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "url" TEXT,
    "referrer" TEXT,
    "identifiers" JSONB NOT NULL DEFAULT '{}',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackingContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingSnapshot" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "orderId" TEXT,
    "ctxId" TEXT,
    "eventTime" BIGINT NOT NULL,
    "actionSource" TEXT,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingOutbox" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "configSnapshot" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),

    CONSTRAINT "TrackingOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingDispatch" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT,
    "ctxId" TEXT,
    "queueJobId" TEXT,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerEventId" TEXT,
    "httpStatus" INTEGER,
    "responseBody" TEXT,
    "errorMsg" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "adapterVersion" INTEGER,
    "providerApiVersion" TEXT,
    "payloadVersion" INTEGER,
    "normalizerVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackingDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingDispatchEvent" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT,
    "ctxId" TEXT,
    "provider" TEXT,
    "queueJobId" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "attempt" INTEGER,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingDispatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingReplayArchive" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventTime" BIGINT NOT NULL,
    "archivedPayload" JSONB NOT NULL DEFAULT '{}',
    "configSnapshot" JSONB NOT NULL DEFAULT '{}',
    "versions" JSONB NOT NULL DEFAULT '{}',
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingReplayArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackingContext_ctxId_key" ON "TrackingContext"("ctxId");

-- CreateIndex
CREATE INDEX "TrackingContext_externalId_idx" ON "TrackingContext"("externalId");

-- CreateIndex
CREATE INDEX "TrackingContext_lastSeenAt_idx" ON "TrackingContext"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingSnapshot_eventId_key" ON "TrackingSnapshot"("eventId");

-- CreateIndex
CREATE INDEX "TrackingSnapshot_orderId_idx" ON "TrackingSnapshot"("orderId");

-- CreateIndex
CREATE INDEX "TrackingSnapshot_eventType_createdAt_idx" ON "TrackingSnapshot"("eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingOutbox_snapshotId_key" ON "TrackingOutbox"("snapshotId");

-- CreateIndex
CREATE INDEX "TrackingOutbox_status_priority_nextAttemptAt_idx" ON "TrackingOutbox"("status", "priority", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "TrackingOutbox_createdAt_idx" ON "TrackingOutbox"("createdAt");

-- CreateIndex
CREATE INDEX "TrackingDispatch_provider_status_createdAt_idx" ON "TrackingDispatch"("provider", "status", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingDispatch_eventId_createdAt_idx" ON "TrackingDispatch"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingDispatch_orderId_createdAt_idx" ON "TrackingDispatch"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingDispatch_ctxId_idx" ON "TrackingDispatch"("ctxId");

-- CreateIndex
CREATE INDEX "TrackingDispatch_createdAt_idx" ON "TrackingDispatch"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingDispatch_snapshotId_provider_key" ON "TrackingDispatch"("snapshotId", "provider");

-- CreateIndex
CREATE INDEX "TrackingDispatchEvent_snapshotId_createdAt_idx" ON "TrackingDispatchEvent"("snapshotId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingDispatchEvent_provider_toStatus_createdAt_idx" ON "TrackingDispatchEvent"("provider", "toStatus", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingDispatchEvent_eventId_createdAt_idx" ON "TrackingDispatchEvent"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingDispatchEvent_orderId_createdAt_idx" ON "TrackingDispatchEvent"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingDispatchEvent_ctxId_idx" ON "TrackingDispatchEvent"("ctxId");

-- CreateIndex
CREATE INDEX "TrackingDispatchEvent_createdAt_idx" ON "TrackingDispatchEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingReplayArchive_snapshotId_key" ON "TrackingReplayArchive"("snapshotId");

-- CreateIndex
CREATE INDEX "TrackingReplayArchive_eventId_idx" ON "TrackingReplayArchive"("eventId");

-- CreateIndex
CREATE INDEX "TrackingReplayArchive_eventType_archivedAt_idx" ON "TrackingReplayArchive"("eventType", "archivedAt");

-- CreateIndex
CREATE INDEX "Order_trackingSessionId_idx" ON "Order"("trackingSessionId");
