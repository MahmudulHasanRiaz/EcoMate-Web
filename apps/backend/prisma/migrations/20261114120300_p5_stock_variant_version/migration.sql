-- P5 stock-status sync: monotonic version guard per variant (BR-07 race case).
-- Additive only: one nullable column, no backfill (NULL = never evaluated).
ALTER TABLE "StoreVariantMapping" ADD COLUMN "lastEvaluatedVersion" TEXT;
