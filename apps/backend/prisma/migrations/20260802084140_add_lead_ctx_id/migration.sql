-- AlterTable
ALTER TABLE "CheckoutLead" ADD COLUMN     "ctxId" TEXT;

-- CreateIndex
CREATE INDEX "CheckoutLead_ctxId_idx" ON "CheckoutLead"("ctxId");
