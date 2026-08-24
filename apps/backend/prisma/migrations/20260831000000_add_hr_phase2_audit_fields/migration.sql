-- HR Phase 2: audit groundwork.
-- Extend EmploymentHistoryField with personal/employment/bank change rows so
-- G-19 can audited personal + employment detail and bank-account changes.
-- Add a dedicated bank-account verification note column for the G-16
-- verification workflow (previously only the general "notes" existed).
ALTER TYPE "EmploymentHistoryField" ADD VALUE 'personalInformation';
ALTER TYPE "EmploymentHistoryField" ADD VALUE 'employmentInformation';
ALTER TYPE "EmploymentHistoryField" ADD VALUE 'bankAccount';

ALTER TABLE "EmployeeBankAccount" ADD COLUMN "verificationNote" TEXT;
