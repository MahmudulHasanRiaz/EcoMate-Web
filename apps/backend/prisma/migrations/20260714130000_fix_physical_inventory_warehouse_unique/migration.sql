-- PhysicalInventory duplicate audit for warehouse-level rows (binLocationId IS NULL)
-- PostgreSQL 16 treats NULLs as distinct in unique constraints, so
-- @@unique([productId, variantId, warehouseId, binLocationId]) allows
-- multiple rows where binLocationId IS NULL for the same
-- (productId, variantId, warehouseId).
--
-- This migration adds a partial unique index that enforces uniqueness
-- for warehouse-level rows.  If duplicates already exist, the DO block
-- raises an exception listing them — resolve manually before applying.
--
-- For binned rows (binLocationId IS NOT NULL), the existing @@unique
-- constraint continues to provide correct protection.

DO $$
DECLARE
  r RECORD;
  n INTEGER := 0;
  dups TEXT[] := '{}';
BEGIN
  FOR r IN
    SELECT "productId", "variantId", "warehouseId", COUNT(*) AS cnt
    FROM "PhysicalInventory"
    WHERE "binLocationId" IS NULL
    GROUP BY "productId", "variantId", "warehouseId"
    HAVING COUNT(*) > 1
  LOOP
    n := n + 1;
    dups := array_append(
      dups,
      format(
        '[%s] productId=%s, variantId=%s, warehouseId=%s → %s rows',
        n, r."productId", COALESCE(r."variantId", 'NULL'), r."warehouseId", r.cnt
      )
    );
  END LOOP;

  IF n > 0 THEN
    RAISE EXCEPTION 'Found % duplicate warehouse-level PhysicalInventory row set(s). Resolve before applying partial unique index.% E',
      n, E'\n' || array_to_string(dups, E'\n');
  END IF;
END;
$$;

-- Partial unique index for warehouse-level rows.
-- COALESCE handles variantId NULL (simple products) — PostgreSQL treats
-- NULLs as distinct even within a partial-index row, so we coalesce to
-- a sentinel value that can never collide with a real UUID FK value.
DROP INDEX IF EXISTS "PhysicalInventory_warehouse_level_key";
CREATE UNIQUE INDEX "PhysicalInventory_warehouse_level_key"
  ON "PhysicalInventory" ("productId", COALESCE("variantId", ''), "warehouseId")
  WHERE "binLocationId" IS NULL;

COMMENT ON INDEX "PhysicalInventory_warehouse_level_key" IS
  'Prevents duplicate warehouse-level PhysicalInventory rows (binLocationId IS NULL) for the same product+variant+warehouse combination. Supplement to @@unique([productId, variantId, warehouseId, binLocationId]) which only covers binned rows due to PostgreSQL NULL-distinct semantics.';
