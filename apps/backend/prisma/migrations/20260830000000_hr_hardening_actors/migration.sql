ALTER TABLE "Payslip" ADD COLUMN "reviewedById" TEXT,
ADD COLUMN "approvedById" TEXT;
ALTER TABLE "SalaryStructure" ADD COLUMN "createdById" TEXT,
ADD COLUMN "updatedById" TEXT;
