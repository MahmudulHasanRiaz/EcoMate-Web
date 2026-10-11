-- PDP redesign: optional video URL + admin-defined detail rows on Product, reviewer mobile on Review.
-- Nullable additive-only columns; safe for existing rows. P1-P8 central-commerce drift intentionally untouched.

ALTER TABLE "Product" ADD COLUMN "detailRows" JSONB,
ADD COLUMN "videoUrl" TEXT;

ALTER TABLE "reviews" ADD COLUMN "mobile" TEXT;
