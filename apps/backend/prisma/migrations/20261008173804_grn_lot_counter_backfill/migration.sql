-- Seed the shared atomic counter from legacy GRN/LOT numbers so the cutover
-- never collides on unique grnNumber/lotNumber. Data-only, rerunnable.
INSERT INTO "PurchaseCounter" ("date", "seq")
SELECT
  substring("grnNumber" from 5 for 6) AS date,
  COALESCE(MAX(CAST(substring("grnNumber" from 12) AS INTEGER)), 0) AS seq
FROM "GoodsReceiptNote"
WHERE "grnNumber" ~ '^GRN-[0-9]{6}-[0-9]+$'
GROUP BY 1
ON CONFLICT ("date") DO UPDATE
  SET "seq" = GREATEST("PurchaseCounter"."seq", EXCLUDED."seq");

INSERT INTO "PurchaseCounter" ("date", "seq")
SELECT
  substring("lotNumber" from 5 for 6) AS date,
  COALESCE(MAX(CAST(substring("lotNumber" from 12) AS INTEGER)), 0) AS seq
FROM "CostingLot"
WHERE "lotNumber" ~ '^LOT-[0-9]{6}-[0-9]+$'
GROUP BY 1
ON CONFLICT ("date") DO UPDATE
  SET "seq" = GREATEST("PurchaseCounter"."seq", EXCLUDED."seq");
