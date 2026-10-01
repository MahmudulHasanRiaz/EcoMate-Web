-- Canonical sales-attribution dimensions: Channel · ChannelEntity · Source ·
-- AcquisitionType, plus an extensible SourcePlatform registry.
--
-- ADDITIVE ONLY. The legacy columns (source, salesChannel, sourcePlatform,
-- sourceType, sourceEntity) are untouched — not renamed, not dropped, not
-- rewritten. That is deliberate:
--   · the currently-running container neither reads nor writes the new columns,
--     so this is safe to apply while it serves traffic;
--   · the previous application version keeps working against the migrated
--     database at any later point.
--
-- ROLLBACK — read before deploying:
--   · PRE-CUTOVER (this migration applied, application not yet writing canonical
--     fields): DROP COLUMN is safe. No canonical data exists to lose.
--   · POST-CUTOVER (the application has written any canonical field): DO NOT DROP
--     COLUMNS. Dropping them would permanently destroy canonical information.
--     Roll back by reverting the APPLICATION only — the legacy columns remain
--     intact and authoritative, so the old version works unchanged. Investigate
--     and recover forward.
--
-- LOCKING: designed to be additive and low-risk under live traffic (nullable
-- columns, no default rewrites, one new table). Actual lock duration and traffic
-- impact MUST be measured against a production-like database before deploying —
-- do not treat that as a guarantee.
--
-- Backfill is intentionally NOT in this file: keeping the data migration out of
-- the schema migration means a partially-migrated database is safe, and the
-- guard is a separate marker column (channelMappedAt), never a business value.
--
-- NOTE: the Order_returnOfOrderId FK is pre-existing drift from the RTN work and
-- is deliberately excluded from this migration, as in 20260930020000.

-- CreateEnum
CREATE TYPE "SalesChannelV2" AS ENUM ('WEBSITE', 'MESSAGING', 'PHONE_CALL', 'POS');

-- CreateEnum
CREATE TYPE "AcquisitionType" AS ENUM ('PAID', 'ORGANIC', 'DIRECT', 'UNKNOWN');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "acquisitionType" "AcquisitionType",
ADD COLUMN     "channel" "SalesChannelV2",
ADD COLUMN     "channelEntity" TEXT,
ADD COLUMN     "channelMappedAt" TIMESTAMP(3),
ADD COLUMN     "sourceSlug" TEXT;

-- CreateTable
CREATE TABLE "SourcePlatform" (
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "capabilities" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcePlatform_pkey" PRIMARY KEY ("slug")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SourcePlatform_capabilities_idx" ON "SourcePlatform" USING GIN ("capabilities");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SourcePlatform_enabled_sortOrder_idx" ON "SourcePlatform"("enabled", "sortOrder");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_channel_idx" ON "Order"("channel");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_sourceSlug_idx" ON "Order"("sourceSlug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_channelMappedAt_idx" ON "Order"("channelMappedAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_sourceSlug_fkey" FOREIGN KEY ("sourceSlug") REFERENCES "SourcePlatform"("slug") ON DELETE SET NULL ON UPDATE CASCADE;
