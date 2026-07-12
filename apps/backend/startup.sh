#!/bin/sh

echo "[Startup] Running pre-migration schema fix via psql..."

# Direct DDL via psql — bypasses Prisma transaction issues
# Each statement is independent (psql autocommit per statement)
if [ -n "$DATABASE_URL" ]; then
  PSQL="psql $DATABASE_URL -v ON_ERROR_STOP=0 -q"

  echo "[Startup] Adding missing columns..."
  $PSQL -c 'ALTER TABLE "PhysicalInventoryLedger" ADD COLUMN IF NOT EXISTS "binLocationId" TEXT;' 2>&1 || true
  $PSQL -c 'ALTER TABLE "PhysicalInventoryLedger" ADD COLUMN IF NOT EXISTS "referenceType" "ReferenceEntity";' 2>&1 || true
  $PSQL -c 'ALTER TABLE "PhysicalInventoryLedger" ADD COLUMN IF NOT EXISTS "referenceId" TEXT;' 2>&1 || true
  $PSQL -c 'ALTER TABLE "PhysicalInventory" ADD COLUMN IF NOT EXISTS "binLocationId" TEXT;' 2>&1 || true
  $PSQL -c 'ALTER TABLE "GoodsReceiptNote" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT DEFAULT '"'"''"'"';' 2>&1 || true

  echo "[Startup] Creating tables if missing..."
  $PSQL -c 'CREATE TABLE IF NOT EXISTS "PhysicalReservation" (
    "id" TEXT NOT NULL, "orderId" TEXT NOT NULL, "orderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL, "variantId" TEXT, "warehouseId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT '"'"'ALLOCATING'"'"',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PhysicalReservation_pkey" PRIMARY KEY ("id")
  );' 2>&1 || true

  $PSQL -c 'CREATE TABLE IF NOT EXISTS "PhysicalReservationAllocation" (
    "id" TEXT NOT NULL, "reservationId" TEXT NOT NULL,
    "physicalInventoryId" TEXT NOT NULL, "binLocationId" TEXT, "quantity" INTEGER NOT NULL,
    CONSTRAINT "PhysicalReservationAllocation_pkey" PRIMARY KEY ("id")
  );' 2>&1 || true

  echo "[Startup] Creating indexes..."
  $PSQL -c 'CREATE UNIQUE INDEX IF NOT EXISTS "PhysicalReservation_orderItemId_key" ON "PhysicalReservation"("orderItemId");' 2>&1 || true
  $PSQL -c 'CREATE INDEX IF NOT EXISTS "PhysicalReservation_orderId_idx" ON "PhysicalReservation"("orderId");' 2>&1 || true
  $PSQL -c 'CREATE UNIQUE INDEX IF NOT EXISTS "PhysicalReservationAllocation_reservationId_physicalInventoryId_key" ON "PhysicalReservationAllocation"("reservationId", "physicalInventoryId");' 2>&1 || true
  $PSQL -c 'CREATE INDEX IF NOT EXISTS "PhysicalInventory_binLocationId_idx" ON "PhysicalInventory"("binLocationId");' 2>&1 || true
  $PSQL -c 'CREATE INDEX IF NOT EXISTS "PhysicalInventoryLedger_binLocationId_idx" ON "PhysicalInventoryLedger"("binLocationId");' 2>&1 || true
  $PSQL -c 'CREATE INDEX IF NOT EXISTS "PhysicalInventoryLedger_referenceType_referenceId_idx" ON "PhysicalInventoryLedger"("referenceType", "referenceId");' 2>&1 || true

  echo "[Startup] Adding foreign keys..."
  $PSQL -c 'DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '"'"'PhysicalInventory_binLocationId_fkey'"'"') THEN ALTER TABLE "PhysicalInventory" ADD CONSTRAINT "PhysicalInventory_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;' 2>&1 || true
  $PSQL -c 'DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '"'"'PhysicalInventoryLedger_binLocationId_fkey'"'"') THEN ALTER TABLE "PhysicalInventoryLedger" ADD CONSTRAINT "PhysicalInventoryLedger_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;' 2>&1 || true
  $PSQL -c 'DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '"'"'GoodsReceiptNote_warehouseId_fkey'"'"') THEN ALTER TABLE "GoodsReceiptNote" ADD CONSTRAINT "GoodsReceiptNote_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;' 2>&1 || true
  $PSQL -c 'DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '"'"'Product_defaultBinLocationId_fkey'"'"') THEN ALTER TABLE "Product" ADD CONSTRAINT "Product_defaultBinLocationId_fkey" FOREIGN KEY ("defaultBinLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;' 2>&1 || true
  $PSQL -c 'DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '"'"'ProductVariant_binLocationId_fkey'"'"') THEN ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;' 2>&1 || true
  $PSQL -c 'DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '"'"'PhysicalReservation_productId_fkey'"'"') THEN ALTER TABLE "PhysicalReservation" ADD CONSTRAINT "PhysicalReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;' 2>&1 || true
  $PSQL -c 'DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '"'"'PhysicalReservation_warehouseId_fkey'"'"') THEN ALTER TABLE "PhysicalReservation" ADD CONSTRAINT "PhysicalReservation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;' 2>&1 || true
  $PSQL -c 'DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '"'"'PhysicalReservationAllocation_reservationId_fkey'"'"') THEN ALTER TABLE "PhysicalReservationAllocation" ADD CONSTRAINT "PhysicalReservationAllocation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "PhysicalReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;' 2>&1 || true
  $PSQL -c 'DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '"'"'PhysicalReservationAllocation_physicalInventoryId_fkey'"'"') THEN ALTER TABLE "PhysicalReservationAllocation" ADD CONSTRAINT "PhysicalReservationAllocation_physicalInventoryId_fkey" FOREIGN KEY ("physicalInventoryId") REFERENCES "PhysicalInventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;' 2>&1 || true
  $PSQL -c 'DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '"'"'PhysicalReservationAllocation_binLocationId_fkey'"'"') THEN ALTER TABLE "PhysicalReservationAllocation" ADD CONSTRAINT "PhysicalReservationAllocation_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;' 2>&1 || true

  echo "[Startup] Pre-migration schema fix done."
