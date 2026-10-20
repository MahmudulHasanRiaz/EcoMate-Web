-- Return.createdBy: staff performer recorded at creation (email). NULL when
-- the row came from a courier webhook / reconcile (no staff actor existed).
-- DDL-only, additive, backfill-free (historical rows stay NULL → UI shows '—').
ALTER TABLE "Return" ADD COLUMN "createdBy" TEXT;
