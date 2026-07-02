-- Replace @@unique([hash]) with @@index([hash]) on Media
-- Prisma v7 @prisma/adapter-pg mishandles nullable unique constraints in INSERT queries

DROP INDEX IF EXISTS "Media_hash_key";
CREATE INDEX IF NOT EXISTS "Media_hash_idx" ON "Media"("hash");
