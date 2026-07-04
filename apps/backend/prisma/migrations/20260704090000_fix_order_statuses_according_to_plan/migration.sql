-- Fix OrderStatuses to match Order & Dispatch Split Lifecycle Guide
-- Remove statuses that belong to Payment domain, add missing ones, fix names

-- 1. Remove wrongly added payment-domain statuses
DELETE FROM "OrderStatus" WHERE "name" IN ('Processing', 'Payment Pending', 'Refunded');

-- 2. If "Shipped" exists, rename to "Shipping" per plan
UPDATE "OrderStatus" SET "name" = 'Shipping'
WHERE "name" = 'Shipped'
AND NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Shipping');

-- 3. Insert missing statuses
INSERT INTO "OrderStatus" ("id", "name", "color", "isInitial", "isFinal", "sortOrder", "createdAt")
SELECT gen_random_uuid(), 'Hold', '#F97316', false, false, 2, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Hold');

INSERT INTO "OrderStatus" ("id", "name", "color", "isInitial", "isFinal", "sortOrder", "createdAt")
SELECT gen_random_uuid(), 'Shipping', '#06B6D4', false, false, 7, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Shipping');

INSERT INTO "OrderStatus" ("id", "name", "color", "isInitial", "isFinal", "sortOrder", "createdAt")
SELECT gen_random_uuid(), 'Partial', '#8B5CF6', false, false, 8, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Partial');

INSERT INTO "OrderStatus" ("id", "name", "color", "isInitial", "isFinal", "sortOrder", "createdAt")
SELECT gen_random_uuid(), 'Returned', '#F43F5E', false, false, 11, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Returned');

INSERT INTO "OrderStatus" ("id", "name", "color", "isInitial", "isFinal", "sortOrder", "createdAt")
SELECT gen_random_uuid(), 'Damaged', '#991B1B', false, true, 12, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Damaged');

-- 4. Fix sort orders for all statuses per the documented flow
-- Flow: Pending(1) → Hold(2) → Confirmed(3) → Packed(4) → Packing Hold(5) → Shipping(6) → Delivered(7) → Partial(8) → Return Pending(9) → Returned(10) → Damaged(11) | Cancelled(12)

UPDATE "OrderStatus" SET "sortOrder" = 1  WHERE "name" = 'Pending';
UPDATE "OrderStatus" SET "sortOrder" = 2  WHERE "name" = 'Hold';
UPDATE "OrderStatus" SET "sortOrder" = 3  WHERE "name" = 'Confirmed';
UPDATE "OrderStatus" SET "sortOrder" = 4  WHERE "name" = 'Packed';
UPDATE "OrderStatus" SET "sortOrder" = 5  WHERE "name" = 'Packing Hold';
UPDATE "OrderStatus" SET "sortOrder" = 6  WHERE "name" = 'Shipping';
UPDATE "OrderStatus" SET "sortOrder" = 7  WHERE "name" = 'Delivered';
UPDATE "OrderStatus" SET "sortOrder" = 8  WHERE "name" = 'Partial';
UPDATE "OrderStatus" SET "sortOrder" = 9  WHERE "name" = 'Return Pending';
UPDATE "OrderStatus" SET "sortOrder" = 10 WHERE "name" = 'Returned';
UPDATE "OrderStatus" SET "sortOrder" = 11 WHERE "name" = 'Damaged';
UPDATE "OrderStatus" SET "sortOrder" = 12 WHERE "name" = 'Cancelled';

-- 5. Fix isInitial/isFinal per plan
UPDATE "OrderStatus" SET "isInitial" = true WHERE "name" = 'Pending';
UPDATE "OrderStatus" SET "isInitial" = false WHERE "name" != 'Pending';

UPDATE "OrderStatus" SET "isFinal" = true WHERE "name" = 'Damaged';
UPDATE "OrderStatus" SET "isFinal" = false WHERE "name" != 'Damaged';
