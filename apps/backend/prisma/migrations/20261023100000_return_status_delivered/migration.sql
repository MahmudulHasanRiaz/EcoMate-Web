-- Return stage semantics (sheet Rules 2, 19, 25, 27(c); Return Creation rows
-- 6/11/18): a courier 'received' / back-with-merchant signal moves the Return
-- record to DELIVERED — NOT RECEIVED (receiving is always a staff-confirmed
-- act and is the only stage allowed to restore stock).
--
-- ADD ONLY — never rename/remove an enum value (old rows + old code keep
-- working). Expand-only, no data backfill, safe on redeploy and re-runnable:
-- the ADD VALUE is guarded (duplicate_object catch, per the
-- 20261014000500_dispatch_pickup_failed_assigned_to_hub precedent).
--
-- DDL-ONLY: enum ADD VALUE and any DML that USES the new value must never
-- share a migration file (Postgres 55P04). Code wiring ships in the same
-- commit; no data migration is needed (DELIVERED is set only by future
-- courier signals).

DO $$ BEGIN
  ALTER TYPE "ReturnStatus" ADD VALUE 'DELIVERED';
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Return DELIVERED stage migration: ReturnStatus DELIVERED already exists — skipping';
END $$;
