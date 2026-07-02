-- Create Warehouse and BinLocation tables if they don't exist.
-- These were added via db push in an earlier session and never captured
-- in a migration. This migration is idempotent (IF NOT EXISTS throughout).

CREATE TABLE IF NOT EXISTS "Warehouse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Bangladesh',
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Warehouse_slug_key" ON "Warehouse"("slug");
CREATE INDEX IF NOT EXISTS "Warehouse_isActive_idx" ON "Warehouse"("isActive");

CREATE TABLE IF NOT EXISTS "BinLocation" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "zone" TEXT,
    "rack" TEXT,
    "shelf" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BinLocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BinLocation_warehouseId_idx" ON "BinLocation"("warehouseId");
CREATE UNIQUE INDEX IF NOT EXISTS "BinLocation_warehouseId_code_key" ON "BinLocation"("warehouseId", "code");

-- Now add the FK constraints that previously failed because Warehouse didn't exist
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BinLocation_warehouseId_fkey') THEN
        ALTER TABLE "BinLocation" ADD CONSTRAINT "BinLocation_warehouseId_fkey"
            FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
