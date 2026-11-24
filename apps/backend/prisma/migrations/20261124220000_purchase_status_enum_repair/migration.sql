-- Corrective migration: repair drifted tenant DBs (e.g. FixedPlus) where the
-- "PurchaseStatus" enum TYPE is missing while the "Purchase" table exists
-- (its "status" column drifted to text, default lost). Prisma
-- purchase.create() then fails with Postgres 42704 wrapped as P2039:
--   Database error. Code: 42704. Message: type "public.PurchaseStatus" does not exist
--   Prisma error P2039 at POST /api/purchases
--
-- Root cause (verified 2026-11-24 on real Postgres 16): a FRESH
-- `prisma migrate deploy` DOES create the enum — migration
-- 20260625203000_catchup_to_current creates it in a duplicate-tolerant DO
-- block — and purchase create succeeds there. The migration chain is NOT
-- broken. The live tenant DB drifted: _prisma_migrations records the catchup
-- migration as applied, yet the type is gone. This migration repairs that
-- drift through the normal deploy path. It is a safe no-op on a healthy DB.
--
-- Safety (additive-only; no DROP / DELETE / TRUNCATE; no DML at all):
--   - CREATE TYPE is duplicate-tolerant (IF NOT EXISTS via DO block).
--   - The column conversion runs ONLY when the column exists and is not
--     already "PurchaseStatus".
--   - Rows holding a value outside the enum abort the migration with a clear
--     error (fail safe, data preserved verbatim — nothing is rewritten or
--     dropped; fix those rows manually and re-run migrate deploy).
--   - No enum ADD VALUE + DML in one migration: there is no ADD VALUE and
--     no DML here at all.

-- 1. Recreate the enum type if missing (values exactly as schema.prisma).
DO $$ BEGIN
    CREATE TYPE "PurchaseStatus" AS ENUM ('draft', 'ordered', 'partially_received', 'received', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 2. Convert "Purchase"."status" back to the enum ONLY if it drifted.
DO $$ DECLARE
    col_type text;
    bad_vals text;
BEGIN
    SELECT udt_name INTO col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Purchase'
      AND column_name = 'status';

    -- No "Purchase" table / no "status" column (partial schema): nothing to
    -- convert; the type above is still in place for later migrations.
    IF col_type IS NULL THEN
        RAISE NOTICE 'purchase_status_enum_repair: no "Purchase"."status" column — nothing to convert';
        RETURN;
    END IF;

    -- Healthy DB: already the enum — no-op.
    IF col_type = 'PurchaseStatus' THEN
        RETURN;
    END IF;

    -- Drifted DB (column is text or another type): refuse to convert if any
    -- stored value is outside the enum — fail safe, preserve data verbatim.
    SELECT string_agg(DISTINCT quote_literal("status"), ', ')
    INTO bad_vals
    FROM "Purchase"
    WHERE "status" NOT IN ('draft', 'ordered', 'partially_received', 'received', 'cancelled');

    IF bad_vals IS NOT NULL THEN
        RAISE EXCEPTION 'purchase_status_enum_repair: "Purchase"."status" holds values outside the PurchaseStatus enum (%). Fix those rows manually (set a valid status) and re-run migrate deploy — no data was changed.', bad_vals;
    END IF;

    -- All stored values are valid enum labels: convert verbatim.
    EXECUTE 'ALTER TABLE "Purchase" ALTER COLUMN "status" TYPE "PurchaseStatus" USING "status"::"PurchaseStatus"';

    -- Restore the schema default if it was lost with the type.
    IF NOT EXISTS (
        SELECT 1 FROM pg_attrdef d
        JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
        JOIN pg_class c ON c.oid = d.adrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'Purchase' AND a.attname = 'status'
    ) THEN
        EXECUTE 'ALTER TABLE "Purchase" ALTER COLUMN "status" SET DEFAULT ''draft''::"PurchaseStatus"';
    END IF;
END $$;
