-- Phase 1: Managed stock, availability modes, standard costing
-- Everything uses IF NOT EXISTS / ADD COLUMN IF NOT NULL → zero data loss

-- ==============================
-- 1. New enum: AvailabilityMode
-- ==============================
DO $$ BEGIN
    CREATE TYPE "AvailabilityMode" AS ENUM (
        'ALWAYS_IN_STOCK',
        'ALWAYS_OUT_OF_STOCK',
        'MANAGED_STOCK',
        'INVENTORY_CONTROLLED'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ==============================
-- 2. New columns on Product
-- ==============================
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "availabilityMode" "AvailabilityMode" NOT NULL DEFAULT 'MANAGED_STOCK';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "standardCost" DECIMAL(10,2);

-- ==============================
-- 3. New columns on ProductVariant
-- ==============================
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "standardCost" DECIMAL(10,2);

-- ==============================
-- 4. New columns on OrderItem
-- ==============================
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "costSnapshot" DECIMAL(10,2);
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "costType" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "costingLotId" TEXT;

-- ==============================
-- 5. New table: ManagedStockLedger
-- ==============================
CREATE TABLE IF NOT EXISTS "ManagedStockLedger" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "stockBefore" INTEGER NOT NULL,
    "stockAfter" INTEGER NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "note" TEXT,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManagedStockLedger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ManagedStockLedger_productId_variantId_createdAt_idx"
    ON "ManagedStockLedger" ("productId", "variantId", "createdAt");

CREATE INDEX IF NOT EXISTS "ManagedStockLedger_referenceType_referenceId_idx"
    ON "ManagedStockLedger" ("referenceType", "referenceId");
