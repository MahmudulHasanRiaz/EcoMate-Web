-- Rollback for 20261014000200_void_placeholder_payments (D-C actuals-only ledger).
--
-- 1. Placeholders: restores ONLY rows this migration marked (matched by the
--    notes suffix) to UNPAID and strips the suffix. Genuine VOID rows written
--    by future code paths (no suffix) are left alone.
--    Verify first:
--      SELECT count(*) FROM "Payment"
--        WHERE "status" = 'VOID' AND "notes" LIKE '%[placeholder - no money moved]%';
-- 2. Snapshot backfill is NOT reversed: fills are historical corrections and
--    the migration cannot distinguish filled-from-blank vs staff-written values.
--    Leaving them is safe (snapshot columns are informational history).
-- 3. The VOID enum value CANNOT be removed without a full type rewrite
--    (Postgres limitation: no DROP VALUE). It stays unused after rollback —
--    harmless. Only roll back after confirming no code depends on VOID
--    filtering (payments findAll default exclusion).

UPDATE "Payment"
  SET "status" = 'UNPAID',
      "notes" = NULLIF(replace("notes", ' [placeholder - no money moved]', ''), '')
  WHERE "status" = 'VOID'
    AND "notes" LIKE '%[placeholder - no money moved]%';
