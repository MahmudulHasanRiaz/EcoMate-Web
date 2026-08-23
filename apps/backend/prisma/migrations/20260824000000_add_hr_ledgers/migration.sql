-- HR Phase 3: compensation ledgers (earnings + deductions) with immutable
-- approval lifecycle, plus SalaryStructure.effectiveTo for deactivation.
CREATE TYPE "EarningType" AS ENUM ('bonus', 'incentive', 'commission', 'other');
CREATE TYPE "DeductionType" AS ENUM ('fine', 'other');
CREATE TYPE "LedgerStatus" AS ENUM ('draft', 'approved', 'paid');

CREATE TABLE "EmployeeEarning" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "EarningType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "applicableFrom" TIMESTAMP(3),
    "applicableTo" TIMESTAMP(3),
    "status" "LedgerStatus" NOT NULL DEFAULT 'draft',
    "payslipId" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeEarning_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmployeeEarning_employeeId_applicableFrom_idx" ON "EmployeeEarning"("employeeId", "applicableFrom");
ALTER TABLE "EmployeeEarning" ADD CONSTRAINT "EmployeeEarning_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EmployeeDeduction" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "DeductionType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "applicableFrom" TIMESTAMP(3),
    "applicableTo" TIMESTAMP(3),
    "status" "LedgerStatus" NOT NULL DEFAULT 'draft',
    "payslipId" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeDeduction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmployeeDeduction_employeeId_applicableFrom_idx" ON "EmployeeDeduction"("employeeId", "applicableFrom");
ALTER TABLE "EmployeeDeduction" ADD CONSTRAINT "EmployeeDeduction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SalaryStructure" ADD COLUMN "effectiveTo" TIMESTAMP(3);
