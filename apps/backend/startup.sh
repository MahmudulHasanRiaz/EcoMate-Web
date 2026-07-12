#!/bin/sh

echo "[Startup] Running pre-migration schema fix..."

# Use prisma db execute for DDL — works in Alpine without psql
# Each statement in its own file for atomic execution
cat > /tmp/schema_fix.sql << 'SQLEOF'
ALTER TABLE "PhysicalInventoryLedger" ADD COLUMN IF NOT EXISTS "binLocationId" TEXT;
ALTER TABLE "PhysicalInventoryLedger" ADD COLUMN IF NOT EXISTS "referenceType" "ReferenceEntity";
ALTER TABLE "PhysicalInventoryLedger" ADD COLUMN IF NOT EXISTS "referenceId" TEXT;
ALTER TABLE "PhysicalInventory" ADD COLUMN IF NOT EXISTS "binLocationId" TEXT;
ALTER TABLE "GoodsReceiptNote" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT DEFAULT '';
SQLEOF

npx prisma db execute --file /tmp/schema_fix.sql 2>&1 || echo "[Startup] Column fix skipped (may already exist)"

cat > /tmp/schema_fix2.sql << 'SQLEOF'
CREATE TABLE IF NOT EXISTS "PhysicalReservation" (
  "id" TEXT NOT NULL, "orderId" TEXT NOT NULL, "orderItemId" TEXT NOT NULL,
  "productId" TEXT NOT NULL, "variantId" TEXT, "warehouseId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'ALLOCATING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PhysicalReservation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "PhysicalReservationAllocation" (
  "id" TEXT NOT NULL, "reservationId" TEXT NOT NULL,
  "physicalInventoryId" TEXT NOT NULL, "binLocationId" TEXT, "quantity" INTEGER NOT NULL,
  CONSTRAINT "PhysicalReservationAllocation_pkey" PRIMARY KEY ("id")
);
SQLEOF

npx prisma db execute --file /tmp/schema_fix2.sql 2>&1 || echo "[Startup] Table creation skipped (may already exist)"

cat > /tmp/schema_fix3.sql << 'SQLEOF'
CREATE UNIQUE INDEX IF NOT EXISTS "PhysicalReservation_orderItemId_key" ON "PhysicalReservation"("orderItemId");
CREATE INDEX IF NOT EXISTS "PhysicalReservation_orderId_idx" ON "PhysicalReservation"("orderId");
CREATE UNIQUE INDEX IF NOT EXISTS "PhysicalReservationAllocation_reservationId_physicalInventoryId_key" ON "PhysicalReservationAllocation"("reservationId", "physicalInventoryId");
CREATE INDEX IF NOT EXISTS "PhysicalInventory_binLocationId_idx" ON "PhysicalInventory"("binLocationId");
CREATE INDEX IF NOT EXISTS "PhysicalInventoryLedger_binLocationId_idx" ON "PhysicalInventoryLedger"("binLocationId");
CREATE INDEX IF NOT EXISTS "PhysicalInventoryLedger_referenceType_referenceId_idx" ON "PhysicalInventoryLedger"("referenceType", "referenceId");
SQLEOF

npx prisma db execute --file /tmp/schema_fix3.sql 2>&1 || echo "[Startup] Index creation skipped (may already exist)"

echo "[Startup] Pre-migration schema fix done."

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
