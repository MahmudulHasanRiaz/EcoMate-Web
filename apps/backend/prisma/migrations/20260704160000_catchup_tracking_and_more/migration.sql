-- DropIndex
DROP INDEX IF EXISTS "public"."User_lastIp_idx";

-- AlterTable
ALTER TABLE "public"."JournalEntry" ADD COLUMN IF NOT EXISTS "expense" TEXT;

-- AlterTable
ALTER TABLE "public"."Order" ADD COLUMN IF NOT EXISTS "packingLock" TEXT,
ADD COLUMN IF NOT EXISTS "shipment" TEXT;

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN IF NOT EXISTS "settings" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."TrackingEvent" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "eventId" TEXT NOT NULL,
    "orderId" TEXT,
    "eventType" TEXT NOT NULL,
    "platform" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "fbp" TEXT,
    "fbc" TEXT,
    "url" TEXT,
    "referrer" TEXT,
    "payload" TEXT,
    "response" TEXT,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TrackingEvent_createdAt_idx" ON "public"."TrackingEvent"("createdAt" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TrackingEvent_eventId_idx" ON "public"."TrackingEvent"("eventId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TrackingEvent_eventId_key" ON "public"."TrackingEvent"("eventId" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TrackingEvent_orderId_idx" ON "public"."TrackingEvent"("orderId" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TrackingEvent_status_idx" ON "public"."TrackingEvent"("status" ASC);
