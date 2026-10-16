-- Call-center pre-confirmation statuses: Recall ("called once, no answer")
-- and No Response ("retry also unanswered"), inserted BEFORE Confirmed with
-- Recall first. Lookup-table installs follow the historical guarded-INSERT
-- pattern (no Postgres enum involved — nothing to ALTER TYPE).

-- 1) Make room: shift Confirmed and everything after it down by two slots.
--    Runs only on first application (guarded on Recall's absence).
UPDATE "OrderStatus"
SET "sortOrder" = "sortOrder" + 2
WHERE "sortOrder" >= (SELECT "sortOrder" FROM "OrderStatus" WHERE "name" = 'Confirmed')
  AND NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Recall');

-- 2) Insert the two statuses (idempotent). Recall takes the first free slot,
--    No Response the second — both directly before Confirmed.
INSERT INTO "OrderStatus" ("id", "name", "color", "sortOrder", "isInitial", "isFinal", "nextStatuses", "createdAt")
SELECT gen_random_uuid()::text, 'Recall', '#F97316',
       (SELECT "sortOrder" FROM "OrderStatus" WHERE "name" = 'Confirmed') - 2,
       false, false, '[]'::jsonb, now()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Recall');

INSERT INTO "OrderStatus" ("id", "name", "color", "sortOrder", "isInitial", "isFinal", "nextStatuses", "createdAt")
SELECT gen_random_uuid()::text, 'No Response', '#64748B',
       (SELECT "sortOrder" FROM "OrderStatus" WHERE "name" = 'Confirmed') - 1,
       false, false, '[]'::jsonb, now()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'No Response');

-- 3) Free movement within the pre-confirmation group + the existing
--    Confirmed/Cancelled exits. Mirrors src/orders/order-transitions.ts.
UPDATE "OrderStatus" AS r
SET "nextStatuses" = (
  SELECT jsonb_agg(s."id" ORDER BY s."sortOrder")
  FROM "OrderStatus" s
  WHERE s."name" IN ('Pending', 'Payment Pending', 'Payment Verifying', 'Hold', 'No Response', 'Confirmed', 'Cancelled')
)
WHERE r."name" = 'Recall' AND r."nextStatuses" = '[]'::jsonb;

UPDATE "OrderStatus" AS r
SET "nextStatuses" = (
  SELECT jsonb_agg(s."id" ORDER BY s."sortOrder")
  FROM "OrderStatus" s
  WHERE s."name" IN ('Pending', 'Payment Pending', 'Payment Verifying', 'Hold', 'Recall', 'Confirmed', 'Cancelled')
)
WHERE r."name" = 'No Response' AND r."nextStatuses" = '[]'::jsonb;

-- 4) Pre-confirmation sources gain the two new targets (idempotent jsonb
--    merges, same pattern as 20260820120000_confirmed_hold_transition).
UPDATE "OrderStatus" AS src
SET "nextStatuses" = src."nextStatuses" || jsonb_build_array(r.id)
FROM "OrderStatus" AS r
WHERE src."name" IN ('Pending', 'Payment Pending', 'Payment Verifying', 'Hold')
  AND r."name" = 'Recall'
  AND NOT (src."nextStatuses" @> jsonb_build_array(r.id));

UPDATE "OrderStatus" AS src
SET "nextStatuses" = src."nextStatuses" || jsonb_build_array(r.id)
FROM "OrderStatus" AS r
WHERE src."name" IN ('Pending', 'Payment Pending', 'Payment Verifying', 'Hold')
  AND r."name" = 'No Response'
  AND NOT (src."nextStatuses" @> jsonb_build_array(r.id));
