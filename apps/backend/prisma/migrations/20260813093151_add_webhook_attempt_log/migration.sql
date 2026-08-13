-- CreateEnum
CREATE TYPE "WebhookAttemptOutcome" AS ENUM ('SUCCESS', 'AUTH_FAILED', 'AUTH_HEADER_MISSING', 'AUTH_FORMAT_INVALID', 'RATE_LIMITED', 'PAYLOAD_INVALID', 'ORDER_NOT_FOUND', 'PROCESSING_ERROR', 'SKIPPED', 'UNKNOWN_ERROR');

-- CreateEnum
CREATE TYPE "WebhookAttemptStage" AS ENUM ('RATE_LIMIT', 'AUTH', 'PAYLOAD', 'ORDER_RESOLUTION', 'PROCESSING', 'RESPONSE');

-- CreateTable
CREATE TABLE "WebhookAttempt" (
    "id" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "method" TEXT NOT NULL DEFAULT 'POST',
    "path" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "outcome" "WebhookAttemptOutcome" NOT NULL DEFAULT 'UNKNOWN_ERROR',
    "failureStage" "WebhookAttemptStage",
    "correlationId" TEXT,
    "sourceIp" TEXT,
    "authResult" TEXT,
    "notificationType" TEXT,
    "consignmentId" TEXT,
    "invoice" TEXT,
    "courierEvent" TEXT,
    "message" TEXT,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "WebhookAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookAttempt_courier_idx" ON "WebhookAttempt"("courier");

-- CreateIndex
CREATE INDEX "WebhookAttempt_receivedAt_idx" ON "WebhookAttempt"("receivedAt");

-- CreateIndex
CREATE INDEX "WebhookAttempt_outcome_idx" ON "WebhookAttempt"("outcome");

-- CreateIndex
CREATE INDEX "WebhookAttempt_correlationId_idx" ON "WebhookAttempt"("correlationId");

-- CreateIndex
CREATE INDEX "WebhookAttempt_courier_receivedAt_idx" ON "WebhookAttempt"("courier", "receivedAt");
