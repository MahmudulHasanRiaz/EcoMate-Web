-- Transfer history: two schema fixes that belong in one migration because
-- both are the "transfer audit trail must survive and stay queryable" change.
--
-- 1. PhysicalInventoryLedger(reason) trigram index.
--    listTransfers() matches a transfer's ledger legs with
--    `reason: { contains: <transferId> }`. The reason text is
--    "Transfer <uuid> to <warehouse>" — the id sits in the MIDDLE of the
--    string, so the match is a leading-wildcard substring (LIKE
--    '%<uuid>%') which no B-tree can serve. The transfers screen polls this
--    every 30s, so as the ledger grows it sequential-scans the whole table
--    each poll. A pg_trgm GIN index supports LIKE/ILIKE directly.
--    (Same approach as migration 20260929000100_order_search_trgm_indexes.)
--
-- 2. StockTransferItem.variantId FK: CASCADE -> SET NULL.
--    The item row is the audit record of WHAT was transferred. With CASCADE,
--    deleting a ProductVariant deleted the StockTransferItem rows that
--    referenced it, destroying that record — a product/variant edit could
--    silently rewrite history. variantId is already nullable (TEXT NULL), so
--    SET NULL clears the reference and the row survives.
--
-- Data-loss check for (2): changing ON DELETE CASCADE to ON DELETE SET NULL
-- destroys no rows. It only changes what happens to the FK VALUE on a future
-- variant delete (NULL instead of removing the row). No DELETE FROM, no DROP
-- COLUMN, no DROP TABLE, no DROP INDEX is issued — this migration trips no
-- migration-safety pattern.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "PhysicalInventoryLedger_reason_trgm_idx"
  ON "PhysicalInventoryLedger" USING GIN ("reason" gin_trgm_ops);

-- The FK is re-pointed, not dropped and recreated under a new name, so the
-- constraint keeps its identity and Prisma's shadow database matches.
ALTER TABLE "StockTransferItem"
  DROP CONSTRAINT "StockTransferItem_variantId_fkey";

ALTER TABLE "StockTransferItem"
  ADD CONSTRAINT "StockTransferItem_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Rollback ─────────────────────────────────────────────────────────────
-- Reverse order:
--   ALTER TABLE "StockTransferItem" DROP CONSTRAINT "StockTransferItem_variantId_fkey";
--   -- WARN: rows whose variantId was nulled while the constraint was SET NULL
--   --   cannot be restored by this alone — re-link them first, e.g.
--   --   UPDATE "StockTransferItem" i
--   --      SET "variantId" = m."variantId"
--   --     FROM ... -- your known variant→lineage mapping
--   --   WHERE i."variantId" IS NULL;
--   ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_variantId_fkey"
--     FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
--     ON DELETE CASCADE ON UPDATE CASCADE;
--   DROP INDEX "PhysicalInventoryLedger_reason_trgm_idx";
--   -- DROP EXTENSION IF EXISTS pg_trgm;  -- only when no other trgm index uses it