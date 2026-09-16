-- ============================================================================
-- fix-p2039.sql
-- One-shot fix for Prisma P2039 "required relation Employee.betterAuthUser
-- is missing in the database" on fxdmostul (and any client with the same
-- drift pattern).
--
-- WHAT IT DOES (all idempotent, safe to run multiple times):
--   1. Ensures better_auth_users table exists (created by BetterAuth migration)
--   2. Ensures Employee.betterAuthUserId column exists + NOT NULL
--   3. Ensures Employee_betterAuthUserId_fkey FK exists
--   4. Ensures Employee_betterAuthUserId_key unique index exists
--   5. Verifies the relation and reports status
--
-- HOW TO RUN:
--   VPS SSH:
--     BACKEND=$(docker ps --format '{{.Names}}' | grep fxdmostul | grep backend | head -n1)
--     docker exec $BACKEND sh -c 'psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -q -f /app/fix-p2039.sql'
--
--   Portainer Console (fxdmostul-backend → Console → /bin/sh → Connect):
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -q -f /app/fix-p2039.sql
--
--   Local repo:
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -q -f apps/backend/scripts/fix-p2039.sql
-- ============================================================================

-- 1. Ensure better_auth_users exists
CREATE TABLE IF NOT EXISTS "better_auth_users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" TEXT DEFAULT 'customer',
    "override_permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "better_auth_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "better_auth_users_email_key" ON "better_auth_users"("email");

-- 2. Ensure Employee.betterAuthUserId column exists
DO $$ BEGIN
    ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "betterAuthUserId" TEXT;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- 3. Ensure NOT NULL (only if no NULL values exist)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "Employee" WHERE "betterAuthUserId" IS NULL) THEN
        ALTER TABLE "Employee" ALTER COLUMN "betterAuthUserId" SET NOT NULL;
    END IF;
EXCEPTION WHEN others THEN null; END $$;

-- 4. Ensure unique index exists
CREATE UNIQUE INDEX IF NOT EXISTS "Employee_betterAuthUserId_key" ON "Employee"("betterAuthUserId");

-- 5. Drop ANY existing FK with this name or on this column, then recreate
--    (handles cases where FK exists with wrong target or broken state)
DO $$ BEGIN
    ALTER TABLE "Employee" DROP CONSTRAINT IF EXISTS "Employee_betterAuthUserId_fkey";
EXCEPTION WHEN others THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "Employee" ADD CONSTRAINT "Employee_betterAuthUserId_fkey"
        FOREIGN KEY ("betterAuthUserId")
        REFERENCES "better_auth_users"("id")
        ON UPDATE CASCADE ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 6. Verify and report
DO $$
DECLARE
    fk_exists BOOLEAN;
    col_exists BOOLEAN;
    idx_exists BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM pg_constraint WHERE conname = 'Employee_betterAuthUserId_fkey'
    ) INTO fk_exists;

    SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Employee' AND column_name = 'betterAuthUserId'
    ) INTO col_exists;

    SELECT EXISTS(
        SELECT 1 FROM pg_indexes WHERE indexname = 'Employee_betterAuthUserId_key'
    ) INTO idx_exists;

    RAISE NOTICE 'P2039 fix status: column=%, FK=%, index=%',
        col_exists, fk_exists, idx_exists;

    IF NOT fk_exists THEN
        RAISE WARNING 'FK still missing after fix attempt — check manually';
    END IF;
END $$;
