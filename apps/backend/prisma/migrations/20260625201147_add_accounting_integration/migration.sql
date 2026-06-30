-- AddForeignKey (safe: DO block handles duplicate columns)
DO $$ BEGIN
    ALTER TABLE "expense_categories" ADD COLUMN "accountId" TEXT;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "Expense" ADD COLUMN "paymentAccountId" TEXT;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "Expense" ADD COLUMN "journalEntryId" TEXT;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

-- Audit trail fields (safe)
DO $$ BEGIN
    ALTER TABLE "Account" ADD COLUMN "createdBy" TEXT;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "Account" ADD COLUMN "updatedBy" TEXT;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "JournalEntry" ADD COLUMN "createdBy" TEXT;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "JournalEntry" ADD COLUMN "updatedBy" TEXT;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

-- Timestamps on missing models (safe)
DO $$ BEGIN
    ALTER TABLE "JournalEntryLine" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "JournalEntryLine" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "OpeningBalance" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "OpeningBalance" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

-- Indexes & FK (safe)
CREATE INDEX IF NOT EXISTS "expense_categories_accountId_idx" ON "expense_categories"("accountId");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_categories_accountId_fkey') THEN
        ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Expense_paymentAccountId_idx" ON "Expense"("paymentAccountId");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Expense_paymentAccountId_fkey') THEN
        ALTER TABLE "Expense" ADD CONSTRAINT "Expense_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Expense_journalEntryId_key" ON "Expense"("journalEntryId");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Expense_journalEntryId_fkey') THEN
        ALTER TABLE "Expense" ADD CONSTRAINT "Expense_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Seed default accounting enabled setting (disabled by default)
INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
SELECT 'accounting_enabled', 'false', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "SystemSetting" WHERE "key" = 'accounting_enabled');
