-- Expense provenance for system-posted compensation costs.
-- sourceType/sourceId are unique so re-running payroll finalisation or
-- commission accrual never duplicates an expense. Reversals post a separate
-- negative row with a `<sourceType>_reversal` marker (prior periods are never
-- rewritten).
ALTER TABLE "Expense" ADD COLUMN "sourceType" TEXT;
ALTER TABLE "Expense" ADD COLUMN "sourceId" TEXT;

CREATE UNIQUE INDEX "Expense_sourceType_sourceId_key"
  ON "Expense"("sourceType", "sourceId");

-- Dedicated category for commission accruals so salary and commission costs
-- stay separable in Operating Expenses. Idempotent seed.
INSERT INTO "expense_categories"
  ("id", "name", "slug", "description", "color", "expenseKind", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT
  'cat-commissions', 'Commissions', 'commissions',
  'Sales and performance commissions', '#8B5CF6', 'variable', true, 60, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "expense_categories" WHERE "slug" = 'commissions'
);
