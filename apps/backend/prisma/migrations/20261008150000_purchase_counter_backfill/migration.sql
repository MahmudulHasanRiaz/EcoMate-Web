-- Backfill the atomic PO counter from existing PO reference numbers.
-- generateNumber() now numbers POs from PurchaseCounter, which starts at 1
-- per date; on a deploy day that already has legacy POs the first new
-- create would collide on the unique referenceNo and keep failing until
-- midnight (the failed tx rolls the counter row back too). Seeding every
-- historical date's max sequence makes the cutover invisible.
-- Data-only: no schema change, additive insert/upsert, no row removal.

INSERT INTO "PurchaseCounter" ("date", "seq")
SELECT
  substring("referenceNo" from 4 for 6) AS date,
  COALESCE(MAX(CAST(substring("referenceNo" from 11) AS INTEGER)), 0) AS seq
FROM "Purchase"
WHERE "referenceNo" ~ '^PO-[0-9]{6}-[0-9]+$'
GROUP BY 1
ON CONFLICT ("date") DO UPDATE
  SET "seq" = GREATEST("PurchaseCounter"."seq", EXCLUDED."seq");