fi

echo "[Startup] Running database migrations..."

max_retries=5
attempt=1

while [ $attempt -le $max_retries ]; do
  output=$(npx prisma migrate deploy 2>&1)
  exit_code=$?
  echo "$output"

  if [ $exit_code -eq 0 ]; then
    echo "[Startup] Migrations applied successfully"
    break
  fi

  # Extract migration name from P3018/P3009 error format:
  #   P3009: "The `20260625201147_add_accounting_integration` migration failed"
  #   P3018: "Migration name: 20260625201147_add_accounting_integration"
  #   Old:   "The migration `20260625201147_add_accounting_integration` was not applied"
  migration=$(echo "$output" | sed -n 's/.*The `\([^`]*\)` migration.*/\1/p' | head -1)
  if [ -z "$migration" ]; then
    migration=$(echo "$output" | sed -n 's/.*The migration `\([^`]*\)`.*/\1/p' | head -1)
  fi
  if [ -z "$migration" ]; then
    migration=$(echo "$output" | sed -n 's/.*Migration name: *\([^ ]*\).*/\1/p' | head -1)
  fi

  if [ -z "$migration" ]; then
    echo "[Startup] Could not parse migration name — cannot auto-resolve. Giving up."
    exit 1
  fi

  # P3018 = migration not applied but DB already has objects → mark as applied
  if echo "$output" | grep -q "P3018"; then
    echo "[Startup] P3018 — objects already exist, marking migration as applied: $migration"
    npx prisma migrate resolve --applied "$migration" 2>&1
  else
    echo "[Startup] Migration failed — marking as rolled back: $migration"
    npx prisma migrate resolve --rolled-back "$migration" 2>&1
  fi

  attempt=$((attempt + 1))
  [ $attempt -le $max_retries ] && echo "[Startup] Retrying migration (attempt $attempt/$max_retries)..."
done

if [ "$RUN_SEED" = "true" ]; then
  echo "[Startup] Running database seeding..."
  npx prisma db seed
fi

echo "[Startup] Starting server..."
exec node dist/src/main
