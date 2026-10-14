-- Manual dispatch rows may be created before the courier booking exists
-- (identifiers backfilled by the courier webhook). Relax the column.
ALTER TABLE "Dispatch" ALTER COLUMN "consignmentId" DROP NOT NULL;
