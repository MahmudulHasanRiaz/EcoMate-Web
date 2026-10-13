-- Task 9 (D5): cancel/refund gate + atomic cancel-too.
--
-- Refund.method records where the money went back (gateway code / account
-- label, e.g. 'bkash'). Required for every refund recorded after the
-- payment-ledger overhaul; NULL marks a legacy pre-ledger refund. The gate
-- rule (outstanding = netPaid − legacyRefunded) uses this to tell mirrored
-- refunds (method set + matching negative payment row — counted via the
-- ledger) from legacy ones (method NULL — counted via the Refund row)
-- without ever double-counting.
--
-- Expand-only: nullable column, no backfill (existing rows are legacy by
-- definition), no rewrite, no index. Safe to apply while old app versions
-- run (they simply ignore the column).

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN "method" TEXT;

-- ── Rollback ─────────────────────────────────────────────────────────────
-- New-flow refunds written while this migration is live carry method + a
-- matching negative payment row; dropping the column reclassifies them as
-- legacy (they would then ALSO count via the Refund row → double-count).
-- Only roll back after confirming no Refund row has method set, e.g.:
--   SELECT count(*) FROM "Refund" WHERE "method" IS NOT NULL;  -- expect 0
--   ALTER TABLE "Refund" DROP COLUMN "method";
