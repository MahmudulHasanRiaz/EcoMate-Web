-- Repair: AccessPreset.permissions MUST be TEXT[] (Prisma `String[]`).
--
-- Incident (2026-10-31, fixedplus/fxdmostul): GET /api/access-presets
-- returned 500 on every call with Prisma's `TypeError: e.map is not a
-- function` inside AccessPresetsService.findAll. The client's AccessPreset
-- table predates the cumulative create-if-absent migration
-- (20260707100000), which created the table correctly on fresh installs
-- but never reshaped a table that already existed — so on that database
-- the permissions column kept an early-era scalar shape (TEXT/JSONB
-- holding permission keys in some serialized form), and the Prisma
-- driver cannot map a string into a String[] field.
--
-- FIRST VERSION OF THIS MIGRATION FAILED ON FXDMOSTUL (2026-10-31): a
-- single-statement ALTER ... USING (CASE ...) aborted on a stored value
-- whose shape matched a branch whose cast then threw. This version is
-- therefore written so NO stored value can abort it:
--   * conditional — a strict NO-OP when the column is already TEXT[]
--     (staging, avelto, every healthy install);
--   * row-by-row conversion through a shadow column, each parse attempt
--     wrapped in its own EXCEPTION block;
--   * a value that parses in NO known shape is preserved verbatim as a
--     single array element with a WARNING — never silently dropped
--     (sanitizePermissions ignores unknown keys at read time, and the
--     original bytes stay auditable in the row).
-- Shapes handled: NULL/'' -> {}; '["a","b"]' JSON array -> {a,b};
-- '{a,b}' PG array literal -> {a,b}; '"a"' JSON string -> {a};
-- 'a' bare value -> {a}.
DO $$
DECLARE
  col_udt text;
  r record;
  raw text;
  converted TEXT[];
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

    ALTER TABLE "AccessPreset" ADD COLUMN "permissions_repaired" TEXT[];

    FOR r IN SELECT id, "permissions"::TEXT AS raw_value FROM "AccessPreset" LOOP
      raw := r.raw_value;
      converted := NULL;

      IF raw IS NULL OR btrim(raw) = '' THEN
        converted := '{}'::TEXT[];
      ELSIF btrim(raw) LIKE '[%' THEN
        BEGIN
          converted := ARRAY(SELECT jsonb_array_elements_text(raw::jsonb));
        EXCEPTION WHEN others THEN
          converted := NULL;
        END;
      ELSIF btrim(raw) LIKE '{%' THEN
        BEGIN
          converted := raw::TEXT[];
        EXCEPTION WHEN others THEN
          converted := NULL;
        END;
      ELSIF btrim(raw) LIKE '"%' THEN
        converted := ARRAY[trim(both '"' from btrim(raw))];
      ELSE
        converted := ARRAY[raw];
      END IF;

      IF converted IS NULL THEN
        RAISE WARNING 'AccessPreset %: unparseable permissions value preserved verbatim', r.id;
        converted := ARRAY[raw];
      END IF;

      UPDATE "AccessPreset" SET "permissions_repaired" = converted WHERE id = r.id;
    END LOOP;

    ALTER TABLE "AccessPreset" DROP COLUMN "permissions";
    ALTER TABLE "AccessPreset" RENAME COLUMN "permissions_repaired" TO "permissions";
    ALTER TABLE "AccessPreset" ALTER COLUMN "permissions" SET NOT NULL;
    ALTER TABLE "AccessPreset" ALTER COLUMN "permissions" SET DEFAULT '{}';
  END IF;
END $$;

-- isSystem was added by migration 20261005120000 with IF NOT EXISTS;
-- repeat defensively for databases whose table predates that path.
ALTER TABLE "AccessPreset" ADD COLUMN IF NOT EXISTS "isSystem" BOOLEAN NOT NULL DEFAULT false;
