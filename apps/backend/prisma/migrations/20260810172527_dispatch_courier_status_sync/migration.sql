-- AlterTable
ALTER TABLE "Dispatch" ADD COLUMN     "courierStatus" TEXT,
ADD COLUMN     "courierStatusAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Dispatch_courierStatus_idx" ON "Dispatch"("courierStatus");

-- CreateIndex
CREATE INDEX "Dispatch_lastSyncedAt_idx" ON "Dispatch"("lastSyncedAt");
