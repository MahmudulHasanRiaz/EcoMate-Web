-- CreateTable
CREATE TABLE "AttendanceDay" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "attendanceMethod" "AttendanceMethod" NOT NULL DEFAULT 'APP',
    "workedMinutes" INTEGER,
    "breakMinutes" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "source" "AttendanceSessionSource" NOT NULL DEFAULT 'APP',
    "deviceId" TEXT,
    "checkInAt" TIMESTAMP(3) NOT NULL,
    "checkOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceBreak" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceBreak_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDay_employeeId_date_key" ON "AttendanceDay"("employeeId", "date");
CREATE INDEX "AttendanceDay_date_idx" ON "AttendanceDay"("date");
CREATE INDEX "AttendanceSession_dayId_idx" ON "AttendanceSession"("dayId");
CREATE INDEX "AttendanceBreak_sessionId_idx" ON "AttendanceBreak"("sessionId");

-- AddForeignKey
ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "AttendanceDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceBreak" ADD CONSTRAINT "AttendanceBreak_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data copy: legacy AttendanceRecord -> AttendanceDay + AttendanceSession (source ADMIN), method APP (NOTE N2).
INSERT INTO "AttendanceDay" ("id", "employeeId", "date", "status", "attendanceMethod", "workedMinutes", "breakMinutes", "note", "createdAt", "updatedAt")
SELECT gen_random_uuid(), r."employeeId", r."date", r."status", 'APP', NULL, NULL, r."note", r."createdAt", r."updatedAt"
FROM "AttendanceRecord" r;

INSERT INTO "AttendanceSession" ("id", "dayId", "source", "deviceId", "checkInAt", "checkOutAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), d."id", 'ADMIN', NULL, r."checkInTime", r."checkOutTime", r."createdAt", r."updatedAt"
FROM "AttendanceRecord" r
JOIN "AttendanceDay" d ON d."employeeId" = r."employeeId" AND d."date" = r."date"
WHERE r."checkInTime" IS NOT NULL;

UPDATE "AttendanceDay" d
SET "workedMinutes" = GREATEST(0, EXTRACT(EPOCH FROM (s."checkOutAt" - s."checkInAt"))::INT / 60)
FROM "AttendanceSession" s
WHERE s."dayId" = d."id" AND s."checkInAt" IS NOT NULL AND s."checkOutAt" IS NOT NULL;
