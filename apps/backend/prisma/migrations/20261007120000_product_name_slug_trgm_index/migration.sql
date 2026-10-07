-- Product list search: trigram indexes on Product.name / Product.slug.
--
-- buildWhere() matches a search term with 4–8 OR'd `contains` (ILIKE '%…%')
-- predicates over name, slug, sku and variant SKUs. sku already has trigram
-- coverage (Product_sku_trgm_idx, ProductVariant_sku_trgm_idx), but name and
-- slug had only B-tree support (slug's unique index), which cannot serve a
-- leading-wildcard substring — every keystroke sequential-scanned the whole
-- Product table. At thousands of products the admin list search (350ms
-- debounce) and the storefront archive search both degrade linearly.
-- pg_trgm GIN indexes serve LIKE/ILIKE directly (bitmap scan).
-- (Same approach as 20260929000100_order_search_trgm_indexes and
-- 20261006090000_ledger_reason_trgm_index.)
--
-- Data-loss check: CREATE INDEX creates new access structures only. No
-- DELETE FROM, no DROP COLUMN, no DROP TABLE, no DROP INDEX is issued —
-- this migration trips no migration-safety pattern.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Product_name_trgm_idx"
  ON "Product" USING GIN ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Product_slug_trgm_idx"
  ON "Product" USING GIN ("slug" gin_trgm_ops);

-- ── Rollback ─────────────────────────────────────────────────────────────
-- Reverse order:
--   DROP INDEX "Product_slug_trgm_idx";
--   DROP INDEX "Product_name_trgm_idx";
--   -- DROP EXTENSION IF EXISTS pg_trgm;  -- only when no other trgm index uses it
