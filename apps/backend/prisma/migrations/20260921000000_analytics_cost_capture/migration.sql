-- Analytics cost-capture fields (P2 data layer, §3.2). Additive only.
-- Order.shippingCost + shippingCostSource; Payment.feeAmount; ExpenseCategory.expenseKind.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shippingCost" DECIMAL(10,2),
ADD COLUMN     "shippingCostSource" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "feeAmount" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "expense_categories" ADD COLUMN     "expenseKind" TEXT NOT NULL DEFAULT 'unclassified';
