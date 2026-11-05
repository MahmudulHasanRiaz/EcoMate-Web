-- PLP scale round: persist the card sort/display price on Product so the
-- storefront price sort runs in Postgres on an index instead of loading
-- the whole matching catalogue into memory (the retired JS sort in
-- ProductsService.findAll).
--
-- Backfill semantics — an EXACT mirror of the JS computation that used to
-- run per request (parseEffectivePrice in products.service.ts):
--   * variable product with at least one PRICED variant:
--       MIN over ALL variants (active or not — the JS read had no
--       isActive filter) of COALESCE(variant."salePrice", variant.price),
--       considering only variants whose coalesced price is > 0
--       (the JS filtered Number.isNaN and <= 0 out);
--   * every other case (simple product, variable product with no priced
--     variant, variable product with no variants at all):
--       COALESCE(product."salePrice", product."basePrice")
--       (the JS `Number(salePrice ?? basePrice) || 0` — basePrice is
--       NOT NULL, so the COALESCE can never yield NULL here).
--
-- Deploy safety: every value involved is already DECIMAL(10,2) — the
-- backfill is numeric-to-numeric with no casts of unknown client data,
-- so a single set-based UPDATE is row-safe. The UPDATE is also
-- idempotent: re-running it recomputes the same values. Additive only
-- (new column + new index), per the post-P0 migration rules.

ALTER TABLE "Product" ADD COLUMN "effectivePrice" DECIMAL(10,2) NOT NULL DEFAULT 0;

CREATE INDEX "Product_effectivePrice_id_idx" ON "Product"("effectivePrice", "id");

UPDATE "Product" p
SET "effectivePrice" = CASE
  WHEN p.type = 'variable' AND EXISTS (
    SELECT 1
    FROM "ProductVariant" v
    WHERE v."productId" = p.id
      AND COALESCE(v."salePrice", v.price) > 0
  ) THEN (
    SELECT MIN(COALESCE(v."salePrice", v.price))
    FROM "ProductVariant" v
    WHERE v."productId" = p.id
      AND COALESCE(v."salePrice", v.price) > 0
  )
  ELSE COALESCE(p."salePrice", p."basePrice")
END;
