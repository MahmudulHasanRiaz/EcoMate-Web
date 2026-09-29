-- Orders-list search: make substring (ILIKE '%…%') matching index-usable.
--
-- The search bar accepts an order number, customer/guest name, phone number or
-- product SKU. Name/order-number/SKU matching is a substring match, which
-- Postgres cannot serve from a B-tree (leading wildcard) and would otherwise
-- sequential-scan Order + its customer join on every keystroke. pg_trgm GIN
-- indexes support LIKE/ILIKE directly.
--
-- Phone lookup deliberately gets no index here: a complete number is matched by
-- equality against the canonical spellings, which already rides the unique
-- CustomerProfile.phone B-tree and the Order.guestPhone index.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Order_displayId_trgm_idx" ON "Order" USING GIN ("displayId" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Order_guestName_trgm_idx" ON "Order" USING GIN ("guestName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "CustomerProfile_name_trgm_idx" ON "CustomerProfile" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_sku_trgm_idx" ON "Product" USING GIN ("sku" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ProductVariant_sku_trgm_idx" ON "ProductVariant" USING GIN ("sku" gin_trgm_ops);
