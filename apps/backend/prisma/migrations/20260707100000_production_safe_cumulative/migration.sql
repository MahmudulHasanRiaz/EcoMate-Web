-- Production-safe cumulative migration
-- Every operation guarded to never destroy data

-- ==============================
-- 1. New tables
-- ==============================
CREATE TABLE IF NOT EXISTS "AccessPreset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccessPreset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "auth_settings" (
    "id" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "auth_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CustomerProfile" (
    "id" TEXT NOT NULL,
    "betterAuthUserId" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerProfile_pkey" PRIMARY KEY ("id")
);

-- ==============================
-- 2. New columns (IF NOT EXISTS)
-- ==============================
ALTER TABLE "Address" ADD COLUMN IF NOT EXISTS "customerProfileId" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "accessPresetId" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "betterAuthUserId" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "profilePictureUrl" TEXT;
ALTER TABLE "better_auth_users" ADD COLUMN IF NOT EXISTS "override_permissions" TEXT[];
ALTER TABLE "better_auth_users" ADD COLUMN IF NOT EXISTS "role" TEXT DEFAULT 'customer';
-- Note: expense on JournalEntry, settings on User, customerProfile/employee on
-- better_auth_users are relation fields, not scalar columns. No SQL needed.

-- ==============================
-- 3. Indexes (IF NOT EXISTS)
-- ==============================
CREATE UNIQUE INDEX IF NOT EXISTS "AccessPreset_name_key" ON "AccessPreset"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "auth_settings_providerName_key" ON "auth_settings"("providerName");
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerProfile_betterAuthUserId_key" ON "CustomerProfile"("betterAuthUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerProfile_phone_key" ON "CustomerProfile"("phone");
CREATE UNIQUE INDEX IF NOT EXISTS "Employee_betterAuthUserId_key" ON "Employee"("betterAuthUserId");
CREATE INDEX IF NOT EXISTS "Address_customerProfileId_idx" ON "Address"("customerProfileId");
CREATE INDEX IF NOT EXISTS "CustomerProfile_email_idx" ON "CustomerProfile"("email");
CREATE INDEX IF NOT EXISTS "Employee_accessPresetId_idx" ON "Employee"("accessPresetId");

-- ==============================
-- 4. Foreign keys (check existence)
-- ==============================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CustomerProfile_betterAuthUserId_fkey') THEN
    ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_betterAuthUserId_fkey"
      FOREIGN KEY ("betterAuthUserId") REFERENCES "better_auth_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Address_customerProfileId_fkey') THEN
    ALTER TABLE "Address" ADD CONSTRAINT "Address_customerProfileId_fkey"
      FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- Drop old FK if it points to User instead of CustomerProfile
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Order_customerId_fkey' AND pg_get_constraintdef(oid) LIKE '%"User"%') THEN
    ALTER TABLE "Order" DROP CONSTRAINT "Order_customerId_fkey";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Order_customerId_fkey') THEN
    ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Employee_accessPresetId_fkey') THEN
    ALTER TABLE "Employee" ADD CONSTRAINT "Employee_accessPresetId_fkey"
      FOREIGN KEY ("accessPresetId") REFERENCES "AccessPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Employee_betterAuthUserId_fkey') THEN
    ALTER TABLE "Employee" ADD CONSTRAINT "Employee_betterAuthUserId_fkey"
      FOREIGN KEY ("betterAuthUserId") REFERENCES "better_auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ==============================
-- 5. AuthSettings → auth_settings (safe migration, keeps old table)
--    Only migrates data if old table exists. Old table preserved for safety.
-- ==============================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'AuthSettings') THEN
    IF (SELECT count(*) FROM "AuthSettings") > 0 AND (SELECT count(*) FROM "auth_settings") = 0 THEN
      INSERT INTO "auth_settings" ("id", "providerName", "isEnabled", "clientId", "clientSecret", "createdAt", "updatedAt")
      SELECT "id", "provider_name", "is_enabled", "client_id", "client_secret", "createdAt", "updatedAt" FROM "AuthSettings";
    END IF;
    -- Old table NOT dropped — preserved for safety. Remove manually after verifying.
  END IF;
END $$;

-- ==============================
-- 7. Make Address.userId optional
-- ==============================
ALTER TABLE "Address" ALTER COLUMN "userId" DROP NOT NULL;

-- ==============================
-- 8. Employee.betterAuthUserId SET NOT NULL (guarded)
--    Only runs if ZERO rows have NULL — never fails, never crashes.
-- ==============================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Employee" WHERE "betterAuthUserId" IS NULL) THEN
    ALTER TABLE "Employee" ALTER COLUMN "betterAuthUserId" SET NOT NULL;
  ELSE
    RAISE NOTICE 'Employee.betterAuthUserId has NULL rows — skipped SET NOT NULL. Fix manually.';
  END IF;
END $$;
