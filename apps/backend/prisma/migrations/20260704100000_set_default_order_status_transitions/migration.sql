-- Re-add Payment Pending + add Payment Verifying + set default nextStatuses

-- 1. Re-add Payment Pending (was deleted in previous migration)
INSERT INTO "OrderStatus" ("id", "name", "color", "isInitial", "isFinal", "sortOrder", "createdAt")
SELECT gen_random_uuid(), 'Payment Pending', '#F59E0B', false, false, 2, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Payment Pending');

-- 2. Add Payment Verifying
INSERT INTO "OrderStatus" ("id", "name", "color", "isInitial", "isFinal", "sortOrder", "createdAt")
SELECT gen_random_uuid(), 'Payment Verifying', '#F97316', false, false, 3, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Payment Verifying');

-- 3. Fix sort orders (shift Hold+, Confirmed+ etc to make room)
UPDATE "OrderStatus" SET "sortOrder" = 1  WHERE "name" = 'Pending';
UPDATE "OrderStatus" SET "sortOrder" = 2  WHERE "name" = 'Payment Pending';
UPDATE "OrderStatus" SET "sortOrder" = 3  WHERE "name" = 'Payment Verifying';
UPDATE "OrderStatus" SET "sortOrder" = 4  WHERE "name" = 'Hold';
UPDATE "OrderStatus" SET "sortOrder" = 5  WHERE "name" = 'Confirmed';
UPDATE "OrderStatus" SET "sortOrder" = 6  WHERE "name" = 'Packed';
UPDATE "OrderStatus" SET "sortOrder" = 7  WHERE "name" = 'Packing Hold';
UPDATE "OrderStatus" SET "sortOrder" = 8  WHERE "name" = 'Shipping';
UPDATE "OrderStatus" SET "sortOrder" = 9  WHERE "name" = 'Delivered';
UPDATE "OrderStatus" SET "sortOrder" = 10 WHERE "name" = 'Partial';
UPDATE "OrderStatus" SET "sortOrder" = 11 WHERE "name" = 'Return Pending';
UPDATE "OrderStatus" SET "sortOrder" = 12 WHERE "name" = 'Returned';
UPDATE "OrderStatus" SET "sortOrder" = 13 WHERE "name" = 'Damaged';
UPDATE "OrderStatus" SET "sortOrder" = 14 WHERE "name" = 'Cancelled';

-- 4. Set default nextStatuses for each status

-- Pending → Payment Pending, Hold, Confirmed, Cancelled
UPDATE "OrderStatus" SET "nextStatuses" = (
  SELECT jsonb_agg(s.id) FROM "OrderStatus" s
  WHERE s."name" = ANY(ARRAY['Payment Pending','Hold','Confirmed','Cancelled'])
) WHERE "name" = 'Pending';

-- Payment Pending → Pending, Payment Verifying, Confirmed, Cancelled
UPDATE "OrderStatus" SET "nextStatuses" = (
  SELECT jsonb_agg(s.id) FROM "OrderStatus" s
  WHERE s."name" = ANY(ARRAY['Pending','Payment Verifying','Confirmed','Cancelled'])
) WHERE "name" = 'Payment Pending';

-- Payment Verifying → Confirmed, Payment Pending, Cancelled
UPDATE "OrderStatus" SET "nextStatuses" = (
  SELECT jsonb_agg(s.id) FROM "OrderStatus" s
  WHERE s."name" = ANY(ARRAY['Confirmed','Payment Pending','Cancelled'])
) WHERE "name" = 'Payment Verifying';

-- Hold → Confirmed, Pending, Cancelled
UPDATE "OrderStatus" SET "nextStatuses" = (
  SELECT jsonb_agg(s.id) FROM "OrderStatus" s
  WHERE s."name" = ANY(ARRAY['Confirmed','Pending','Cancelled'])
) WHERE "name" = 'Hold';

-- Confirmed → Packed, Packing Hold, Cancelled
UPDATE "OrderStatus" SET "nextStatuses" = (
  SELECT jsonb_agg(s.id) FROM "OrderStatus" s
  WHERE s."name" = ANY(ARRAY['Packed','Packing Hold','Cancelled'])
) WHERE "name" = 'Confirmed';

-- Packed → Shipping, Packing Hold, Cancelled
UPDATE "OrderStatus" SET "nextStatuses" = (
  SELECT jsonb_agg(s.id) FROM "OrderStatus" s
  WHERE s."name" = ANY(ARRAY['Shipping','Packing Hold','Cancelled'])
) WHERE "name" = 'Packed';

-- Packing Hold → Packed, Confirmed, Cancelled
UPDATE "OrderStatus" SET "nextStatuses" = (
  SELECT jsonb_agg(s.id) FROM "OrderStatus" s
  WHERE s."name" = ANY(ARRAY['Packed','Confirmed','Cancelled'])
) WHERE "name" = 'Packing Hold';

-- Shipping → Delivered, Partial, Return Pending
UPDATE "OrderStatus" SET "nextStatuses" = (
  SELECT jsonb_agg(s.id) FROM "OrderStatus" s
  WHERE s."name" = ANY(ARRAY['Delivered','Partial','Return Pending'])
) WHERE "name" = 'Shipping';

-- Delivered → Return Pending
UPDATE "OrderStatus" SET "nextStatuses" = (
  SELECT jsonb_agg(s.id) FROM "OrderStatus" s
  WHERE s."name" = ANY(ARRAY['Return Pending'])
) WHERE "name" = 'Delivered';

-- Partial → Delivered, Return Pending
UPDATE "OrderStatus" SET "nextStatuses" = (
  SELECT jsonb_agg(s.id) FROM "OrderStatus" s
  WHERE s."name" = ANY(ARRAY['Delivered','Return Pending'])
) WHERE "name" = 'Partial';

-- Return Pending → Returned, Damaged
UPDATE "OrderStatus" SET "nextStatuses" = (
  SELECT jsonb_agg(s.id) FROM "OrderStatus" s
  WHERE s."name" = ANY(ARRAY['Returned','Damaged'])
) WHERE "name" = 'Return Pending';

-- Returned → Damaged
UPDATE "OrderStatus" SET "nextStatuses" = (
  SELECT jsonb_agg(s.id) FROM "OrderStatus" s
  WHERE s."name" = ANY(ARRAY['Damaged'])
) WHERE "name" = 'Returned';

-- Damaged → none (lock state)
UPDATE "OrderStatus" SET "nextStatuses" = '[]'::jsonb WHERE "name" = 'Damaged';

-- Cancelled → Confirmed (reactivation)
UPDATE "OrderStatus" SET "nextStatuses" = (
  SELECT jsonb_agg(s.id) FROM "OrderStatus" s
  WHERE s."name" = ANY(ARRAY['Confirmed'])
) WHERE "name" = 'Cancelled';
