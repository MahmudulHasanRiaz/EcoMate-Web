-- AlterTable: add columns for POS transfer requests
ALTER TABLE "StockTransfer" ADD COLUMN "orderId" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN "requestedBy" TEXT;

-- Change default status from 'PENDING' to 'REQUESTED'
ALTER TABLE "StockTransfer" ALTER COLUMN "status" SET DEFAULT 'REQUESTED';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StockTransfer_orderId_idx" ON "StockTransfer"("orderId");

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;