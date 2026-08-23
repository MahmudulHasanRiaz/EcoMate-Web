-- HR Phase 5: commission engine (rules + earnings) with idempotent
-- order-driven evaluation. No new Order statuses; default trigger resolves
-- to the existing 'Confirmed' OrderStatus at runtime.
CREATE TYPE "CommissionAmountType" AS ENUM ('fixed', 'percent');

CREATE TABLE "CommissionRule" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" TEXT NOT NULL,
    "triggerStatusId" TEXT,
    "amountType" "CommissionAmountType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "valueBasis" TEXT NOT NULL DEFAULT 'order_total',
    "minOrderAmount" DECIMAL(10,2),
    "capPerOrder" DECIMAL(10,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CommissionRule_employeeId_isActive_idx" ON "CommissionRule"("employeeId", "isActive");
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_triggerStatusId_fkey" FOREIGN KEY ("triggerStatusId") REFERENCES "OrderStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CommissionEarning" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "LedgerStatus" NOT NULL DEFAULT 'approved',
    "payslipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommissionEarning_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommissionEarning_orderId_ruleId_key" ON "CommissionEarning"("orderId", "ruleId");
CREATE INDEX "CommissionEarning_employeeId_createdAt_idx" ON "CommissionEarning"("employeeId", "createdAt");
ALTER TABLE "CommissionEarning" ADD CONSTRAINT "CommissionEarning_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionEarning" ADD CONSTRAINT "CommissionEarning_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CommissionRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionEarning" ADD CONSTRAINT "CommissionEarning_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
