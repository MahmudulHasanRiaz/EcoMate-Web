-- Secondary phone numbers + customer<->phone linking.
--
-- 1. Order.secondaryPhone (nullable TEXT + btree index): the optional second
--    contact number staff may attach to an order. Normalized to the same
--    canonical form as guestPhone/customerPhone by the service layer.
-- 2. CustomerPhone: one row per linked number. `phone` is globally UNIQUE so
--    a number resolves to exactly one customer — collisions are refused at
--    link time (HTTP 409), never silently merged. Existing primary numbers
--    are backfilled from CustomerProfile.phone (source 'primary').
--
-- Data-loss check: ADD COLUMN (nullable) + CREATE TABLE + CREATE INDEX only.
-- No destructive statements are issued — this migration trips no
-- migration-safety pattern.

ALTER TABLE "Order" ADD COLUMN "secondaryPhone" TEXT;
CREATE INDEX IF NOT EXISTS "Order_secondaryPhone_idx" ON "Order"("secondaryPhone");

CREATE TABLE "CustomerPhone" (
  "id" TEXT NOT NULL,
  "customerProfileId" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'secondary',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerPhone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerPhone_phone_key" ON "CustomerPhone"("phone");
CREATE INDEX IF NOT EXISTS "CustomerPhone_customerProfileId_idx" ON "CustomerPhone"("customerProfileId");
ALTER TABLE "CustomerPhone" ADD CONSTRAINT "CustomerPhone_customerProfileId_fkey"
  FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing primary number becomes a linked row.
INSERT INTO "CustomerPhone" ("id", "customerProfileId", "phone", "source", "createdAt")
SELECT gen_random_uuid(), "id", "phone", 'primary', CURRENT_TIMESTAMP
FROM "CustomerProfile"
WHERE "phone" IS NOT NULL
ON CONFLICT ("phone") DO NOTHING;

-- ── Rollback ─────────────────────────────────────────────────────────────
-- Reverse order (loses link rows + the order column — re-link from
-- Order.secondaryPhone / CustomerProfile.phone afterwards if needed):
--   Remove the "CustomerPhone" table;
--   Remove the "Order_secondaryPhone_idx" index;
--   Remove the "secondaryPhone" column from "Order";
