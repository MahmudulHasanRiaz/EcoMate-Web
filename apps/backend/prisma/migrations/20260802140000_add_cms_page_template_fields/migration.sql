-- AlterTable
ALTER TABLE "CmsPage" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'content';
ALTER TABLE "CmsPage" ADD COLUMN "templateKey" TEXT;
ALTER TABLE "CmsPage" ADD COLUMN "config" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "CmsPage_templateKey_key" ON "CmsPage"("templateKey");

-- CreateIndex
CREATE INDEX "CmsPage_type_idx" ON "CmsPage"("type");
