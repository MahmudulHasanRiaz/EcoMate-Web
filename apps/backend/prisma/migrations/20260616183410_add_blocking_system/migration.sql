-- CreateTable
CREATE TABLE "BlockedIp" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "blockType" TEXT NOT NULL DEFAULT 'order',
    "reason" TEXT,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "whitelisted" BOOLEAN NOT NULL DEFAULT false,
    "autoBlocked" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockedIp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockedPhone" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "reason" TEXT,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "whitelisted" BOOLEAN NOT NULL DEFAULT false,
    "autoBlocked" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockedPhone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "data" JSONB NOT NULL,

    CONSTRAINT "BlockSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlockedIp_ip_key" ON "BlockedIp"("ip");

-- CreateIndex
CREATE UNIQUE INDEX "BlockedPhone_phone_key" ON "BlockedPhone"("phone");

-- CreateIndex
CREATE INDEX "BlockedPhone_phone_idx" ON "BlockedPhone"("phone");

-- CreateIndex
CREATE INDEX "BlockedPhone_isActive_idx" ON "BlockedPhone"("isActive");

-- CreateIndex
CREATE INDEX "CheckoutLead_fingerprint_idx" ON "CheckoutLead"("fingerprint");

-- CreateIndex
CREATE INDEX "CourierDispatchLog_orderId_idx" ON "CourierDispatchLog"("orderId");

-- CreateIndex
CREATE INDEX "CourierDispatchLog_courier_idx" ON "CourierDispatchLog"("courier");

-- CreateIndex
CREATE INDEX "InventoryLog_productId_variantId_createdAt_idx" ON "InventoryLog"("productId", "variantId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_courierService_idx" ON "Order"("courierService");

-- CreateIndex
CREATE INDEX "Order_courierConsignmentId_idx" ON "Order"("courierConsignmentId");

-- CreateIndex
CREATE INDEX "Order_courierTrackingCode_idx" ON "Order"("courierTrackingCode");

-- CreateIndex
CREATE INDEX "Order_paymentOptionType_idx" ON "Order"("paymentOptionType");

-- CreateIndex
CREATE INDEX "Payment_transactionId_idx" ON "Payment"("transactionId");

-- CreateIndex
CREATE INDEX "Product_sku_idx" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");
