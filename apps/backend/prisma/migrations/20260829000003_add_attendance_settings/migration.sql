-- CreateTable
CREATE TABLE "AttendanceSettings" (
    "id" TEXT NOT NULL,
    "mode" "AttendanceModeSetting" NOT NULL DEFAULT 'APP',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSettings_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row (idempotent)
INSERT INTO "AttendanceSettings" ("id", "mode", "createdAt", "updatedAt")
VALUES ('global', 'APP', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
