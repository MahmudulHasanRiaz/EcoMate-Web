-- CreateEnum
CREATE TYPE "TaskTimeEntryStatus" AS ENUM ('active', 'paused', 'completed');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "assignedEmployeeId" TEXT;
ALTER TABLE "Task" ADD COLUMN "estimatedMinutes" INTEGER;
ALTER TABLE "Task" ADD COLUMN "actualMinutes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TaskTimeEntry" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "status" "TaskTimeEntryStatus" NOT NULL DEFAULT 'completed',
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStaffEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "employeeId" TEXT,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "note" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStaffEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_assignedEmployeeId_idx" ON "Task"("assignedEmployeeId");

-- CreateIndex
CREATE INDEX "TaskTimeEntry_taskId_idx" ON "TaskTimeEntry"("taskId");
CREATE INDEX "TaskTimeEntry_employeeId_idx" ON "TaskTimeEntry"("employeeId");
CREATE INDEX "TaskTimeEntry_startedAt_idx" ON "TaskTimeEntry"("startedAt");
CREATE INDEX "TaskTimeEntry_employeeId_startedAt_idx" ON "TaskTimeEntry"("employeeId", "startedAt");

-- CreateIndex
CREATE INDEX "OrderStaffEvent_orderId_idx" ON "OrderStaffEvent"("orderId");
CREATE INDEX "OrderStaffEvent_employeeId_createdAt_idx" ON "OrderStaffEvent"("employeeId", "createdAt");
CREATE INDEX "OrderStaffEvent_userId_createdAt_idx" ON "OrderStaffEvent"("userId", "createdAt");
CREATE INDEX "OrderStaffEvent_action_createdAt_idx" ON "OrderStaffEvent"("action", "createdAt");
CREATE INDEX "OrderStaffEvent_toStatus_createdAt_idx" ON "OrderStaffEvent"("toStatus", "createdAt");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTimeEntry" ADD CONSTRAINT "TaskTimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTimeEntry" ADD CONSTRAINT "TaskTimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStaffEvent" ADD CONSTRAINT "OrderStaffEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStaffEvent" ADD CONSTRAINT "OrderStaffEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
