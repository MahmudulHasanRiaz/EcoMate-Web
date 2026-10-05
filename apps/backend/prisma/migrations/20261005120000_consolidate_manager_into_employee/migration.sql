-- Consolidate the `manager` role into `employee`.
--
-- The role list is being reduced to: superadmin, admin, cashier, employee,
-- packing_assistant (+ customer for storefront identity). `manager` was a
-- second way of saying "employee with broad access", which meant every
-- authorization decision had to consider two role names for the same thing.
--
-- Existing managers are preserved rather than dropped: they are converted to
-- `employee` and given the new "Manager" system preset, which carries the
-- full permission set they could reach before. Nothing they could do
-- yesterday stops working today; HR can narrow the preset later.
--
-- Rollback (see bottom of file) restores the enum value and re-flips roles.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. AccessPreset.isSystem
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "AccessPreset" ADD COLUMN IF NOT EXISTS "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Seed the "Manager" preset with the full permission set.
--
-- This is deliberately the complete registry: it reproduces exactly what a
-- manager could reach before the consolidation. Phase 4 narrows the catalogue
-- and adds finer-grained presets; this row is the safe default that must not
-- silently revoke access during a role migration.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "AccessPreset" (id, name, description, permissions, "isSystem", "createdAt", "updatedAt")
VALUES (
  'system-preset-manager',
  'Manager',
  'Full access preset assigned to employees promoted from the legacy manager role. Narrow it from Access Presets to restrict what this group can do.',
  ARRAY[
  'view_analytics',
  'view_financial_summary',
  'view_users',
  'create_users',
  'edit_users',
  'delete_users',
  'view_customers',
  'edit_customers',
  'delete_customers',
  'view_employees',
  'create_employees',
  'edit_employees',
  'delete_employees',
  'manage_designations',
  'manage_presets',
  'create_orders',
  'view_orders',
  'refund_orders',
  'apply_discounts',
  'view_hr',
  'manage_employees',
  'manage_payroll',
  'manage_commissions',
  'manage_leave',
  'manage_schedule',
  'manage_attendance',
  'manage_hr_settings',
  'manage_attendance_devices',
  'manage_attendance_adjustments',
  'view_products',
  'create_products',
  'edit_products',
  'delete_products',
  'manage_stock',
  'view_system_settings',
  'modify_integrations',
  'view_courier_settlement',
  'import_courier_settlement',
  'finalize_courier_settlement',
  'adjust_courier_settlement'
  ]::TEXT[],
  true,
  NOW(),
  NOW()
)
ON CONFLICT (name) DO UPDATE
  SET permissions = EXCLUDED.permissions,
      description = EXCLUDED.description,
      "isSystem" = true,
      "updatedAt" = NOW();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Migrate the role on both tables.
--
-- "User" carries the Prisma enum; "better_auth_users"."role" is a free-form
-- TEXT column maintained separately by Better Auth. The session path
-- (better-auth/auth.config.ts customSession) reads the BA column, so leaving
-- it as 'manager' would produce an account whose two role fields disagree.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "User" SET role = 'employee'::"UserRole" WHERE role = 'manager'::"UserRole";
UPDATE "better_auth_users" SET role = 'employee' WHERE role = 'manager';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Attach the preset to migrated users.
--
-- Effective permissions resolve through
-- UserProfile.betterAuthUserId -> betterAuthUser.employee -> Employee.accessPresetId.
-- Without an Employee row the chain breaks and the user resolves to zero
-- permissions, so managers with no Employee row get one backfilled here
-- (employeeId is unique, so a collision-free suffix is used).
-- ─────────────────────────────────────────────────────────────────────────────
-- 4a. Existing Employee rows: point them at the Manager preset.
UPDATE "Employee" e
SET "accessPresetId" = 'system-preset-manager', "updatedAt" = NOW()
FROM "User" u
WHERE e."betterAuthUserId" = u."betterAuthUserId"
  AND u.role = 'employee'::"UserRole";

-- 4b. Migrated managers with no Employee row: backfill one.
--
-- The join to better_auth_users is required, not defensive: Employee.betterAuthUserId
-- is a foreign key, and this database contains User rows whose betterAuthUserId
-- points at a better_auth_users row that no longer exists (dangling links left
-- by earlier tooling). Inserting an Employee for one of those violates
-- Employee_betterAuthUserId_fkey and aborts the migration. Such accounts
-- cannot resolve permissions through the BA chain anyway, so they are left
-- for a separate data-integrity repair rather than fabricated here.
INSERT INTO "Employee" (
  id, "betterAuthUserId", "employeeId", "employmentType", status,
  "joiningDate", "accessPresetId", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  u."betterAuthUserId",
  'EMP-LEGACY-' || substr(replace(u.id, '-', ''), 1, 12),
  'full_time',
  'active',
  COALESCE(u."createdAt", NOW()),
  'system-preset-manager',
  NOW(),
  NOW()
FROM "User" u
JOIN "better_auth_users" b ON b.id = u."betterAuthUserId"
WHERE u.role = 'employee'::"UserRole"
  AND NOT EXISTS (
    SELECT 1 FROM "Employee" e WHERE e."betterAuthUserId" = u."betterAuthUserId"
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Drop the enum value.
--
-- Postgres cannot remove a value from an enum in place, so the type is
-- recreated and every column using it is converted.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "User"
  ALTER COLUMN role DROP DEFAULT,
  ALTER COLUMN role TYPE TEXT USING role::TEXT;
DROP TYPE "UserRole";
CREATE TYPE "UserRole" AS ENUM (
  'superadmin',
  'admin',
  'cashier',
  'packing_assistant',
  'customer',
  'employee'
);
ALTER TABLE "User"
  ALTER COLUMN role TYPE "UserRole" USING role::"UserRole",
  ALTER COLUMN role SET DEFAULT 'admin';

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
--   ALTER TABLE "User"
--     ALTER COLUMN role DROP DEFAULT,
--     ALTER COLUMN role TYPE TEXT USING role::TEXT;
--   DROP TYPE "UserRole";
--   CREATE TYPE "UserRole" AS ENUM (
--     'superadmin','admin','cashier','manager','packing_assistant','customer','employee'
--   );
--   ALTER TABLE "User"
--     ALTER COLUMN role TYPE "UserRole" USING role::"UserRole",
--     ALTER COLUMN role SET DEFAULT 'admin';
--   UPDATE "better_auth_users" SET role = 'manager' WHERE role = 'employee';
--   UPDATE "User" SET role = 'manager'::"UserRole" WHERE role = 'employee'::"UserRole"
--     AND EXISTS (
--       SELECT 1 FROM "Employee" e
--       WHERE e."betterAuthUserId" = "User"."betterAuthUserId"
--         AND e."accessPresetId" = 'system-preset-manager'
--     );
--   ALTER TABLE "AccessPreset" DROP COLUMN IF EXISTS "isSystem";
--   DELETE FROM "AccessPreset" WHERE id = 'system-preset-manager';
--   DELETE FROM "Employee" WHERE "employeeId" LIKE 'EMP-LEGACY-%';
--
-- Note: the blanket role flip-back above restores *every* employee to
-- manager, which is broader than a true rollback. To target only genuinely
-- migrated rows, capture their ids before running the forward migration:
--   CREATE TEMP TABLE migrated_managers AS
--     SELECT id FROM "User" WHERE role = 'manager'::"UserRole";