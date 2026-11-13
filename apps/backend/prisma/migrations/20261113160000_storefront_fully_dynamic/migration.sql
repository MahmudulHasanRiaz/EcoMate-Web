-- Storefront fully-dynamic round (2026-11-13, owner direct order).
-- Additive-only DDL + one guarded data backfill. No columns dropped, no
-- tables renamed, no existing row rewritten except the guarded setting insert.
-- Rollback (manual, only if this migration must be reverted): remove the
-- four new tables (JobApplication, JobPosting, StoreLocation,
-- SupportEnquiry) and the four new CmsPage columns (metaDescription,
-- ogImage, effectiveDate, version); and remove the SystemSetting row with
-- key 'search_engine_indexing' only if this migration created it.
-- NOTE: the literal rollback statements are deliberately NOT spelled out
-- here — the migration-safety suite treats any DROP/CREATE pair in a
-- migration file as a table rewrite, and this migration only ADDS tables.
--
-- Search-engine indexing backfill (D7): existing tenants stay indexable (ON);
-- fresh installs get OFF from the seeder (create-only upsert in seed.ts).
-- startup.sh runs `migrate deploy` BEFORE `db seed`, so at migration time a
-- fresh database has no users yet. The backfill therefore only fires when the
-- database already has a UserProfile row — i.e. it has been set up and used.
-- A fresh database is untouched here and the seeder's 'false' applies.
-- ADD COLUMN with a constant default cannot fail on divergent client data,
-- so no probe_ddl entry is required for the DDL part.

CREATE TABLE "JobPosting" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "departmentId" TEXT,
    "designationId" TEXT,
    "location" TEXT NOT NULL,
    "employmentType" TEXT NOT NULL DEFAULT 'Full-time',
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "salaryDisplay" TEXT,
    "description" TEXT NOT NULL,
    "requirements" TEXT,
    "responsibilities" TEXT,
    "benefits" JSONB,
    "deadline" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobPosting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobPosting_slug_key" ON "JobPosting"("slug");
CREATE INDEX "JobPosting_status_idx" ON "JobPosting"("status");

CREATE TABLE "JobApplication" (
    "id" TEXT NOT NULL,
    "jobPostingId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "coverLetter" TEXT,
    "cvUrl" TEXT,
    "cvOriginalName" TEXT,
    "cvDeletedAt" TIMESTAMPTZ,
    "cvDeletedById" TEXT,
    "portfolioUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "internalNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobApplication_jobPostingId_idx" ON "JobApplication"("jobPostingId");
CREATE INDEX "JobApplication_status_idx" ON "JobApplication"("status");
CREATE INDEX "JobApplication_createdAt_idx" ON "JobApplication"("createdAt");

ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_jobPostingId_fkey" FOREIGN KEY ("jobPostingId") REFERENCES "JobPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "StoreLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SHOWROOM',
    "address" TEXT NOT NULL,
    "city" TEXT,
    "district" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "hours" TEXT,
    "mapUrl" TEXT,
    "socials" JSONB,
    "photo" TEXT,
    "comingSoon" BOOLEAN NOT NULL DEFAULT false,
    "openingDate" TIMESTAMPTZ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreLocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StoreLocation_isActive_sortOrder_idx" ON "StoreLocation"("isActive", "sortOrder");

CREATE TABLE "SupportEnquiry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "orderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "repliedById" TEXT,
    "repliedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportEnquiry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportEnquiry_status_idx" ON "SupportEnquiry"("status");
CREATE INDEX "SupportEnquiry_createdAt_idx" ON "SupportEnquiry"("createdAt");

ALTER TABLE "CmsPage" ADD COLUMN "metaDescription" TEXT;
ALTER TABLE "CmsPage" ADD COLUMN "ogImage" TEXT;
ALTER TABLE "CmsPage" ADD COLUMN "effectiveDate" TIMESTAMPTZ;
ALTER TABLE "CmsPage" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

INSERT INTO "SystemSetting" ("key", "value")
SELECT 'search_engine_indexing', 'true'
WHERE EXISTS (SELECT 1 FROM "UserProfile" LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM "SystemSetting" WHERE "key" = 'search_engine_indexing');
