-- Remove DIRECT from AcquisitionType. DIRECT is a Source (registry slug
-- `direct` = "no marketing referrer"), never an acquisition classification.
-- AcquisitionType is now PAID | ORGANIC | UNKNOWN; NULL = not captured.
--
-- Redeploy-safe + additive in effect:
--   1. Stored DIRECT values are reclassified to NULL first (NULL already means
--      "not applicable / not captured" — no silent reclassification to a
--      different verdict, no rows deleted).
--   2. Postgres cannot DROP an enum value inside a transaction, so the enum is
--      swapped via a replacement type. No table/column/index is dropped.
--
-- Rollback (run OUTSIDE a transaction — PG forbids ADD VALUE in a txn block):
--   ALTER TYPE "AcquisitionType" ADD VALUE 'DIRECT';

-- 1. Reclassify any stored DIRECT as NULL.
UPDATE "Order" SET "acquisitionType" = NULL WHERE "acquisitionType" = 'DIRECT';

-- 2. Swap the enum type.
CREATE TYPE "AcquisitionType_new" AS ENUM ('PAID', 'ORGANIC', 'UNKNOWN');
ALTER TABLE "Order" ALTER COLUMN "acquisitionType" TYPE "AcquisitionType_new" USING "acquisitionType"::text::"AcquisitionType_new";
DROP TYPE "AcquisitionType";
ALTER TYPE "AcquisitionType_new" RENAME TO "AcquisitionType";
