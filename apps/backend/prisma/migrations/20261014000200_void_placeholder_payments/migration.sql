-- D-C actuals-only ledger: DDL-ONLY half of the VOID split (Postgres 55P04).
--
-- This migration adds the 'VOID' value to PaymentStatus and NOTHING else.
-- The data backfill (VOID-marking legacy cash/UNPAID placeholders + Order
-- snapshot backfill) lives in 20261014000700_void_placeholder_backfill, which
-- runs in a SEPARATE transaction AFTER this migration commits: Postgres
-- forbids using a newly-added enum value in the same transaction that added
-- it (55P04 check_safe_enum_use), so ADD VALUE and any DML using the new
-- value must never share one migration file.
--
-- SAFE TO EDIT (2026-10-15): this migration never applied successfully on any
-- database — staging's failed record was rolled back by the startup self-heal
-- (migrate resolve --rolled-back); no production client has run it.

-- ── 1. VOID enum value (guarded: re-runnable after a crash) ──────────────
DO $$ BEGIN
  ALTER TYPE "PaymentStatus" ADD VALUE 'VOID';
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'D-C VOID migration: PaymentStatus VOID already exists — skipping';
END $$;
