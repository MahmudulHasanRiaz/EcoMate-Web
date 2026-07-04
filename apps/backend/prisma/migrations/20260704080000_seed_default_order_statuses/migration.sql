-- Seed default order statuses
-- These must exist before the system can create orders

INSERT INTO "OrderStatus" ("id", "name", "color", "isInitial", "isFinal", "sortOrder", "createdAt")
SELECT gen_random_uuid(), 'Pending', '#F59E0B', true, false, 1, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Pending');

INSERT INTO "OrderStatus" ("id", "name", "color", "isInitial", "isFinal", "sortOrder", "createdAt")
SELECT gen_random_uuid(), 'Payment Pending', '#F59E0B', false, false, 2, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Payment Pending');

INSERT INTO "OrderStatus" ("id", "name", "color", "isInitial", "isFinal", "sortOrder", "createdAt")
SELECT gen_random_uuid(), 'Confirmed', '#3B82F6', false, false, 3, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Confirmed');

INSERT INTO "OrderStatus" ("id", "name", "color", "isInitial", "isFinal", "sortOrder", "createdAt")
SELECT gen_random_uuid(), 'Processing', '#3B82F6', false, false, 4, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Processing');

-- Packed and Packing Hold were added by a previous migration at sortOrder 3 and 4.
-- This migration adjusts their sortOrder to fit the full flow.

UPDATE "OrderStatus" SET "sortOrder" = 5 WHERE "name" = 'Packed' AND "sortOrder" = 3;

UPDATE "OrderStatus" SET "sortOrder" = 6 WHERE "name" = 'Packing Hold' AND "sortOrder" = 4;

INSERT INTO "OrderStatus" ("id", "name", "color", "isInitial", "isFinal", "sortOrder", "createdAt")
SELECT gen_random_uuid(), 'Shipped', '#06B6D4', false, false, 7, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Shipped');

INSERT INTO "OrderStatus" ("id", "name", "color", "isInitial", "isFinal", "sortOrder", "createdAt")
SELECT gen_random_uuid(), 'Delivered', '#16A34A', false, true, 8, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Delivered');

INSERT INTO "OrderStatus" ("id", "name", "color", "isInitial", "isFinal", "sortOrder", "createdAt")
SELECT gen_random_uuid(), 'Cancelled', '#DC2626', false, true, 9, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Cancelled');

INSERT INTO "OrderStatus" ("id", "name", "color", "isInitial", "isFinal", "sortOrder", "createdAt")
SELECT gen_random_uuid(), 'Refunded', '#F59E0B', false, true, 10, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Refunded');

INSERT INTO "OrderStatus" ("id", "name", "color", "isInitial", "isFinal", "sortOrder", "createdAt")
SELECT gen_random_uuid(), 'Return Pending', '#EC4899', false, false, 11, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Return Pending');
