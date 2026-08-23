-- HR Phase 0 groundwork: Payslip lifecycle states + timestamps + nullable periodKey.
-- Lifecycle DRAFT -> REVIEWED -> APPROVED -> PARTIALLY_PAID -> PAID.
-- NOTE: groundwork only. Endpoint semantics (PATCH /payslips/:id/approve) unchanged;
-- explicit review/approve endpoints, periodKey uniqueness + payroll locking wired in Phase 4.
ALTER TYPE "PayslipStatus" ADD VALUE 'reviewed';
ALTER TYPE "PayslipStatus" ADD VALUE 'partially_paid';
ALTER TABLE "Payslip" ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "periodKey" TEXT;