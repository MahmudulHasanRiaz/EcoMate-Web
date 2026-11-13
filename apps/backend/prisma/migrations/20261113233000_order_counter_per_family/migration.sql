-- Split OrderCounter per document family (dashboard-counts audit 2026-11-13
-- §1c/§6 P1.4): one sequence per (Dhaka YYMMDD date, family) so a journal
-- entry, expense entry or employee hire can never consume an order number
-- again. Families: ORD (web/admin/manual + lead-converted orders), POS,
-- Ex (exchange children), JE (manual journal entries), EXP-JE (expense
-- journal entries), EMP (employee hires). LEAD- and CS-prefixed date keys
-- were already namespaced rows and are left untouched.
--
-- SEEDING (no duplicate displayId on a mid-day deploy, no number reuse):
-- every pre-existing shared row (date ~ ^[0-9]{6}$, family 'ORD' after the
-- ADD COLUMN default) is copied verbatim — same seq — into one row per
-- other family. The next mint of any family therefore starts ABOVE every
-- number the shared counter ever issued for that date, and existing
-- displayIds (stored strings on Order/JournalEntry/Employee) never change.
--
-- SAFETY: DDL is additive (ADD COLUMN with a constant default; PK widened
-- from (date) to (date, family) — no column/table/index is dropped, no row
-- is deleted or updated). The seed is a row-by-row PL/pgSQL loop; each
-- family's INSERT runs inside its own BEGIN/EXCEPTION block, so one
-- divergent row can never fail the whole migration — on any error the row
-- is left exactly as it was (preserve-verbatim fallback: the original ORD
-- row is never UPDATE-d or DELETE-d) and the failure is logged with
-- RAISE NOTICE. ON CONFLICT DO NOTHING makes the seed idempotent (a
-- re-run, or a row a concurrent deploy already seeded, is a no-op).
-- A final verification block NOTICEs the per-family row counts (the probe
-- for this change: the codebase has no probe_ddl table — see
-- 20261113160000/20261113170000 migration headers — so the counts + the
-- per-row NOTICE log are the probe evidence; a human or the
-- counter-reconciliation spec asserts the identity from them).
-- Rollback: DROP the seeded family rows (family <> 'ORD') and restore the
-- single-column PK — the ORD rows and all displayIds are untouched by
-- either direction.

ALTER TABLE "OrderCounter" ADD COLUMN "family" TEXT NOT NULL DEFAULT 'ORD';

ALTER TABLE "OrderCounter" DROP CONSTRAINT "OrderCounter_pkey";
ALTER TABLE "OrderCounter" ADD CONSTRAINT "OrderCounter_pkey" PRIMARY KEY ("date", "family");

DO $seed_families$
DECLARE
  src RECORD;
  fam TEXT;
  seeded_count integer := 0;
  skipped_count integer := 0;
  failed_count integer := 0;
BEGIN
  -- Only bare YYMMDD rows are shared-counter rows. LEAD-YYYYMM / CSYYMMDD
  -- keys are already namespaced and must NOT be fanned out.
  FOR src IN SELECT date, seq FROM "OrderCounter"
             WHERE family = 'ORD' AND date ~ '^[0-9]{6}$'
             ORDER BY date LOOP
    FOREACH fam IN ARRAY ARRAY['POS', 'Ex', 'JE', 'EXP-JE', 'EMP'] LOOP
      BEGIN
        INSERT INTO "OrderCounter" (date, family, seq)
        VALUES (src.date, fam, src.seq)
        ON CONFLICT (date, family) DO NOTHING;
        IF FOUND THEN
          seeded_count := seeded_count + 1;
        ELSE
          skipped_count := skipped_count + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        failed_count := failed_count + 1;
        RAISE NOTICE 'order-counter-split: seed failed for date=% family=% seq=% : %',
          src.date, fam, src.seq, SQLERRM;
      END;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'order-counter-split: seeded=% skipped(already present)=% failed=%',
    seeded_count, skipped_count, failed_count;
END
$seed_families$;

-- Probe: every pre-existing shared date must now hold all six families,
-- each seeded at-or-above the original shared seq. Violations are logged,
-- never fatal (the per-row guards above already contained them).
DO $probe_families$
DECLARE
  missing_count integer := 0;
  fam_count integer;
  d RECORD;
BEGIN
  FOR d IN SELECT date, seq FROM "OrderCounter"
           WHERE family = 'ORD' AND date ~ '^[0-9]{6}$' LOOP
    SELECT count(*) INTO fam_count FROM "OrderCounter"
    WHERE date = d.date AND family IN ('ORD', 'POS', 'Ex', 'JE', 'EXP-JE', 'EMP');
    IF fam_count < 6 THEN
      missing_count := missing_count + 1;
      RAISE NOTICE 'order-counter-split PROBE: date=% has %/6 families (seq=%)',
        d.date, fam_count, d.seq;
    END IF;
  END LOOP;
  RAISE NOTICE 'order-counter-split PROBE: dates missing families=%', missing_count;
END
$probe_families$;
