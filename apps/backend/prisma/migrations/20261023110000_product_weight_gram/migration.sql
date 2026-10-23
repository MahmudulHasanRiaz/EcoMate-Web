-- Optional per-product parcel weight in grams (owner Q12, 2026-10-23).
-- Nullable: null keeps the courier fallbacks (Pathao 0.5 kg, RedX/Carrybee
-- 500 g); a set value wins at dispatch. DDL-only, no backfill.
ALTER TABLE "Product" ADD COLUMN "weightGram" INTEGER;
