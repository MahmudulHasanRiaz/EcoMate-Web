-- PDP color swatches: optional per-value image + per-attribute fit (cover=zoom-crop, contain=full).
-- Nullable additive-only columns; existing rows safe. P1-P8 central-commerce drift intentionally untouched.

ALTER TABLE "AttributeValue" ADD COLUMN "image" TEXT;
ALTER TABLE "Attribute" ADD COLUMN "swatchFit" TEXT;
