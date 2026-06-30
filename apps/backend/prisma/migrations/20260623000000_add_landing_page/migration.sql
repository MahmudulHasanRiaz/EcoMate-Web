-- Create LandingPage table (safe: IF NOT EXISTS avoids P3018 when table already exists)
CREATE TABLE IF NOT EXISTS "LandingPage" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "pageType" TEXT NOT NULL DEFAULT 'template',
    "templateId" TEXT,
    "sections" JSONB DEFAULT '[]',
    "customHtml" TEXT,
    "customCss" TEXT,
    "productIds" JSONB DEFAULT '[]',
    "comboIds" JSONB DEFAULT '[]',
    "trackingJson" JSONB DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "isDraft" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LandingPage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LandingPage_slug_key" ON "LandingPage"("slug");
