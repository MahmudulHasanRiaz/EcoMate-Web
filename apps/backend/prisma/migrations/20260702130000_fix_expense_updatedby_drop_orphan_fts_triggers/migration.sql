-- Drop orphaned FTS triggers (columns dropped but triggers/functions left behind)
DROP TRIGGER IF EXISTS trg_orders_fts ON "Order";
DROP TRIGGER IF EXISTS trg_products_fts ON "Product";
DROP TRIGGER IF EXISTS trg_users_fts ON "User";
DROP FUNCTION IF EXISTS orders_fts_update();
DROP FUNCTION IF EXISTS products_fts_update();
DROP FUNCTION IF EXISTS users_fts_update();

-- Add missing Expense.updatedBy column
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;

-- Add missing columns for accounting tables (defense-in-depth)
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;
ALTER TABLE "JournalEntryLine" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "JournalEntryLine" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "OpeningBalance" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "OpeningBalance" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
