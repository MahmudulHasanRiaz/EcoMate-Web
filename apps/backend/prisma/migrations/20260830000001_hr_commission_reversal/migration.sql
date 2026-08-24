CREATE TABLE "CommissionReversal" (
    "id" TEXT NOT NULL,
    "commissionEarningId" TEXT NOT NULL,
    "orderId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "refundedAmount" DECIMAL(10,2),
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionReversal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CommissionReversal_commissionEarningId_idx" ON "CommissionReversal"("commissionEarningId");
CREATE UNIQUE INDEX "CommissionReversal_earning_order_key" ON "CommissionReversal"("commissionEarningId", "orderId") WHERE "orderId" IS NOT NULL;
ALTER TABLE "CommissionReversal" ADD CONSTRAINT "CommissionReversal_commissionEarningId_fkey" FOREIGN KEY ("commissionEarningId") REFERENCES "CommissionEarning"("id") ON DELETE CASCADE ON UPDATE CASCADE;
