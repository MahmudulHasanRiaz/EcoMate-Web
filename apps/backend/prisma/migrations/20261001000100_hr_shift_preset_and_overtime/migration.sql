-- HR: shift presets, per-employee rotation, and shift-derived day metrics.
--
-- Additive only. The new AttendanceDay metric columns are NULLABLE and stay
-- NULL on every existing row, which is the correct value for "no shift was in
-- effect" — a weekly-off day or a day recorded before shifts existed must not
-- be read as zero overtime. No backfill, no rewrite of historical rows.

ALTER TYPE "EmploymentHistoryField" ADD VALUE 'shift';

CREATE TABLE "ShiftPreset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "graceMinutes" INTEGER NOT NULL DEFAULT 10,
    "breakMinutes" INTEGER NOT NULL DEFAULT 60,
    "standardMinutes" INTEGER NOT NULL,
    "overnight" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftPreset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftPresetId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShiftPreset_name_key" ON "ShiftPreset"("name");
CREATE UNIQUE INDEX "ShiftPreset_code_key" ON "ShiftPreset"("code");
CREATE INDEX "ShiftPreset_isActive_idx" ON "ShiftPreset"("isActive");

CREATE UNIQUE INDEX "ShiftAssignment_employeeId_dayOfWeek_effectiveFrom_key" ON "ShiftAssignment"("employeeId", "dayOfWeek", "effectiveFrom");
CREATE INDEX "ShiftAssignment_employeeId_effectiveTo_idx" ON "ShiftAssignment"("employeeId", "effectiveTo");
CREATE INDEX "ShiftAssignment_shiftPresetId_effectiveTo_idx" ON "ShiftAssignment"("shiftPresetId", "effectiveTo");

ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_shiftPresetId_fkey" FOREIGN KEY ("shiftPresetId") REFERENCES "ShiftPreset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Nullable: NULL means "no shift in effect", never zero.
ALTER TABLE "AttendanceDay" ADD COLUMN "scheduledMinutes" INTEGER;
ALTER TABLE "AttendanceDay" ADD COLUMN "overtimeMinutes" INTEGER;
ALTER TABLE "AttendanceDay" ADD COLUMN "lateMinutes" INTEGER;
ALTER TABLE "AttendanceDay" ADD COLUMN "earlyLeaveMinutes" INTEGER;
ALTER TABLE "AttendanceDay" ADD COLUMN "outsideShift" BOOLEAN NOT NULL DEFAULT false;
