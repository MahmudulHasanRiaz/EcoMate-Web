-- Rollback for 20261014000400_steadfast_credential_sets.
-- Drops the booking-set link first (FK), then the sets table.
-- Legacy single-row credentials are untouched, so dispatch keeps working
-- on the default profile after rollback.

ALTER TABLE "Dispatch" DROP CONSTRAINT IF EXISTS "Dispatch_credentialSetId_fkey";
DROP INDEX IF EXISTS "Dispatch_credentialSetId_idx";
ALTER TABLE "Dispatch" DROP COLUMN IF EXISTS "credentialSetId";

DROP INDEX IF EXISTS "CourierCredentialSet_courier_idx";
DROP INDEX IF EXISTS "CourierCredentialSet_courier_label_key";
DROP TABLE IF EXISTS "CourierCredentialSet";
