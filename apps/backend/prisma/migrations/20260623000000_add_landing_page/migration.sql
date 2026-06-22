-- Create LandingPage table
CREATE TABLE "LandingPage" (
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

-- Add missing indexes (schema drift from current schema)
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");

CREATE UNIQUE INDEX IF NOT EXISTS "UserSettings_userId_key" ON "UserSettings"("userId");
ALTER TABLE "UserSettings" ADD CONSTRAINT IF NOT EXISTS "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "VerificationToken_email_type_idx" ON "VerificationToken"("email", "type");
CREATE INDEX IF NOT EXISTS "VerificationToken_token_type_idx" ON "VerificationToken"("token", "type");

CREATE INDEX IF NOT EXISTS "reviews_productId_idx" ON "reviews"("productId");
ALTER TABLE "reviews" ADD CONSTRAINT IF NOT EXISTS "reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
