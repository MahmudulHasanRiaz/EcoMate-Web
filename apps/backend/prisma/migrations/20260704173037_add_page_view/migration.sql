/*
  Warnings:

  - You are about to drop the column `expense` on the `JournalEntry` table. All the data in the column will be lost.
  - You are about to drop the column `packingLock` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `shipment` on the `Order` table. All the data in the column will be lost.
  - The `payload` column on the `TrackingEvent` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `response` column on the `TrackingEvent` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `settings` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "JournalEntry" DROP COLUMN "expense";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "packingLock",
DROP COLUMN "shipment";

-- AlterTable
ALTER TABLE "TrackingEvent" ALTER COLUMN "id" DROP DEFAULT,
DROP COLUMN "payload",
ADD COLUMN     "payload" JSONB,
DROP COLUMN "response",
ADD COLUMN     "response" JSONB;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "settings";

-- CreateTable
CREATE TABLE "PageView" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "referrer" TEXT,
    "source" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "sessionId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PageView_timestamp_sessionId_idx" ON "PageView"("timestamp", "sessionId");

-- CreateIndex
CREATE INDEX "PageView_source_timestamp_idx" ON "PageView"("source", "timestamp");
