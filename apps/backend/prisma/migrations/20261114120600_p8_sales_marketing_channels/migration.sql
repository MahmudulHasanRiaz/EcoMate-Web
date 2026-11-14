-- Central Commerce P8 — Sales/Marketing channel migration (§9, BR-18).
-- Additive only: TWO new enums + THREE nullable columns on Order. Legacy
-- salesChannel/source* stay and keep being written (dual-write); no drops,
-- no renames, no enum values removed or repurposed.
-- salesChannelType = ONLINE/OFFLINE (NULL = not yet backfilled).
-- showroomId = FK Warehouse(type='showroom') for OFFLINE showroom sales
--   (NULL = no showroom; ON DELETE SET NULL).
-- marketingChannel = independent platform-attribution dimension (NULL = none;
--   CALL/PHONE/DIRECT never yield a marketing channel, so CALL is not a member).

-- CreateEnum
CREATE TYPE "SalesChannelType" AS ENUM ('ONLINE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "MarketingChannel" AS ENUM ('FACEBOOK', 'MESSENGER', 'INSTAGRAM', 'INSTAGRAM_INBOX', 'TIKTOK', 'TIKTOK_INBOX', 'WHATSAPP', 'THREADS', 'OTHER');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "salesChannelType" "SalesChannelType",
ADD COLUMN "showroomId" TEXT,
ADD COLUMN "marketingChannel" "MarketingChannel";

-- CreateIndex
CREATE INDEX "Order_salesChannelType_idx" ON "Order"("salesChannelType");

-- CreateIndex
CREATE INDEX "Order_showroomId_idx" ON "Order"("showroomId");

-- CreateIndex
CREATE INDEX "Order_marketingChannel_idx" ON "Order"("marketingChannel");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_showroomId_fkey" FOREIGN KEY ("showroomId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
