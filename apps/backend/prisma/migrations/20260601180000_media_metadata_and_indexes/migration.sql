-- AlterTable: extend Media with metadata used by the unified Media Library.
-- NOTE: statements are split because Postgres' prepared-statement protocol
-- rejects multi-command `$executeRaw` calls; each ALTER runs separately so
-- `prisma migrate deploy` succeeds without manual intervention.

ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "hash"      TEXT;
ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "alt"       TEXT;
ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "width"     INTEGER;
ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "height"    INTEGER;
ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT;

-- Unique hash for content-deduplication (sha256 of binary).
CREATE UNIQUE INDEX IF NOT EXISTS "Media_hash_key" ON "Media"("hash");

-- Fast lookup when resolving an entity-stored URL back to a Media row.
CREATE INDEX IF NOT EXISTS "Media_url_idx" ON "Media"("url");

-- Fast reverse lookup of all media attached to a given entity.
CREATE INDEX IF NOT EXISTS "MediaAttachment_entityType_entityId_idx"
  ON "MediaAttachment"("entityType", "entityId");
