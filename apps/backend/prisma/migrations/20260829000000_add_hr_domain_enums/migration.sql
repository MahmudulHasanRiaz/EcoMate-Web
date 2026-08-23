-- Plan v3 enums (additive). Order matters: referenced by later migrations.
CREATE TYPE "EmployeeGender" AS ENUM ('MALE', 'FEMALE', 'OTHER');
CREATE TYPE "AttendanceMethod" AS ENUM ('APP', 'MACHINE', 'NONE');
CREATE TYPE "AttendanceModeSetting" AS ENUM ('APP', 'MACHINE', 'BOTH');
CREATE TYPE "AttendanceSessionSource" AS ENUM ('APP', 'MACHINE', 'ADMIN');
CREATE TYPE "BankAccountType" AS ENUM ('SAVINGS', 'CURRENT', 'OTHERS');
CREATE TYPE "BankVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
CREATE TYPE "AttendanceDeviceSyncStatus" AS ENUM ('IDLE', 'CONNECTED', 'DISCONNECTED', 'SYNCING', 'FAILED');
CREATE TYPE "AttendanceEventType" AS ENUM ('CHECK_IN', 'CHECK_OUT', 'BREAK_START', 'BREAK_END', 'PUNCH');
CREATE TYPE "AttendanceEventStatus" AS ENUM ('PENDING', 'UNMAPPED', 'PROCESSED', 'FAILED', 'SKIPPED');
