-- Recovery migration: complete any missing objects from the previous partial migration
-- This is safe to run multiple times (idempotent)

-- Ensure PhysicalInventory has binLocationId column
DO $$ BEGIN
  ALTER TABLE "PhysicalInventory" ADD COLUMN "binLocationId" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Ensure PhysicalInventoryLedger has referenceType and referenceId
DO $$ BEGIN
  ALTER TABLE "PhysicalInventoryLedger" ADD COLUMN "referenceType" "ReferenceEntity";
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PhysicalInventoryLedger" ADD COLUMN "referenceId" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Ensure GoodsReceiptNote has warehouseId
DO $$ BEGIN
  ALTER TABLE "GoodsReceiptNote" ADD COLUMN "warehouseId" TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Ensure tables exist
CREATE TABLE IF NOT EXISTS "PhysicalReservation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ALLOCATING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PhysicalReservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PhysicalReservationAllocation" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "physicalInventoryId" TEXT NOT NULL,
    "binLocationId" TEXT,
    "quantity" INTEGER NOT NULL,
    CONSTRAINT "PhysicalReservationAllocation_pkey" PRIMARY KEY ("id")
);

-- Ensure all indexes exist
CREATE UNIQUE INDEX IF NOT EXISTS "PhysicalReservation_orderItemId_key" ON "PhysicalReservation"("orderItemId");
CREATE INDEX IF NOT EXISTS "PhysicalReservation_orderId_idx" ON "PhysicalReservation"("orderId");
CREATE INDEX IF NOT EXISTS "PhysicalReservation_status_idx" ON "PhysicalReservation"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "PhysicalReservationAllocation_reservationId_physicalInventoryId_key" ON "PhysicalReservationAllocation"("reservationId", "physicalInventoryId");
CREATE INDEX IF NOT EXISTS "PhysicalReservationAllocation_reservationId_idx" ON "PhysicalReservationAllocation"("reservationId");
CREATE INDEX IF NOT EXISTS "PhysicalReservationAllocation_physicalInventoryId_idx" ON "PhysicalReservationAllocation"("physicalInventoryId");
CREATE INDEX IF NOT EXISTS "PhysicalReservationAllocation_binLocationId_idx" ON "PhysicalReservationAllocation"("binLocationId");
CREATE INDEX IF NOT EXISTS "PhysicalInventory_binLocationId_idx" ON "PhysicalInventory"("binLocationId");
CREATE INDEX IF NOT EXISTS "PhysicalInventoryLedger_binLocationId_idx" ON "PhysicalInventoryLedger"("binLocationId");
CREATE INDEX IF NOT EXISTS "PhysicalInventoryLedger_referenceType_referenceId_idx" ON "PhysicalInventoryLedger"("referenceType", "referenceId");

-- Ensure all foreign keys exist
DO $$ BEGIN
  ALTER TABLE "PhysicalInventory" ADD CONSTRAINT "PhysicalInventory_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PhysicalInventoryLedger" ADD CONSTRAINT "PhysicalInventoryLedger_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "GoodsReceiptNote" ADD CONSTRAINT "GoodsReceiptNote_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Product" ADD CONSTRAINT "Product_defaultBinLocationId_fkey" FOREIGN KEY ("defaultBinLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PhysicalReservation" ADD CONSTRAINT "PhysicalReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PhysicalReservation" ADD CONSTRAINT "PhysicalReservation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PhysicalReservationAllocation" ADD CONSTRAINT "PhysicalReservationAllocation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "PhysicalReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PhysicalReservationAllocation" ADD CONSTRAINT "PhysicalReservationAllocation_physicalInventoryId_fkey" FOREIGN KEY ("physicalInventoryId") REFERENCES "PhysicalInventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PhysicalReservationAllocation" ADD CONSTRAINT "PhysicalReservationAllocation_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
