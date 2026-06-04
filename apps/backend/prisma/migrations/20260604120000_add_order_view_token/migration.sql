-- AlterTable
ALTER TABLE "Order" ADD COLUMN "viewToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_viewToken_key" ON "Order"("viewToken");
