-- Pre-repair for 20261124220000_purchase_status_enum_repair (2026-11-24 P0).
--
-- The repair migration converts "Purchase"."status" from text back to the
-- "PurchaseStatus" enum, but Postgres refuses ALTER COLUMN TYPE while the
-- column carries a TEXT default (42804: default for column "status" cannot
-- be cast automatically to type "PurchaseStatus"). The live FixedPlus DB
-- drifted exactly that way: text column WITH DEFAULT 'draft'::text, enum
-- type missing. The 20261124220000 migration assumed the default was lost
-- with the type ("default lost") — it was not — so its ALTER failed and the
-- backend crash-looped (P3018).
--
-- This migration runs BEFORE 20261124220000 (earlier timestamp) and drops
-- the blocking default ONLY when the column is not yet the enum. It is a
-- no-op on healthy DBs (column already the enum — the default there is the
-- enum default and is left untouched) and on fresh DBs (column created as
-- the enum by the catchup migration). The repair migration itself re-adds
-- the 'draft' enum default after the conversion, so nothing is lost.
--
-- Safety: DROP DEFAULT only; no DML, no DROP TYPE / TABLE / COLUMN; the
-- guard re-checks the column type at run time, so a concurrent state change
-- cannot drop a healthy enum default. Rows are never touched.
DO $$ DECLARE
    col_type text;
    has_default boolean;
BEGIN
    SELECT udt_name INTO col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Purchase'
      AND column_name = 'status';

    -- No "Purchase" table / no "status" column: nothing to repair.
    IF col_type IS NULL THEN
        RAISE NOTICE 'purchase_status_default_repair: no "Purchase"."status" column — nothing to do';
        RETURN;
    END IF;

    -- Healthy DB: already the enum — the default is the enum default; keep it.
    IF col_type = 'PurchaseStatus' THEN
        RETURN;
    END IF;

    -- Drifted DB (column is text or another type): drop the default if one
    -- exists, so the repair migration's ALTER COLUMN TYPE can run. The
    -- repair migration re-adds the 'draft' enum default after converting.
    SELECT EXISTS (
        SELECT 1 FROM pg_attrdef d
        JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
        JOIN pg_class c ON c.oid = d.adrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'Purchase' AND a.attname = 'status'
    ) INTO has_default;

    IF has_default THEN
        EXECUTE 'ALTER TABLE "Purchase" ALTER COLUMN "status" DROP DEFAULT';
    END IF;
END $$;
