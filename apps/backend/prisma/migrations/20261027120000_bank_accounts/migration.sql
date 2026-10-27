-- Bank (manual) gateway receiving accounts (NPSB payment instructions).
-- DDL-only: new table only, no data changes. The BankAccountType enum
-- already exists (employee bank accounts) and is reused, not recreated.
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "routingNumber" TEXT NOT NULL,
    "accountType" "BankAccountType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BankAccount_gatewayId_idx" ON "BankAccount"("gatewayId");

ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "PaymentGateway"("id") ON DELETE CASCADE ON UPDATE CASCADE;
