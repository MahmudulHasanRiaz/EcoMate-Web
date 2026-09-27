-- Pre-existing datamodel↔database drift accumulated via hand-written
-- migrations (marketing/attendance/commission era). Database aligned TO the
-- committed schema: JournalEntry.marketingPaymentId never existed in the
-- datamodel and holds 0 rows; the hand-created AdAccount index was never
-- declared; id defaults restored/removed to match @default attributes.

-- DropForeignKey
ALTER TABLE "JournalEntry" DROP CONSTRAINT "JournalEntry_marketingPaymentId_fkey";

-- DropIndex
DROP INDEX "AdAccount_defaultPaymentAccountId_idx";

-- DropIndex
DROP INDEX "JournalEntry_marketingPaymentId_key";

-- AlterTable
ALTER TABLE "AttendanceSettings" ALTER COLUMN "id" SET DEFAULT 'global';

-- AlterTable
ALTER TABLE "CommissionEarning" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CommissionRule" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "JournalEntry" DROP COLUMN "marketingPaymentId";

-- AlterTable
ALTER TABLE "MarketingDailyProductCost" ALTER COLUMN "id" DROP DEFAULT;
