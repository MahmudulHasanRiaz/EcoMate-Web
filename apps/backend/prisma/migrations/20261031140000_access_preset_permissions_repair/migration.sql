-- Repair: AccessPreset.permissions MUST be TEXT[] (Prisma `String[]`).
--
-- Incident (2026-10-31, fixedplus/fxdmostul): GET /api/access-presets
-- returned 500 on every call with Prisma's `TypeError: e.map is not a
-- function` inside AccessPresetsService.findAll. The client's AccessPreset
-- table predates the cumulative create-if-absent migration
-- (20260707100000), which created the table correctly on fresh installs
-- but never reshaped a table that already existed — so on that database
-- the permissions column kept an early-era scalar shape (TEXT/JSONB
-- holding a JSON array string), and the Prisma driver cannot map a
-- string into a String[] field.
--
-- This migration is deliberately CONDITIONAL and a strict NO-OP on every
-- healthy database (staging, avelto, fresh installs): it only acts when
-- information_schema says the column is not already TEXT[]. Per the
-- owner's backward-compatibility rule, the repair travels with the
-- redeploy and heals the affected client automatically — no manual SQL,
-- no data loss: every stored value is converted by shape:
--   NULL                -> {}
--   '["a","b"]' (JSON)  -> {a,b}
--   '{a,b}' (PG literal)-> {a,b}
--   '"a"' (JSON string) -> {a}
--   'a'   (bare value)  -> {a}
--   ''                  -> {}
-- An unparseable value fails the migration loudly rather than silently
-- dropping a client's permission data.
DO $$
DECLARE
  col_udt text;
BEGIN
  SELECT udt_name INTO col_udt
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'AccessPreset'
    AND column_name = 'permissions';

  IF col_udt IS NULL THEN
    RAISE NOTICE 'AccessPreset.permissions not found — nothing to repair';
  ELSIF col_udt = '_text' THEN
    RAISE NOTICE 'AccessPreset.permissions is already TEXT[] — no repair needed';
  ELSE
    RAISE NOTICE 'Repairing AccessPreset.permissions from % to TEXT[]', col_udt;
    ALTER TABLE "AccessPreset"
      ALTER COLUMN "permissions" TYPE TEXT[]
      USING (
        CASE
          WHEN "permissions" IS NULL THEN '{}'::TEXT[]
          WHEN btrim("permissions"::TEXT) LIKE '[%'
            THEN ARRAY(SELECT jsonb_array_elements_text(("permissions"::TEXT)::jsonb))
          WHEN btrim("permissions"::TEXT) LIKE '{%'
            THEN ("permissions"::TEXT)::TEXT[]
          WHEN btrim("permissions"::TEXT) LIKE '"%'
            THEN ARRAY[trim(both '"' from "permissions"::TEXT)]
          WHEN btrim("permissions"::TEXT) = '' THEN '{}'::TEXT[]
          ELSE ARRAY["permissions"::TEXT]
        END
      );
    ALTER TABLE "AccessPreset" ALTER COLUMN "permissions" SET NOT NULL;
  END IF;
END $$;

-- isSystem was added by migration 20261005120000 with IF NOT EXISTS;
-- repeat defensively for databases whose table predates that path.
ALTER TABLE "AccessPreset" ADD COLUMN IF NOT EXISTS "isSystem" BOOLEAN NOT NULL DEFAULT false;
