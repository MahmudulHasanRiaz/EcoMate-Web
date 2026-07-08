-- CreateEnum
CREATE TYPE "ManagedStockMovementType" AS ENUM ('INITIAL', 'ORDER_DEDUCTION', 'MANUAL_ADD', 'MANUAL_REMOVE', 'ADJUSTMENT', 'RETURN', 'CANCEL_RELEASE');
CREATE TYPE "MovementDirection" AS ENUM ('IN', 'OUT');
CREATE TYPE "ReferenceEntity" AS ENUM ('ORDER', 'ORDER_ITEM', 'RETURN', 'MANUAL', 'ADJUSTMENT', 'IMPORT');

-- Add new columns (if not exist already)
ALTER TABLE "ManagedStockLedger" ADD COLUMN IF NOT EXISTS "comboId" TEXT;
ALTER TABLE "ManagedStockLedger" ADD COLUMN IF NOT EXISTS "reason" TEXT;
ALTER TABLE "ManagedStockLedger" ADD COLUMN IF NOT EXISTS "performedById" TEXT;
ALTER TABLE "ManagedStockLedger" ADD COLUMN IF NOT EXISTS "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Migrate performedBy data to performedById if old column still exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ManagedStockLedger' AND column_name = 'performedBy') THEN
    UPDATE "ManagedStockLedger" SET "performedById" = "performedBy" WHERE "performedBy" IS NOT NULL;
    ALTER TABLE "ManagedStockLedger" DROP COLUMN "performedBy";
  END IF;
END $$;

-- Migrate createdAt data to performedAt if old column still exists and the new one is empty/different
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ManagedStockLedger' AND column_name = 'createdAt') THEN
    UPDATE "ManagedStockLedger" SET "performedAt" = "createdAt" WHERE "createdAt" IS NOT NULL;
    ALTER TABLE "ManagedStockLedger" DROP COLUMN "createdAt";
  END IF;
END $$;

-- Convert direction to enum
ALTER TABLE "ManagedStockLedger" ALTER COLUMN "direction" SET DATA TYPE "MovementDirection" USING "direction"::"MovementDirection";

-- Convert type to enum
ALTER TABLE "ManagedStockLedger" ALTER COLUMN "type" SET DATA TYPE "ManagedStockMovementType" USING "type"::"ManagedStockMovementType";

-- Convert referenceType to enum
ALTER TABLE "ManagedStockLedger" ALTER COLUMN "referenceType" SET DATA TYPE "ReferenceEntity" USING "referenceType"::"ReferenceEntity";

-- Make stockBefore/stockAfter optional
ALTER TABLE "ManagedStockLedger" ALTER COLUMN "stockBefore" DROP NOT NULL;
ALTER TABLE "ManagedStockLedger" ALTER COLUMN "stockAfter" DROP NOT NULL;

-- Update indexes
DROP INDEX IF EXISTS "ManagedStockLedger_productId_variantId_createdAt_idx";
CREATE INDEX IF NOT EXISTS "ManagedStockLedger_productId_variantId_performedAt_idx" ON "ManagedStockLedger"("productId", "variantId", "performedAt");
