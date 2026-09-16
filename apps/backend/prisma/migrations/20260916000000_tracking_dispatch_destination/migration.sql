-- Step 3 — destination-aware TrackingDispatch identity.
--
-- Change: (snapshotId, provider) -> (snapshotId, provider, destinationId), plus a
-- pinned `pixelId` delivery identity.
--
-- SAFETY: purely additive. The previous unique key (snapshotId, provider) was
-- STRICTER than the new (snapshotId, provider, destinationId), so no existing row
-- can collide under the new index and no table rewrite is required. Existing rows
-- receive destinationId = 'default', which is the real identity of the pre-Step-3
-- single destination (not a placeholder) — historical dispatches stay readable and
-- retryable, and are never re-captured or backfilled.
--
-- `destinationId` is NOT NULL with a default: a nullable column would make
-- Postgres treat NULLs as distinct and silently defeat the unique index.

-- ADD COLUMN with a constant default is metadata-only in PostgreSQL 11+.
ALTER TABLE "TrackingDispatch"
  ADD COLUMN "destinationId" TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN "pixelId" TEXT;

-- Swap the composite identity and the provider scan index.
DROP INDEX "TrackingDispatch_snapshotId_provider_key";
DROP INDEX "TrackingDispatch_provider_status_createdAt_idx";

CREATE UNIQUE INDEX "TrackingDispatch_snapshotId_provider_destinationId_key"
  ON "TrackingDispatch"("snapshotId", "provider", "destinationId");

CREATE INDEX "TrackingDispatch_provider_destinationId_status_createdAt_idx"
  ON "TrackingDispatch"("provider", "destinationId", "status", "createdAt");
