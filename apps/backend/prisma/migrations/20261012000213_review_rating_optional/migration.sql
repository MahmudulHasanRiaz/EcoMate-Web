-- Rating-less reviews store NULL instead of an inflated 5-star default.
-- Additive-safe: DROP NOT NULL only; existing rows untouched.
-- P1-P8 central-commerce drift intentionally untouched.

ALTER TABLE "reviews" ALTER COLUMN "rating" DROP NOT NULL;
