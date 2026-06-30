-- CreateTable (safe: IF NOT EXISTS avoids P3018 when table already exists)
CREATE TABLE IF NOT EXISTS "LicenseActivation" (
    "id" TEXT NOT NULL,
    "licenseKey" TEXT NOT NULL,
    "keymateUrl" TEXT NOT NULL,
    "domain" TEXT,
    "apiKey" TEXT,
    "licenseInfo" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastCheckIn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenseActivation_pkey" PRIMARY KEY ("id")
);

