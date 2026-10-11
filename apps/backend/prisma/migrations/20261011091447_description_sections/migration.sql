-- PDP redesign: admin-editable description sections (tagline/benefits/specifications/stylingTip).
-- Nullable additive-only column; existing rows safe. P1-P8 central-commerce drift intentionally untouched.

ALTER TABLE "Product" ADD COLUMN "descriptionSections" JSONB;
