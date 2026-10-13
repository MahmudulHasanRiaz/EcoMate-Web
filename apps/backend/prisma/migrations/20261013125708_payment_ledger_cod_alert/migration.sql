-- NOTE: PhysicalInventoryLedger_reason_trgm_idx is intentionally managed by raw-SQL
-- migration 20261006090000_ledger_reason_trgm_index and excluded here (shadow-DB artifact).
-- NOTE: CREATE INDEX TaskTimeEntry_taskId_employeeId_idx backs schema @@index([taskId, employeeId]) (drift repair, intentional).
-- NOTE: ADD CONSTRAINT Order_returnOfOrderId_fkey backs schema self-relation on returnOfOrderId (drift repair, intentional).
-- AlterTable
ALTER TABLE "Dispatch" ADD COLUMN     "courierAmount" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "account" TEXT,
ADD COLUMN     "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "recordedBy" TEXT,
ADD COLUMN     "submittedBy" TEXT;

-- CreateTable
CREATE TABLE "CodMismatchAlert" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "consignmentId" TEXT NOT NULL,
    "courierAmount" DECIMAL(10,2) NOT NULL,
    "systemDue" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodMismatchAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCreditEntry" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "paymentId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerCreditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CodMismatchAlert_orderId_status_idx" ON "CodMismatchAlert"("orderId", "status");

-- CreateIndex
CREATE INDEX "CodMismatchAlert_consignmentId_idx" ON "CodMismatchAlert"("consignmentId");

-- CreateIndex
CREATE INDEX "CustomerCreditEntry_customerId_idx" ON "CustomerCreditEntry"("customerId");

-- CreateIndex
CREATE INDEX "CustomerCreditEntry_orderId_idx" ON "CustomerCreditEntry"("orderId");

-- CreateIndex
CREATE INDEX "CustomerCreditEntry_paymentId_idx" ON "CustomerCreditEntry"("paymentId");

-- CreateIndex
CREATE INDEX "TaskTimeEntry_taskId_employeeId_idx" ON "TaskTimeEntry"("taskId", "employeeId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_returnOfOrderId_fkey" FOREIGN KEY ("returnOfOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodMismatchAlert" ADD CONSTRAINT "CodMismatchAlert_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditEntry" ADD CONSTRAINT "CustomerCreditEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditEntry" ADD CONSTRAINT "CustomerCreditEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditEntry" ADD CONSTRAINT "CustomerCreditEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
