-- Central Commerce P6 — Order ingestion (§8.5, BR-11/BR-12/BR-13/BR-16/BR-17).
-- Additive only: provenance columns on Order + two store-scoped identity maps.
-- Identity is DB-enforced (BR-12): StoreOrderMapping @@unique([storeId,
-- externalOrderId]) + Order.idempotencyKey 'store:{storeId}:order:{externalId}'.
-- ingestFlags is operational visibility only — never blocks ingestion or any
-- later transition (BR-13/BR-15). Totals/items/prices immutable after ingest
-- (BR-17); only status + storeMetadata are mutable from the store side.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "externalOrderId" TEXT,
ADD COLUMN "ingestFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "storeId" TEXT,
ADD COLUMN "storeMetadata" JSONB;

-- CreateTable
CREATE TABLE "StoreOrderMapping" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lastExternalStatus" TEXT,
    "externalUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreOrderMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreOrderStatusMap" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "externalStatus" TEXT NOT NULL,
    "internalStatusName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreOrderStatusMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreOrderMapping_orderId_key" ON "StoreOrderMapping"("orderId");

-- CreateIndex
CREATE INDEX "StoreOrderMapping_storeId_idx" ON "StoreOrderMapping"("storeId");

-- CreateIndex
CREATE INDEX "StoreOrderMapping_orderId_idx" ON "StoreOrderMapping"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreOrderMapping_storeId_externalOrderId_key" ON "StoreOrderMapping"("storeId", "externalOrderId");

-- CreateIndex
CREATE INDEX "StoreOrderStatusMap_storeId_idx" ON "StoreOrderStatusMap"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreOrderStatusMap_storeId_externalStatus_key" ON "StoreOrderStatusMap"("storeId", "externalStatus");

-- CreateIndex
CREATE INDEX "Order_storeId_idx" ON "Order"("storeId");

-- CreateIndex
CREATE INDEX "Order_externalOrderId_idx" ON "Order"("externalOrderId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOrderMapping" ADD CONSTRAINT "StoreOrderMapping_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOrderMapping" ADD CONSTRAINT "StoreOrderMapping_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOrderStatusMap" ADD CONSTRAINT "StoreOrderStatusMap_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
