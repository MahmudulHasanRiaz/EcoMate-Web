-- CreateTable
CREATE TABLE "AttendanceDevice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL,
    "vendor" TEXT,
    "identifier" TEXT,
    "location" TEXT,
    "connectionMethod" TEXT NOT NULL DEFAULT 'API',
    "host" TEXT,
    "port" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "syncStatus" "AttendanceDeviceSyncStatus" NOT NULL DEFAULT 'IDLE',
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "credentialsEncrypted" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceEmployeeMapping" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "deviceEmployeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceEmployeeMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawAttendanceEvent" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT,
    "deviceEmployeeId" TEXT,
    "employeeId" TEXT,
    "eventType" "AttendanceEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "rawPayload" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "status" "AttendanceEventStatus" NOT NULL DEFAULT 'PROCESSED',
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawAttendanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceEmployeeMapping_deviceId_deviceEmployeeId_key" ON "DeviceEmployeeMapping"("deviceId", "deviceEmployeeId");
CREATE UNIQUE INDEX "DeviceEmployeeMapping_deviceId_employeeId_key" ON "DeviceEmployeeMapping"("deviceId", "employeeId");
CREATE UNIQUE INDEX "RawAttendanceEvent_idempotencyKey_key" ON "RawAttendanceEvent"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "DeviceEmployeeMapping" ADD CONSTRAINT "DeviceEmployeeMapping_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "AttendanceDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeviceEmployeeMapping" ADD CONSTRAINT "DeviceEmployeeMapping_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RawAttendanceEvent" ADD CONSTRAINT "RawAttendanceEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "AttendanceDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RawAttendanceEvent" ADD CONSTRAINT "RawAttendanceEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
