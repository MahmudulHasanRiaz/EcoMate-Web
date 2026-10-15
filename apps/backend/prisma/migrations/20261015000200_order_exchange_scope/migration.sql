-- Exchange scope for server-side Exchanges filtering.
--
-- Stores the FULL/PARTIAL mode decided at exchange creation (previously only
-- derived client-side by comparing original vs return-leg items). NULL =
-- exchange created before this column (unknown, displayed as '—', excluded
-- from FULL/PARTIAL filters). Expand-only, no backfill, no rewrites.

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "exchangeScope" TEXT;
