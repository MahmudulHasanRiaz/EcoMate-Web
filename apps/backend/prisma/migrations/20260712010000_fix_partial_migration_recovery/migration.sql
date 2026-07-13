-- Final recovery migration: each DDL in independent DO block for safe partial-state handling
-- Prisma runs migrations in a single transaction, so we wrap each critical DDL
-- in its own DO block with explicit existence checks to prevent rollback cascades.

-- ============================================================
-- 1. PhysicalInventory: add binLocationId
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'PhysicalInventory' AND column_name = 'binLocationId') THEN
    ALTER TABLE "PhysicalInventory" ADD COLUMN "binLocationId" TEXT;
  END IF;
END $$;

-- ============================================================
-- 2. PhysicalInventoryLedger: add referenceType, referenceId
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'PhysicalInventoryLedger' AND column_name = 'referenceType') THEN
    ALTER TABLE "PhysicalInventoryLedger" ADD COLUMN "referenceType" "ReferenceEntity";
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'PhysicalInventoryLedger' AND column_name = 'referenceId') THEN
    ALTER TABLE "PhysicalInventoryLedger" ADD COLUMN "referenceId" TEXT;
  END IF;
END $$;

-- ============================================================
-- 3. GoodsReceiptNote: add warehouseId
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'GoodsReceiptNote' AND column_name = 'warehouseId') THEN
    ALTER TABLE "GoodsReceiptNote" ADD COLUMN "warehouseId" TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

-- ============================================================
-- 4. PhysicalReservation table
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'PhysicalReservation') THEN
    CREATE TABLE "PhysicalReservation" (
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
  END IF;
END $$;

-- ============================================================
-- 5. PhysicalReservationAllocation table
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'PhysicalReservationAllocation') THEN
    CREATE TABLE "PhysicalReservationAllocation" (
      "id" TEXT NOT NULL,
      "reservationId" TEXT NOT NULL,
      "physicalInventoryId" TEXT NOT NULL,
      "binLocationId" TEXT,
      "quantity" INTEGER NOT NULL,
      CONSTRAINT "PhysicalReservationAllocation_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

-- ============================================================
-- 6. Indexes (all IF NOT EXISTS)
-- ============================================================
CREATE INDEX IF NOT EXISTS "PhysicalReservation_orderItemId_key" ON "PhysicalReservation"("orderItemId");
CREATE INDEX IF NOT EXISTS "PhysicalReservation_orderId_idx" ON "PhysicalReservation"("orderId");
CREATE INDEX IF NOT EXISTS "PhysicalReservation_status_idx" ON "PhysicalReservation"("status");
CREATE INDEX IF NOT EXISTS "PhysicalReservationAllocation_reservationId_physicalInventoryId_key" ON "PhysicalReservationAllocation"("reservationId", "physicalInventoryId");
CREATE INDEX IF NOT EXISTS "PhysicalReservationAllocation_reservationId_idx" ON "PhysicalReservationAllocation"("reservationId");
CREATE INDEX IF NOT EXISTS "PhysicalReservationAllocation_physicalInventoryId_idx" ON "PhysicalReservationAllocation"("physicalInventoryId");
CREATE INDEX IF NOT EXISTS "PhysicalReservationAllocation_binLocationId_idx" ON "PhysicalReservationAllocation"("binLocationId");
CREATE INDEX IF NOT EXISTS "PhysicalInventory_binLocationId_idx" ON "PhysicalInventory"("binLocationId");
CREATE INDEX IF NOT EXISTS "PhysicalInventoryLedger_referenceType_referenceId_idx" ON "PhysicalInventoryLedger"("referenceType", "referenceId");

-- ============================================================
-- 7. Foreign keys (all with exception handling)
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PhysicalInventory_binLocationId_fkey') THEN
    ALTER TABLE "PhysicalInventory" ADD CONSTRAINT "PhysicalInventory_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoodsReceiptNote_warehouseId_fkey') THEN
    ALTER TABLE "GoodsReceiptNote" ADD CONSTRAINT "GoodsReceiptNote_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_defaultBinLocationId_fkey') THEN
    ALTER TABLE "Product" ADD CONSTRAINT "Product_defaultBinLocationId_fkey" FOREIGN KEY ("defaultBinLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductVariant_binLocationId_fkey') THEN
    ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PhysicalReservation_productId_fkey') THEN
    ALTER TABLE "PhysicalReservation" ADD CONSTRAINT "PhysicalReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PhysicalReservation_warehouseId_fkey') THEN
    ALTER TABLE "PhysicalReservation" ADD CONSTRAINT "PhysicalReservation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PhysicalReservationAllocation_reservationId_fkey') THEN
    ALTER TABLE "PhysicalReservationAllocation" ADD CONSTRAINT "PhysicalReservationAllocation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "PhysicalReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PhysicalReservationAllocation_physicalInventoryId_fkey') THEN
    ALTER TABLE "PhysicalReservationAllocation" ADD CONSTRAINT "PhysicalReservationAllocation_physicalInventoryId_fkey" FOREIGN KEY ("physicalInventoryId") REFERENCES "PhysicalInventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PhysicalReservationAllocation_binLocationId_fkey') THEN
    ALTER TABLE "PhysicalReservationAllocation" ADD CONSTRAINT "PhysicalReservationAllocation_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
