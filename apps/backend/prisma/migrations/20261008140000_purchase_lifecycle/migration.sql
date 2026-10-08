-- Purchase lifecycle dispositions: short-close, damage responsibility,
-- per-line GRN warehouse, audit events, atomic PO numbering.
-- Purely additive: no drops, no data rewrites.

-- AlterEnum
ALTER TYPE "ManagedStockMovementType" ADD VALUE 'PURCHASE_RECEIVE';

-- AlterEnum
ALTER TYPE "ReferenceEntity" ADD VALUE 'PURCHASE';

-- AlterTable
ALTER TABLE "PurchaseItem" ADD COLUMN "shortCloseReason" TEXT,
ADD COLUMN "shortClosedQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "GoodsReceiptNoteItem" ADD COLUMN "damageResponsibility" TEXT NOT NULL DEFAULT 'supplier',
ADD COLUMN "freeOfCharge" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lineWarehouseId" TEXT;

-- CreateTable
CREATE TABLE "PurchaseEvent" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseCounter" (
    "date" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "PurchaseCounter_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE INDEX "PurchaseEvent_purchaseId_idx" ON "PurchaseEvent"("purchaseId");

-- CreateIndex
CREATE INDEX "PurchaseEvent_createdAt_idx" ON "PurchaseEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "PurchaseEvent" ADD CONSTRAINT "PurchaseEvent_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
