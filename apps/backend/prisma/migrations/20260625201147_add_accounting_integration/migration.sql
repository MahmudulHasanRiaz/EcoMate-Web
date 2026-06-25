-- AddForeignKey
ALTER TABLE "expense_categories" ADD COLUMN "accountId" TEXT;
ALTER TABLE "Expense" ADD COLUMN "paymentAccountId" TEXT;
ALTER TABLE "Expense" ADD COLUMN "journalEntryId" TEXT;

-- Audit trail fields
ALTER TABLE "Account" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "Account" ADD COLUMN "updatedBy" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN "updatedBy" TEXT;

-- Timestamps on missing models
ALTER TABLE "JournalEntryLine" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "JournalEntryLine" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "OpeningBalance" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "OpeningBalance" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Indexes & FK
CREATE INDEX IF NOT EXISTS "expense_categories_accountId_idx" ON "expense_categories"("accountId");
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Expense_paymentAccountId_idx" ON "Expense"("paymentAccountId");
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "Expense_journalEntryId_key" ON "Expense"("journalEntryId");
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default accounting enabled setting (disabled by default)
INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
SELECT 'accounting_enabled', 'false', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "SystemSetting" WHERE "key" = 'accounting_enabled');
