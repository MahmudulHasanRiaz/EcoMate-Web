-- CreateTable
CREATE TABLE "CourierReportCache" (
    "id" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "courierStatus" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierReportCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourierReportCache_courier_phone_key" ON "CourierReportCache"("courier", "phone");

-- CreateIndex
CREATE INDEX "CourierReportCache_phone_idx" ON "CourierReportCache"("phone");

-- CreateIndex
CREATE INDEX "CourierReportCache_courier_idx" ON "CourierReportCache"("courier");

-- CreateIndex
CREATE INDEX "CourierReportCache_expiresAt_idx" ON "CourierReportCache"("expiresAt");
