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
-- This migration is written so NO stored value can abort it. (Two
-- earlier shapes failed the incident review: a single ALTER ... USING
-- (CASE ...) threw on a stored value whose branch cast failed, and a
-- shadow-column swap would have to drop the old column, which the
-- repo's post-P0 migration-safety gate forbids.) The conversion is
-- three phases, all
-- inside one conditional block:
--   Phase 1: retype the column to TEXT (a ::TEXT cast never throws,
--            whatever the source type).
--   Phase 2: row-by-row, rewrite each value into a canonical Postgres
--            array literal produced by serializing a TEXT[] built in
--            PL/pgSQL. Every parse attempt is wrapped in EXCEPTION; a
--            value that parses in NO known shape is preserved verbatim
--            as a single element with a WARNING — never dropped
--            (sanitizePermissions ignores unknown keys at read time).
--   Phase 3: retype TEXT -> TEXT[]; every value is now a serializer-
--            produced literal, so this cast cannot throw.
-- Shapes handled: NULL/'' -> {}; '["a","b"]' JSON array -> {a,b};
-- '{a,b}' PG array literal -> {a,b}; '"a"' JSON string -> {a};
-- 'a' bare value -> {a}.
-- On every healthy database (column already TEXT[]) the block is a
-- strict NO-OP.
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

    -- Phase 1: anything -> TEXT (never throws).
    ALTER TABLE "AccessPreset"
      ALTER COLUMN "permissions" TYPE TEXT
      USING "permissions"::TEXT;

    -- Phase 2: normalize each stored value into an array literal.
    FOR r IN SELECT id, "permissions" AS raw_value FROM "AccessPreset" LOOP
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

      UPDATE "AccessPreset" SET "permissions" = converted::TEXT WHERE id = r.id;
    END LOOP;

    -- Phase 3: TEXT -> TEXT[] (all values are valid literals by now).
    ALTER TABLE "AccessPreset"
      ALTER COLUMN "permissions" TYPE TEXT[]
      USING "permissions"::TEXT[];
    ALTER TABLE "AccessPreset" ALTER COLUMN "permissions" SET NOT NULL;
    ALTER TABLE "AccessPreset" ALTER COLUMN "permissions" SET DEFAULT '{}';
  END IF;
END $$;

-- isSystem was added by migration 20261005120000 with IF NOT EXISTS;
-- repeat defensively for databases whose table predates that path.
ALTER TABLE "AccessPreset" ADD COLUMN IF NOT EXISTS "isSystem" BOOLEAN NOT NULL DEFAULT false;
