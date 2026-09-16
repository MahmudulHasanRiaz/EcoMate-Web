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
--
-- v2: Each FK is wrapped in its own DO $$ block with EXCEPTION handling so that
--     one FK failure (e.g., missing referenced table) does NOT abort all other FKs.
--     Also adds column-add guards for betterAuthUserId on Employee (P2039 fix).
-- v3: Fixes enum column type drift (db push created tables with TEXT columns).
--     ALTERs all enum columns from TEXT to proper Postgres enum types.
--     Adds missing enum values (reviewed, partially_paid, on_leave, suspended).
--     Creates all HR enums that may be missing.
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

-- Add missing enum values that later migrations expect (idempotent)
DO $$ BEGIN ALTER TYPE "PayslipStatus" ADD VALUE IF NOT EXISTS 'reviewed'; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE "PayslipStatus" ADD VALUE IF NOT EXISTS 'partially_paid'; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE "EmployeeStatus" ADD VALUE IF NOT EXISTS 'on_leave'; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE "EmployeeStatus" ADD VALUE IF NOT EXISTS 'suspended'; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Additional enums that may be missing if only db push was used
DO $$ BEGIN CREATE TYPE "LedgerStatus" AS ENUM ('draft','approved','paid');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "EarningType" AS ENUM ('bonus','incentive','commission','other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "DeductionType" AS ENUM ('fine','other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "CommissionAmountType" AS ENUM ('fixed','percent');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "LeaveStatus" AS ENUM ('pending','approved','rejected','cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT','ABSENT','LATE','HALF_DAY','ON_LEAVE','WEEKLY_OFF');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "EmployeeGender" AS ENUM ('MALE','FEMALE','OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "AttendanceMethod" AS ENUM ('APP','MACHINE','NONE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "AttendanceModeSetting" AS ENUM ('APP','MACHINE','BOTH');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "AttendanceSessionSource" AS ENUM ('APP','MACHINE','ADMIN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "BankAccountType" AS ENUM ('SAVINGS','CURRENT','OTHERS');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "BankVerificationStatus" AS ENUM ('PENDING','VERIFIED','REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "AttendanceDeviceSyncStatus" AS ENUM ('IDLE','CONNECTED','DISCONNECTED','SYNCING','FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "AttendanceEventType" AS ENUM ('CHECK_IN','CHECK_OUT','BREAK_START','BREAK_END','PUNCH');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "AttendanceEventStatus" AS ENUM ('PENDING','UNMAPPED','PROCESSED','FAILED','SKIPPED');
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

-- ---- Column additions (if table exists but column is missing — P2039 fix) -----
DO $$ BEGIN
    ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "betterAuthUserId" TEXT;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "accessPresetId" TEXT;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "profilePictureUrl" TEXT;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- ---- Fix enum column types (db push may have created tables with TEXT columns) --
-- NOTE: Must DROP DEFAULT before ALTER TYPE (Postgres can't auto-cast TEXT defaults to enums)
--       then SET DEFAULT after. Wrapped in DO blocks with EXCEPTION handling.

-- Payslip.status: TEXT -> PayslipStatus (default: 'draft')
DO $$ BEGIN
    ALTER TABLE "Payslip" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "Payslip" ALTER COLUMN "status" TYPE "PayslipStatus" USING "status"::"PayslipStatus";
    ALTER TABLE "Payslip" ALTER COLUMN "status" SET DEFAULT 'draft';
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter Payslip.status type: %', SQLERRM;
END $$;

-- Employee.status: TEXT -> EmployeeStatus (default: 'active')
DO $$ BEGIN
    ALTER TABLE "Employee" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "Employee" ALTER COLUMN "status" TYPE "EmployeeStatus" USING "status"::"EmployeeStatus";
    ALTER TABLE "Employee" ALTER COLUMN "status" SET DEFAULT 'active';
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter Employee.status type: %', SQLERRM;
END $$;

-- Employee.employmentType: TEXT -> EmploymentType (default: 'full_time')
DO $$ BEGIN
    ALTER TABLE "Employee" ALTER COLUMN "employmentType" DROP DEFAULT;
    ALTER TABLE "Employee" ALTER COLUMN "employmentType" TYPE "EmploymentType" USING "employmentType"::"EmploymentType";
    ALTER TABLE "Employee" ALTER COLUMN "employmentType" SET DEFAULT 'full_time';
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter Employee.employmentType type: %', SQLERRM;
END $$;

-- Employee.gender: TEXT -> EmployeeGender (added by later migration, may also be TEXT)
DO $$ BEGIN
    ALTER TABLE "Employee" ALTER COLUMN "gender" TYPE "EmployeeGender" USING "gender"::"EmployeeGender";
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter Employee.gender type: %', SQLERRM;
END $$;

-- Employee.gender: TEXT -> EmployeeGender (nullable, no default)
DO $$ BEGIN
    ALTER TABLE "Employee" ALTER COLUMN "gender" TYPE "EmployeeGender" USING "gender"::"EmployeeGender";
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter Employee.gender type: %', SQLERRM;
END $$;

-- Employee.attendanceMethod: TEXT -> AttendanceMethod (default: 'APP')
DO $$ BEGIN
    ALTER TABLE "Employee" ALTER COLUMN "attendanceMethod" DROP DEFAULT;
    ALTER TABLE "Employee" ALTER COLUMN "attendanceMethod" TYPE "AttendanceMethod" USING "attendanceMethod"::"AttendanceMethod";
    ALTER TABLE "Employee" ALTER COLUMN "attendanceMethod" SET DEFAULT 'APP';
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter Employee.attendanceMethod type: %', SQLERRM;
END $$;

-- AttendanceRecord.status: TEXT -> AttendanceStatus (no default)
DO $$ BEGIN
    ALTER TABLE "AttendanceRecord" ALTER COLUMN "status" TYPE "AttendanceStatus" USING "status"::"AttendanceStatus";
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter AttendanceRecord.status type: %', SQLERRM;
END $$;

-- AttendanceSettings.mode: TEXT -> AttendanceModeSetting (default: 'APP')
DO $$ BEGIN
    ALTER TABLE "AttendanceSettings" ALTER COLUMN "mode" DROP DEFAULT;
    ALTER TABLE "AttendanceSettings" ALTER COLUMN "mode" TYPE "AttendanceModeSetting" USING "mode"::"AttendanceModeSetting";
    ALTER TABLE "AttendanceSettings" ALTER COLUMN "mode" SET DEFAULT 'APP';
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter AttendanceSettings.mode type: %', SQLERRM;
END $$;

-- AttendanceDay.status: TEXT -> AttendanceStatus (no default)
DO $$ BEGIN
    ALTER TABLE "AttendanceDay" ALTER COLUMN "status" TYPE "AttendanceStatus" USING "status"::"AttendanceStatus";
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter AttendanceDay.status type: %', SQLERRM;
END $$;

-- AttendanceDay.attendanceMethod: TEXT -> AttendanceMethod (default: 'APP')
DO $$ BEGIN
    ALTER TABLE "AttendanceDay" ALTER COLUMN "attendanceMethod" DROP DEFAULT;
    ALTER TABLE "AttendanceDay" ALTER COLUMN "attendanceMethod" TYPE "AttendanceMethod" USING "attendanceMethod"::"AttendanceMethod";
    ALTER TABLE "AttendanceDay" ALTER COLUMN "attendanceMethod" SET DEFAULT 'APP';
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter AttendanceDay.attendanceMethod type: %', SQLERRM;
END $$;

-- AttendanceSession.source: TEXT -> AttendanceSessionSource (default: 'APP')
DO $$ BEGIN
    ALTER TABLE "AttendanceSession" ALTER COLUMN "source" DROP DEFAULT;
    ALTER TABLE "AttendanceSession" ALTER COLUMN "source" TYPE "AttendanceSessionSource" USING "source"::"AttendanceSessionSource";
    ALTER TABLE "AttendanceSession" ALTER COLUMN "source" SET DEFAULT 'APP';
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter AttendanceSession.source type: %', SQLERRM;
END $$;

-- EmployeeBankAccount.accountType: TEXT -> BankAccountType (nullable, no default)
DO $$ BEGIN
    ALTER TABLE "EmployeeBankAccount" ALTER COLUMN "accountType" TYPE "BankAccountType" USING "accountType"::"BankAccountType";
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter EmployeeBankAccount.accountType type: %', SQLERRM;
END $$;

-- EmployeeBankAccount.verificationStatus: TEXT -> BankVerificationStatus (default: 'PENDING')
DO $$ BEGIN
    ALTER TABLE "EmployeeBankAccount" ALTER COLUMN "verificationStatus" DROP DEFAULT;
    ALTER TABLE "EmployeeBankAccount" ALTER COLUMN "verificationStatus" TYPE "BankVerificationStatus" USING "verificationStatus"::"BankVerificationStatus";
    ALTER TABLE "EmployeeBankAccount" ALTER COLUMN "verificationStatus" SET DEFAULT 'PENDING';
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter EmployeeBankAccount.verificationStatus type: %', SQLERRM;
END $$;

-- AttendanceDevice.syncStatus: TEXT -> AttendanceDeviceSyncStatus (default: 'IDLE')
DO $$ BEGIN
    ALTER TABLE "AttendanceDevice" ALTER COLUMN "syncStatus" DROP DEFAULT;
    ALTER TABLE "AttendanceDevice" ALTER COLUMN "syncStatus" TYPE "AttendanceDeviceSyncStatus" USING "syncStatus"::"AttendanceDeviceSyncStatus";
    ALTER TABLE "AttendanceDevice" ALTER COLUMN "syncStatus" SET DEFAULT 'IDLE';
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter AttendanceDevice.syncStatus type: %', SQLERRM;
END $$;

-- RawAttendanceEvent.eventType: TEXT -> AttendanceEventType (no default)
DO $$ BEGIN
    ALTER TABLE "RawAttendanceEvent" ALTER COLUMN "eventType" TYPE "AttendanceEventType" USING "eventType"::"AttendanceEventType";
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter RawAttendanceEvent.eventType type: %', SQLERRM;
END $$;

-- RawAttendanceEvent.status: TEXT -> AttendanceEventStatus (default: 'PROCESSED')
DO $$ BEGIN
    ALTER TABLE "RawAttendanceEvent" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "RawAttendanceEvent" ALTER COLUMN "status" TYPE "AttendanceEventStatus" USING "status"::"AttendanceEventStatus";
    ALTER TABLE "RawAttendanceEvent" ALTER COLUMN "status" SET DEFAULT 'PROCESSED';
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter RawAttendanceEvent.status type: %', SQLERRM;
END $$;

-- EmployeeEarning.status: TEXT -> LedgerStatus (default: 'draft')
DO $$ BEGIN
    ALTER TABLE "EmployeeEarning" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "EmployeeEarning" ALTER COLUMN "status" TYPE "LedgerStatus" USING "status"::"LedgerStatus";
    ALTER TABLE "EmployeeEarning" ALTER COLUMN "status" SET DEFAULT 'draft';
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter EmployeeEarning.status type: %', SQLERRM;
END $$;

-- EmployeeDeduction.status: TEXT -> LedgerStatus (default: 'draft')
DO $$ BEGIN
    ALTER TABLE "EmployeeDeduction" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "EmployeeDeduction" ALTER COLUMN "status" TYPE "LedgerStatus" USING "status"::"LedgerStatus";
    ALTER TABLE "EmployeeDeduction" ALTER COLUMN "status" SET DEFAULT 'draft';
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter EmployeeDeduction.status type: %', SQLERRM;
END $$;

-- CommissionRule.amountType: TEXT -> CommissionAmountType (no default)
DO $$ BEGIN
    ALTER TABLE "CommissionRule" ALTER COLUMN "amountType" TYPE "CommissionAmountType" USING "amountType"::"CommissionAmountType";
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter CommissionRule.amountType type: %', SQLERRM;
END $$;

-- CommissionEarning.status: TEXT -> LedgerStatus (default: 'approved')
DO $$ BEGIN
    ALTER TABLE "CommissionEarning" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "CommissionEarning" ALTER COLUMN "status" TYPE "LedgerStatus" USING "status"::"LedgerStatus";
    ALTER TABLE "CommissionEarning" ALTER COLUMN "status" SET DEFAULT 'approved';
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter CommissionEarning.status type: %', SQLERRM;
END $$;

-- LeaveRequest.status: TEXT -> LeaveStatus (default: 'pending')
DO $$ BEGIN
    ALTER TABLE "LeaveRequest" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "LeaveRequest" ALTER COLUMN "status" TYPE "LeaveStatus" USING "status"::"LeaveStatus";
    ALTER TABLE "LeaveRequest" ALTER COLUMN "status" SET DEFAULT 'pending';
EXCEPTION WHEN undefined_column THEN null;
        WHEN undefined_object THEN null;
        WHEN others THEN RAISE WARNING 'Could not alter LeaveRequest.status type: %', SQLERRM;
END $$;

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

-- ---- Foreign keys (individual blocks — one failure cannot abort others) -------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Employee_departmentId_fkey') THEN
    ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey"
      FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING 'Could not create Employee_departmentId_fkey: %', SQLERRM;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Employee_designationId_fkey') THEN
    ALTER TABLE "Employee" ADD CONSTRAINT "Employee_designationId_fkey"
      FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING 'Could not create Employee_designationId_fkey: %', SQLERRM;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Employee_accessPresetId_fkey') THEN
    ALTER TABLE "Employee" ADD CONSTRAINT "Employee_accessPresetId_fkey"
      FOREIGN KEY ("accessPresetId") REFERENCES "AccessPreset"("id") ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING 'Could not create Employee_accessPresetId_fkey: %', SQLERRM;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Employee_betterAuthUserId_fkey') THEN
    ALTER TABLE "Employee" ADD CONSTRAINT "Employee_betterAuthUserId_fkey"
      FOREIGN KEY ("betterAuthUserId") REFERENCES "better_auth_users"("id") ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING 'Could not create Employee_betterAuthUserId_fkey: %', SQLERRM;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SalaryStructure_employeeId_fkey') THEN
    ALTER TABLE "SalaryStructure" ADD CONSTRAINT "SalaryStructure_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING 'Could not create SalaryStructure_employeeId_fkey: %', SQLERRM;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Payslip_employeeId_fkey') THEN
    ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING 'Could not create Payslip_employeeId_fkey: %', SQLERRM;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayslipItem_payslipId_fkey') THEN
    ALTER TABLE "PayslipItem" ADD CONSTRAINT "PayslipItem_payslipId_fkey"
      FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING 'Could not create PayslipItem_payslipId_fkey: %', SQLERRM;
END $$;
