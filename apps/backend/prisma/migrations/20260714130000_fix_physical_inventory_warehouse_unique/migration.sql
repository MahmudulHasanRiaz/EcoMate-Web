-- PhysicalInventory duplicate audit AND constraint fix
-- ===========================================================================
-- Background:
--   PostgreSQL 16 treats NULLs as distinct in unique constraints, so the
--   existing @@unique([productId, variantId, warehouseId, binLocationId]) on
--   PhysicalInventory only protects Domain 4 (all 4 columns non-null).
--
--   Domains 1-3 have one or more NULL columns and are UNPROTECTED:
--     1. Simple product + warehouse-level (variantId NULL, binLocationId NULL)
--     2. Variant + warehouse-level         (variantId NOT NULL, binLocationId NULL)
--     3. Simple product + bin-level         (variantId NULL, binLocationId NOT NULL)
--     4. Variant + bin-level                (variantId NOT NULL, binLocationId NOT NULL)
--
--   Solution: two partial unique indexes using COALESCE to close the NULL-distinct gap.
--   The old @@unique is dropped last — after both new indexes exist — so
--   protection is never removed before replacement is in place.
--
--   Verified: this Prisma version (7.8.0) does NOT wrap migration SQL in a
--   transaction (confirmed by execution test on disposable PostgreSQL database).
--   The CREATE-before-DROP ordering ensures no unprotected window even if
--   the migration fails partway through.
-- ===========================================================================
-- Step 1: Audit all 4 identity domains for existing duplicates
--         Raises exception with full details if any found.
--         Intentionally blocks the entire migration — human reconciliation required.
-- ===========================================================================

DO $$
DECLARE
  r RECORD;
  n INTEGER := 0;
  dup_text TEXT := '';
BEGIN
  FOR r IN
    SELECT domain, "productId", "variantId"::text, "warehouseId", "binLocationId", cnt
    FROM (
      -- Domains 1 + 2: warehouse-level
      SELECT 'warehouse-level' AS domain,
             "productId", "variantId", "warehouseId", NULL::text AS "binLocationId",
             COUNT(*) AS cnt
      FROM "PhysicalInventory"
      WHERE "binLocationId" IS NULL
      GROUP BY "productId", "variantId", "warehouseId"
      HAVING COUNT(*) > 1
      UNION ALL
      -- Domains 3 + 4: bin-level
      SELECT 'bin-level',
             "productId", "variantId", "warehouseId", "binLocationId",
             COUNT(*)
      FROM "PhysicalInventory"
      WHERE "binLocationId" IS NOT NULL
      GROUP BY "productId", "variantId", "warehouseId", "binLocationId"
      HAVING COUNT(*) > 1
    ) subq
    ORDER BY domain, cnt DESC
  LOOP
    n := n + 1;
    dup_text := dup_text || format(
      E'\n  [%s] %s: productId=%s, variantId=%s, warehouseId=%s, binLocationId=%s → %s rows',
      n, r.domain, r."productId",
      COALESCE(r."variantId", 'NULL'),
      r."warehouseId",
      COALESCE(r."binLocationId", 'NULL'),
      r.cnt
    );
  END LOOP;

  IF n > 0 THEN
    RAISE EXCEPTION 'Found % duplicate PhysicalInventory row set(s). Resolve before applying unique indexes.%',
      n, dup_text;
  END IF;
END;
$$;

-- ===========================================================================
-- Step 2: Create partial unique index for warehouse-level rows FIRST
--         Protects Domains 1 (simple + warehouse) and 2 (variant + warehouse).
--         COALESCE handles variantId NULL for simple products — empty string
--         never collides with real UUID FK values.
--         Created before old index is dropped to avoid unprotected window.
-- ===========================================================================

CREATE UNIQUE INDEX "PhysicalInventory_warehouse_level_key"
  ON "PhysicalInventory" ("productId", COALESCE("variantId", ''), "warehouseId")
  WHERE "binLocationId" IS NULL;

COMMENT ON INDEX "PhysicalInventory_warehouse_level_key" IS
  'Partial unique index covering warehouse-level rows (Domains 1+2). Prevents duplicate product+variant+warehouse rows where binLocationId IS NULL. Complements bin-level partial index for full 4-domain coverage.';

-- ===========================================================================
-- Step 3: Create partial unique index for bin-level rows
--         Protects Domains 3 (simple + bin) and 4 (variant + bin).
--         COALESCE handles variantId NULL for simple products.
--         binLocationId is always non-null (WHERE clause), so no COALESCE needed.
-- ===========================================================================

CREATE UNIQUE INDEX "PhysicalInventory_bin_level_key"
  ON "PhysicalInventory" ("productId", COALESCE("variantId", ''), "warehouseId", "binLocationId")
  WHERE "binLocationId" IS NOT NULL;

COMMENT ON INDEX "PhysicalInventory_bin_level_key" IS
  'Partial unique index covering bin-level rows (Domains 3+4). Prevents duplicate product+variant+warehouse+bin rows where binLocationId IS NOT NULL. Complements warehouse-level partial index.';

-- ===========================================================================
-- Step 4: Drop the old Prisma @@unique — now safe because the two partial
--         indexes above are already in place and protecting all 4 domains.
--         Actual database name confirmed from PostgreSQL pg_indexes:
--         "PhysicalInventory_productId_variantId_warehouseId_binLocati_key"
--         (truncated to 63 chars from the generated Prisma name).
-- ===========================================================================

DROP INDEX IF EXISTS "PhysicalInventory_productId_variantId_warehouseId_binLocati_key";
