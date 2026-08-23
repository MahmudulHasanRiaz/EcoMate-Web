-- HR Phase 2: employment domain — extended lifecycle, reporting manager,
-- effective-dated EmploymentHistory and WeeklyOff schedules.
ALTER TYPE "EmployeeStatus" ADD VALUE 'on_leave';
ALTER TYPE "EmployeeStatus" ADD VALUE 'suspended';

ALTER TABLE "Employee" ADD COLUMN "reportingToId" TEXT;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_reportingToId_fkey" FOREIGN KEY ("reportingToId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Employee_reportingToId_idx" ON "Employee"("reportingToId");
CREATE INDEX "Employee_status_departmentId_idx" ON "Employee"("status", "departmentId");

CREATE TYPE "EmploymentHistoryField" AS ENUM ('status','department','designation','reporting_manager','employment_type','weekly_off');

CREATE TABLE "EmploymentHistory" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "field" "EmploymentHistoryField" NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmploymentHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmploymentHistory_employeeId_effectiveFrom_idx" ON "EmploymentHistory"("employeeId", "effectiveFrom");
ALTER TABLE "EmploymentHistory" ADD CONSTRAINT "EmploymentHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmploymentHistory" ADD CONSTRAINT "EmploymentHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "WeeklyOff" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WeeklyOff_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WeeklyOff_employeeId_effectiveFrom_idx" ON "WeeklyOff"("employeeId", "effectiveFrom");
ALTER TABLE "WeeklyOff" ADD CONSTRAINT "WeeklyOff_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WeeklyOff" ADD CONSTRAINT "WeeklyOff_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;