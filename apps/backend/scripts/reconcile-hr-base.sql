-- ============================================================================
-- reconcile-hr-base.sql
-- Idempotent reconciliation of the HR-domain BASE schema to the exact state the
-- migration chain expects at migration 20260823120001 (the state AFTER all
-- migrations strictly before it — verified from an authoritative shadow build).
--
-- WHY: production drift can leave these objects missing while _prisma_migrations
-- says they were applied -> `prisma migrate deploy` re-runs 20260823120001 and
-- fails P3018 "type PayslipStatus does not exist". This file CREATEs each object
-- IF ABSENT and SKIPS it if present (create-if-missing / skip-if-exists), so it
-- is safe to run on every boot, never loses data, and heals the drift so the
-- pending migrations then apply cleanly.
--
-- Definitions below are the APPLIED-STATE shapes (NOT the current-schema shapes):
--   - PayslipStatus enum  : draft, approved, paid, cancelled  (no reviewed/partially_paid yet)
--   - Payslip table       : NO reviewedAt/approvedAt/periodKey yet
--   - Employee table      : has accessPresetId/betterAuthUserId/profilePictureUrl,
--                           WITHOUT reportingToId/dateOfBirth/etc. (those come from
--                           LATER pending migrations)
-- ============================================================================

-- ---- Enums (create-if-absent) -------------------------------------------------
DO $$ BEGIN CREATE TYPE "EmploymentType" AS ENUM ('full_time','part_time','contract','internship');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "EmployeeStatus" AS ENUM ('active','inactive','terminated','resigned');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "PayslipStatus" AS ENUM ('draft','approved','paid','cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "AccountType" AS ENUM ('asset','liability','equity','income','expense');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---- Tables (create-if-absent) ------------------------------------------------
CREATE TABLE IF NOT EXISTS "AccessPreset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccessPreset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Designation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Designation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Employee" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "departmentId" TEXT,
    "designationId" TEXT,
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'full_time',
    "status" "EmployeeStatus" NOT NULL DEFAULT 'active',
    "joiningDate" TIMESTAMP(3) NOT NULL,
    "exitDate" TIMESTAMP(3),
    "salary" DECIMAL(10,2),
    "bankAccountNo" TEXT,
    "bankName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accessPresetId" TEXT,
    "betterAuthUserId" TEXT NOT NULL,
    "profilePictureUrl" TEXT,
    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SalaryStructure" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "basicSalary" DECIMAL(10,2) NOT NULL,
    "houseAllowance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "medicalAllowance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "transportAllowance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "otherAllowance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "insuranceDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "otherDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalEarnings" DECIMAL(10,2) NOT NULL,
    "totalDeductions" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netSalary" DECIMAL(10,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalaryStructure_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Payslip" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalEarnings" DECIMAL(10,2) NOT NULL,
    "totalDeductions" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(10,2) NOT NULL,
    "status" "PayslipStatus" NOT NULL DEFAULT 'draft',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PayslipItem" (
    "id" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    CONSTRAINT "PayslipItem_pkey" PRIMARY KEY ("id")
);

-- ---- Unique indexes + relation indexes (create-if-absent) --------------------
CREATE UNIQUE INDEX IF NOT EXISTS "AccessPreset_name_key" ON "AccessPreset"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Department_name_key" ON "Department"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Department_slug_key" ON "Department"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Designation_name_key" ON "Designation"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Designation_slug_key" ON "Designation"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Employee_employeeId_key" ON "Employee"("employeeId");
CREATE UNIQUE INDEX IF NOT EXISTS "Employee_betterAuthUserId_key" ON "Employee"("betterAuthUserId");
CREATE INDEX IF NOT EXISTS "Employee_departmentId_idx" ON "Employee"("departmentId");
CREATE INDEX IF NOT EXISTS "Employee_designationId_idx" ON "Employee"("designationId");
CREATE INDEX IF NOT EXISTS "Employee_accessPresetId_idx" ON "Employee"("accessPresetId");
CREATE INDEX IF NOT EXISTS "Employee_status_idx" ON "Employee"("status");
CREATE INDEX IF NOT EXISTS "SalaryStructure_employeeId_idx" ON "SalaryStructure"("employeeId");
CREATE INDEX IF NOT EXISTS "Payslip_employeeId_idx" ON "Payslip"("employeeId");
CREATE INDEX IF NOT EXISTS "Payslip_status_idx" ON "Payslip"("status");
CREATE INDEX IF NOT EXISTS "Payslip_periodStart_periodEnd_idx" ON "Payslip"("periodStart", "periodEnd");
CREATE INDEX IF NOT EXISTS "PayslipItem_payslipId_idx" ON "PayslipItem"("payslipId");

-- ---- Foreign keys (add-if-absent, guarded) -----------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Employee_departmentId_fkey') THEN
    ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey"
      FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Employee_designationId_fkey') THEN
    ALTER TABLE "Employee" ADD CONSTRAINT "Employee_designationId_fkey"
      FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Employee_accessPresetId_fkey') THEN
    ALTER TABLE "Employee" ADD CONSTRAINT "Employee_accessPresetId_fkey"
      FOREIGN KEY ("accessPresetId") REFERENCES "AccessPreset"("id") ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Employee_betterAuthUserId_fkey') THEN
    ALTER TABLE "Employee" ADD CONSTRAINT "Employee_betterAuthUserId_fkey"
      FOREIGN KEY ("betterAuthUserId") REFERENCES better_auth_users("id") ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SalaryStructure_employeeId_fkey') THEN
    ALTER TABLE "SalaryStructure" ADD CONSTRAINT "SalaryStructure_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Payslip_employeeId_fkey') THEN
    ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayslipItem_payslipId_fkey') THEN
    ALTER TABLE "PayslipItem" ADD CONSTRAINT "PayslipItem_payslipId_fkey"
      FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;
