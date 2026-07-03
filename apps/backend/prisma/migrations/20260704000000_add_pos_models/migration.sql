-- CreateEnum
CREATE TYPE "WarehouseType" AS ENUM ('main', 'showroom', 'storage');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('POS', 'ECOMMERCE', 'MANUAL');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('CALL', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'MESSENGER', 'WHATSAPP', 'THREADS', 'WALK_IN', 'WEBSITE', 'OTHER');

-- CreateEnum
CREATE TYPE "PosSessionStatus" AS ENUM ('open', 'closed', 'cancelled');

-- DropIndex
DROP INDEX "NotificationSetting_channel_type_key";

-- AlterTable
ALTER TABLE "JournalEntryLine" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "OpeningBalance" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "posSessionId" TEXT,
ADD COLUMN     "salesChannel" "SalesChannel",
ADD COLUMN     "source" "OrderSource" DEFAULT 'ECOMMERCE';

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "type" "WarehouseType" NOT NULL DEFAULT 'main';

-- CreateTable
CREATE TABLE "PosSession" (
    "id" TEXT NOT NULL,
    "showroomId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "openingBalance" DECIMAL(10,2) NOT NULL,
    "closingBalance" DECIMAL(10,2),
    "expectedBalance" DECIMAL(10,2),
    "status" "PosSessionStatus" NOT NULL DEFAULT 'open',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeldCart" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "customerId" TEXT,
    "guestName" TEXT,
    "guestPhone" TEXT,
    "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discountType" TEXT NOT NULL DEFAULT 'flat',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeldCart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosSession_showroomId_idx" ON "PosSession"("showroomId");

-- CreateIndex
CREATE INDEX "PosSession_cashierId_idx" ON "PosSession"("cashierId");

-- CreateIndex
CREATE INDEX "PosSession_status_idx" ON "PosSession"("status");

-- CreateIndex
CREATE INDEX "HeldCart_sessionId_idx" ON "HeldCart"("sessionId");

-- CreateIndex
CREATE INDEX "HeldCart_cashierId_idx" ON "HeldCart"("cashierId");

-- CreateIndex
CREATE INDEX "Address_userId_isDefault_createdAt_idx" ON "Address"("userId", "isDefault", "createdAt");

-- CreateIndex
CREATE INDEX "BlockedIp_blockType_isActive_whitelisted_idx" ON "BlockedIp"("blockType", "isActive", "whitelisted");

-- CreateIndex
CREATE INDEX "BlockedIp_isActive_autoBlocked_idx" ON "BlockedIp"("isActive", "autoBlocked");

-- CreateIndex
CREATE INDEX "BlockedIp_isActive_expiresAt_idx" ON "BlockedIp"("isActive", "expiresAt");

-- CreateIndex
CREATE INDEX "BlockedPhone_phone_isActive_whitelisted_idx" ON "BlockedPhone"("phone", "isActive", "whitelisted");

-- CreateIndex
CREATE INDEX "BlockedPhone_isActive_autoBlocked_idx" ON "BlockedPhone"("isActive", "autoBlocked");

-- CreateIndex
CREATE INDEX "BlockedPhone_isActive_expiresAt_idx" ON "BlockedPhone"("isActive", "expiresAt");

-- CreateIndex
CREATE INDEX "CmsPage_isActive_showInFooter_idx" ON "CmsPage"("isActive", "showInFooter");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSetting_channel_type_key" ON "NotificationSetting"("channel", "type");

-- CreateIndex
CREATE INDEX "Order_posSessionId_idx" ON "Order"("posSessionId");

-- CreateIndex
CREATE INDEX "Order_source_idx" ON "Order"("source");

-- CreateIndex
CREATE INDEX "Order_salesChannel_idx" ON "Order"("salesChannel");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "OrderItem_variantId_idx" ON "OrderItem"("variantId");

-- CreateIndex
CREATE INDEX "OrderItem_comboId_idx" ON "OrderItem"("comboId");

-- CreateIndex
CREATE INDEX "Product_type_idx" ON "Product"("type");

-- CreateIndex
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "Task_createdById_idx" ON "Task"("createdById");

-- CreateIndex
CREATE INDEX "Task_assignee_idx" ON "Task"("assignee");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_phoneNumber_idx" ON "User"("phoneNumber");

-- AddForeignKey
ALTER TABLE "PosSession" ADD CONSTRAINT "PosSession_showroomId_fkey" FOREIGN KEY ("showroomId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSession" ADD CONSTRAINT "PosSession_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_posSessionId_fkey" FOREIGN KEY ("posSessionId") REFERENCES "PosSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

