-- Catch-up migration: sync all db-push-era models into Prisma Migrate tracking
-- This migration is SAFE for the existing database (IF NOT EXISTS / IF EXISTS throughout)

-- Create enums (safe: DO block handles duplicate)
DO $$ BEGIN
    CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'scheduled', 'sending', 'sent', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "PurchaseStatus" AS ENUM ('draft', 'ordered', 'partially_received', 'received', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "EmploymentType" AS ENUM ('full_time', 'part_time', 'contract', 'internship');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "EmployeeStatus" AS ENUM ('active', 'inactive', 'terminated', 'resigned');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "PayslipStatus" AS ENUM ('draft', 'approved', 'paid', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "AccountType" AS ENUM ('asset', 'liability', 'equity', 'income', 'expense');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Drop full-text-search columns (may or may not exist)
DROP INDEX IF EXISTS "orders_fts_idx";
DROP INDEX IF EXISTS "products_fts_idx";
DROP INDEX IF EXISTS "users_fts_idx";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "fts";
ALTER TABLE "Product" DROP COLUMN IF EXISTS "fts";
ALTER TABLE "User" DROP COLUMN IF EXISTS "fts";

-- Add columns to existing tables (safe)
ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "reservedStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "maxUsesPerCustomer" INTEGER;
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "percentageCap" DECIMAL(5,2);
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "costingLotId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "defaultBinLocationId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "reservedStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "binLocationId" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "reservedStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;

-- Create tables that may not exist yet
CREATE TABLE IF NOT EXISTS "EmailTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "variables" JSONB DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EmailCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "templateId" TEXT,
    "content" TEXT,
    "recipients" JSONB DEFAULT '[]',
    "segmentFilter" JSONB DEFAULT '{}',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "totalSent" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CouponUsage" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT,
    "discount" DECIMAL(10,2) NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CouponUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "expense_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- Seed default expense categories
INSERT INTO "expense_categories" ("id", "name", "slug", "description", "color", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT * FROM (VALUES
    ('cat-utilities', 'Utilities', 'utilities', 'Electricity, water, gas, internet, phone bills', '#F59E0B', true, 1, NOW(), NOW()),
    ('cat-rent', 'Rent', 'rent', 'Office rent, lease payments',       '#EF4444', true, 2, NOW(), NOW()),
    ('cat-salaries', 'Salaries', 'salaries', 'Employee salaries and wages', '#3B82F6', true, 3, NOW(), NOW()),
    ('cat-marketing', 'Marketing', 'marketing', 'Advertising, promotions, social media', '#8B5CF6', true, 4, NOW(), NOW()),
    ('cat-supplies', 'Supplies', 'supplies', 'Office supplies, stationery, consumables', '#10B981', true, 5, NOW(), NOW()),
    ('cat-maintenance', 'Maintenance', 'maintenance', 'Repair and maintenance', '#F97316', true, 6, NOW(), NOW()),
    ('cat-travel', 'Travel', 'travel', 'Business travel, transportation', '#06B6D4', true, 7, NOW(), NOW()),
    ('cat-shipping', 'Shipping', 'shipping', 'Courier, freight, delivery', '#84CC16', true, 8, NOW(), NOW()),
    ('cat-taxes', 'Taxes', 'taxes', 'Tax payments, VAT, customs',     '#DC2626', true, 9, NOW(), NOW()),
    ('cat-insurance', 'Insurance', 'insurance', 'Business insurance', '#EC4899', true, 10, NOW(), NOW()),
    ('cat-software', 'Software', 'software', 'Software subscriptions, SaaS', '#6366F1', true, 11, NOW(), NOW()),
    ('cat-food_and_beverages', 'Food & Beverages', 'food-and-beverages', 'Team meals, client entertainment', '#14B8A6', true, 12, NOW(), NOW()),
    ('cat-office_expenses', 'Office Expenses', 'office-expenses', 'Miscellaneous office expenses', '#78716C', true, 13, NOW(), NOW()),
    ('cat-professional_fees', 'Professional Fees', 'professional-fees', 'Legal, consulting, accounting', '#A855F7', true, 14, NOW(), NOW()),
    ('cat-other', 'Other', 'other', 'All other expenses',             '#6B7280', true, 15, NOW(), NOW())
) AS v
WHERE NOT EXISTS (SELECT 1 FROM "expense_categories");

-- Drop old ExpenseCategory enum if it still exists from previous schema (safe)
DROP TYPE IF EXISTS "ExpenseCategory";

CREATE TABLE IF NOT EXISTS "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "contactPerson" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Bangladesh',
    "taxId" TEXT,
    "paymentTerms" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "totalPurchases" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Purchase" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDate" TIMESTAMP(3),
    "status" "PurchaseStatus" NOT NULL DEFAULT 'draft',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PurchaseItem" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "description" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "totalBill" DECIMAL(14,2) NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "NotificationSetting" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "NotificationLog" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "content" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "error" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Referral" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "totalReferrals" INTEGER NOT NULL DEFAULT 0,
    "totalReward" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ReferralLead" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "orderId" TEXT,
    "rewardAmount" DECIMAL(10,2),
    "rewardGiven" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReferralLead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ReferralReward" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'coupon',
    "amount" DECIMAL(10,2) NOT NULL,
    "description" TEXT,
    "givenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Designation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Designation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Employee" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "employeeId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "departmentId" TEXT,
    "designationId" TEXT,
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'full_time',
    "status" "EmployeeStatus" NOT NULL DEFAULT 'active',
    "joiningDate" TIMESTAMP(3) NOT NULL,
    "exitDate" TIMESTAMP(3),
    "salary" DECIMAL(10,2),
    "bankAccountNo" TEXT,
    "bankName" TEXT,
    "address" TEXT,
    "city" TEXT,
    "emergencyContact" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SalaryStructure" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "basicSalary" DECIMAL(10,2) NOT NULL,
    "houseAllowance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "medicalAllowance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "transportAllowance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "otherAllowance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "insuranceDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "otherDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalEarnings" DECIMAL(10,2) NOT NULL,
    "totalDeductions" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netSalary" DECIMAL(10,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalaryStructure_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Payslip" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalEarnings" DECIMAL(10,2) NOT NULL,
    "totalDeductions" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(10,2) NOT NULL,
    "status" "PayslipStatus" NOT NULL DEFAULT 'draft',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PayslipItem" (
    "id" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    CONSTRAINT "PayslipItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Account" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "parentId" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FinancialPeriod" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FinancialPeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OpeningBalance" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    CONSTRAINT "OpeningBalance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JournalEntry" (
    "id" TEXT NOT NULL,
    "entryNo" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "totalDebit" DECIMAL(14,2) NOT NULL,
    "totalCredit" DECIMAL(14,2) NOT NULL,
    "isOpening" BOOLEAN NOT NULL DEFAULT false,
    "referenceNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JournalEntryLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    CONSTRAINT "JournalEntryLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Warehouse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Bangladesh',
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BinLocation" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "zone" TEXT,
    "rack" TEXT,
    "shelf" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BinLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CostingLot" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT,
    "grnId" TEXT,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "lotNumber" TEXT NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "totalCost" DECIMAL(14,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "remainingQty" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CostingLot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GoodsReceiptNote" (
    "id" TEXT NOT NULL,
    "grnNumber" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "receivedBy" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoodsReceiptNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GoodsReceiptNoteItem" (
    "id" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "purchaseItemId" TEXT,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "expectedQty" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL,
    "acceptedQty" INTEGER NOT NULL,
    "rejectedQty" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "totalCost" DECIMAL(14,2) NOT NULL,
    CONSTRAINT "GoodsReceiptNoteItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SupplierPayment" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentMethod" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SupplierPaymentInvoice" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    CONSTRAINT "SupplierPaymentInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Expense" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "paymentMethod" TEXT,
    "referenceNo" TEXT,
    "notes" TEXT,
    "receiptUrl" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- If Expense table already existed with old "category" enum column,
-- this handles the transition to "categoryId" FK column safely
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;

-- Backfill: map old enum values to new category IDs (no-op if Expense is new)
UPDATE "Expense" SET "categoryId" = (
    CASE "category"::text
        WHEN 'utilities' THEN 'cat-utilities'
        WHEN 'rent' THEN 'cat-rent'
        WHEN 'salaries' THEN 'cat-salaries'
        WHEN 'marketing' THEN 'cat-marketing'
        WHEN 'supplies' THEN 'cat-supplies'
        WHEN 'maintenance' THEN 'cat-maintenance'
        WHEN 'travel' THEN 'cat-travel'
        WHEN 'shipping' THEN 'cat-shipping'
        WHEN 'taxes' THEN 'cat-taxes'
        WHEN 'insurance' THEN 'cat-insurance'
        WHEN 'software' THEN 'cat-software'
        WHEN 'food_and_beverages' THEN 'cat-food_and_beverages'
        WHEN 'office_expenses' THEN 'cat-office_expenses'
        WHEN 'professional_fees' THEN 'cat-professional_fees'
        ELSE 'cat-other'
    END
) WHERE "categoryId" IS NULL;

-- Make categoryId NOT NULL (no-op if already set)
DO $$ BEGIN
    ALTER TABLE "Expense" ALTER COLUMN "categoryId" SET NOT NULL;
EXCEPTION WHEN others THEN null;
END $$;

-- Drop old category column and enum (ignore if they don't exist)
ALTER TABLE "Expense" DROP COLUMN IF EXISTS "category";
DROP TYPE IF EXISTS "ExpenseCategory";

-- Seed default expense categories if table was just created (or empty)
INSERT INTO "expense_categories" ("id", "name", "slug", "description", "color", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT * FROM (VALUES
    ('cat-utilities', 'Utilities', 'utilities', 'Electricity, water, gas, internet, phone bills', '#F59E0B', true, 1, NOW(), NOW()),
    ('cat-rent', 'Rent', 'rent', 'Office rent, lease payments', '#EF4444', true, 2, NOW(), NOW()),
    ('cat-salaries', 'Salaries', 'salaries', 'Employee salaries and wages', '#3B82F6', true, 3, NOW(), NOW()),
    ('cat-marketing', 'Marketing', 'marketing', 'Advertising, promotions, social media', '#8B5CF6', true, 4, NOW(), NOW()),
    ('cat-supplies', 'Supplies', 'supplies', 'Office supplies, stationery, consumables', '#10B981', true, 5, NOW(), NOW()),
    ('cat-maintenance', 'Maintenance', 'maintenance', 'Repair and maintenance', '#F97316', true, 6, NOW(), NOW()),
    ('cat-travel', 'Travel', 'travel', 'Business travel, transportation', '#06B6D4', true, 7, NOW(), NOW()),
    ('cat-shipping', 'Shipping', 'shipping', 'Courier, freight, delivery', '#84CC16', true, 8, NOW(), NOW()),
    ('cat-taxes', 'Taxes', 'taxes', 'Tax payments, VAT, customs', '#DC2626', true, 9, NOW(), NOW()),
    ('cat-insurance', 'Insurance', 'insurance', 'Business insurance', '#EC4899', true, 10, NOW(), NOW()),
    ('cat-software', 'Software', 'software', 'Software subscriptions, SaaS', '#6366F1', true, 11, NOW(), NOW()),
    ('cat-food_and_beverages', 'Food & Beverages', 'food-and-beverages', 'Team meals, client entertainment', '#14B8A6', true, 12, NOW(), NOW()),
    ('cat-office_expenses', 'Office Expenses', 'office-expenses', 'Miscellaneous office expenses', '#78716C', true, 13, NOW(), NOW()),
    ('cat-professional_fees', 'Professional Fees', 'professional-fees', 'Legal, consulting, accounting', '#A855F7', true, 14, NOW(), NOW()),
    ('cat-other', 'Other', 'other', 'All other expenses', '#6B7280', true, 15, NOW(), NOW())
) AS v
WHERE NOT EXISTS (SELECT 1 FROM "expense_categories");

-- Indexes (IF NOT EXISTS)
CREATE UNIQUE INDEX IF NOT EXISTS "EmailTemplate_name_key" ON "EmailTemplate"("name");
CREATE INDEX IF NOT EXISTS "EmailCampaign_status_idx" ON "EmailCampaign"("status");
CREATE INDEX IF NOT EXISTS "EmailCampaign_createdAt_idx" ON "EmailCampaign"("createdAt");
CREATE INDEX IF NOT EXISTS "CouponUsage_couponId_idx" ON "CouponUsage"("couponId");
CREATE INDEX IF NOT EXISTS "CouponUsage_orderId_idx" ON "CouponUsage"("orderId");
CREATE INDEX IF NOT EXISTS "CouponUsage_userId_idx" ON "CouponUsage"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "expense_categories_slug_key" ON "expense_categories"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_slug_key" ON "Supplier"("slug");
CREATE INDEX IF NOT EXISTS "Supplier_isActive_idx" ON "Supplier"("isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "Purchase_referenceNo_key" ON "Purchase"("referenceNo");
CREATE INDEX IF NOT EXISTS "Purchase_supplierId_idx" ON "Purchase"("supplierId");
CREATE INDEX IF NOT EXISTS "Purchase_status_idx" ON "Purchase"("status");
CREATE INDEX IF NOT EXISTS "Purchase_createdAt_idx" ON "Purchase"("createdAt");
CREATE INDEX IF NOT EXISTS "PurchaseItem_purchaseId_idx" ON "PurchaseItem"("purchaseId");
CREATE INDEX IF NOT EXISTS "PurchaseItem_productId_idx" ON "PurchaseItem"("productId");
CREATE INDEX IF NOT EXISTS "NotificationSetting_channel_type_key" ON "NotificationSetting"("channel", "type");
CREATE INDEX IF NOT EXISTS "NotificationLog_channel_status_idx" ON "NotificationLog"("channel", "status");
CREATE INDEX IF NOT EXISTS "NotificationLog_recipient_idx" ON "NotificationLog"("recipient");
CREATE INDEX IF NOT EXISTS "NotificationLog_sentAt_idx" ON "NotificationLog"("sentAt");
CREATE UNIQUE INDEX IF NOT EXISTS "Referral_code_key" ON "Referral"("code");
CREATE INDEX IF NOT EXISTS "Referral_referrerId_idx" ON "Referral"("referrerId");
CREATE INDEX IF NOT EXISTS "Referral_code_idx" ON "Referral"("code");
CREATE INDEX IF NOT EXISTS "ReferralLead_referralId_idx" ON "ReferralLead"("referralId");
CREATE INDEX IF NOT EXISTS "ReferralLead_phone_idx" ON "ReferralLead"("phone");
CREATE INDEX IF NOT EXISTS "ReferralLead_status_idx" ON "ReferralLead"("status");
CREATE INDEX IF NOT EXISTS "ReferralReward_referralId_idx" ON "ReferralReward"("referralId");
CREATE UNIQUE INDEX IF NOT EXISTS "Department_name_key" ON "Department"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Department_slug_key" ON "Department"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Designation_name_key" ON "Designation"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Designation_slug_key" ON "Designation"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Employee_employeeId_key" ON "Employee"("employeeId");
CREATE UNIQUE INDEX IF NOT EXISTS "Employee_email_key" ON "Employee"("email");
CREATE INDEX IF NOT EXISTS "Employee_departmentId_idx" ON "Employee"("departmentId");
CREATE INDEX IF NOT EXISTS "Employee_designationId_idx" ON "Employee"("designationId");
CREATE INDEX IF NOT EXISTS "Employee_status_idx" ON "Employee"("status");
CREATE INDEX IF NOT EXISTS "SalaryStructure_employeeId_idx" ON "SalaryStructure"("employeeId");
CREATE INDEX IF NOT EXISTS "Payslip_employeeId_idx" ON "Payslip"("employeeId");
CREATE INDEX IF NOT EXISTS "Payslip_status_idx" ON "Payslip"("status");
CREATE INDEX IF NOT EXISTS "Payslip_periodStart_periodEnd_idx" ON "Payslip"("periodStart", "periodEnd");
CREATE INDEX IF NOT EXISTS "PayslipItem_payslipId_idx" ON "PayslipItem"("payslipId");
CREATE UNIQUE INDEX IF NOT EXISTS "Account_code_key" ON "Account"("code");
CREATE INDEX IF NOT EXISTS "Account_type_idx" ON "Account"("type");
CREATE INDEX IF NOT EXISTS "Account_parentId_idx" ON "Account"("parentId");
CREATE UNIQUE INDEX IF NOT EXISTS "FinancialPeriod_startDate_endDate_key" ON "FinancialPeriod"("startDate", "endDate");
CREATE INDEX IF NOT EXISTS "OpeningBalance_periodId_idx" ON "OpeningBalance"("periodId");
CREATE UNIQUE INDEX IF NOT EXISTS "OpeningBalance_accountId_periodId_key" ON "OpeningBalance"("accountId", "periodId");
CREATE UNIQUE INDEX IF NOT EXISTS "JournalEntry_entryNo_key" ON "JournalEntry"("entryNo");
CREATE INDEX IF NOT EXISTS "JournalEntry_periodId_idx" ON "JournalEntry"("periodId");
CREATE INDEX IF NOT EXISTS "JournalEntry_entryDate_idx" ON "JournalEntry"("entryDate");
CREATE INDEX IF NOT EXISTS "JournalEntryLine_entryId_idx" ON "JournalEntryLine"("entryId");
CREATE INDEX IF NOT EXISTS "JournalEntryLine_accountId_idx" ON "JournalEntryLine"("accountId");
CREATE UNIQUE INDEX IF NOT EXISTS "Warehouse_slug_key" ON "Warehouse"("slug");
CREATE INDEX IF NOT EXISTS "Warehouse_isActive_idx" ON "Warehouse"("isActive");
CREATE INDEX IF NOT EXISTS "BinLocation_warehouseId_idx" ON "BinLocation"("warehouseId");
CREATE UNIQUE INDEX IF NOT EXISTS "BinLocation_warehouseId_code_key" ON "BinLocation"("warehouseId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "CostingLot_lotNumber_key" ON "CostingLot"("lotNumber");
CREATE INDEX IF NOT EXISTS "CostingLot_productId_remainingQty_idx" ON "CostingLot"("productId", "remainingQty");
CREATE INDEX IF NOT EXISTS "CostingLot_purchaseId_idx" ON "CostingLot"("purchaseId");
CREATE UNIQUE INDEX IF NOT EXISTS "GoodsReceiptNote_grnNumber_key" ON "GoodsReceiptNote"("grnNumber");
CREATE INDEX IF NOT EXISTS "SupplierPayment_supplierId_idx" ON "SupplierPayment"("supplierId");
CREATE UNIQUE INDEX IF NOT EXISTS "SupplierPaymentInvoice_invoiceNo_key" ON "SupplierPaymentInvoice"("invoiceNo");

-- Foreign keys (safe: only add if they don't already exist)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_warehouseId_fkey') THEN
        ALTER TABLE "Product" ADD CONSTRAINT "Product_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductVariant_warehouseId_fkey') THEN
        ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Combo_warehouseId_fkey') THEN
        ALTER TABLE "Combo" ADD CONSTRAINT "Combo_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderItem_costingLotId_fkey') THEN
        ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_costingLotId_fkey" FOREIGN KEY ("costingLotId") REFERENCES "CostingLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmailCampaign_templateId_fkey') THEN
        ALTER TABLE "EmailCampaign" ADD CONSTRAINT "EmailCampaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CouponUsage_couponId_fkey') THEN
        ALTER TABLE "CouponUsage" ADD CONSTRAINT "CouponUsage_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CouponUsage_orderId_fkey') THEN
        ALTER TABLE "CouponUsage" ADD CONSTRAINT "CouponUsage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Purchase_supplierId_fkey') THEN
        ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseItem_purchaseId_fkey') THEN
        ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseItem_productId_fkey') THEN
        ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseItem_variantId_fkey') THEN
        ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Referral_referrerId_fkey') THEN
        ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReferralLead_referralId_fkey') THEN
        ALTER TABLE "ReferralLead" ADD CONSTRAINT "ReferralLead_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReferralLead_orderId_fkey') THEN
        ALTER TABLE "ReferralLead" ADD CONSTRAINT "ReferralLead_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReferralReward_referralId_fkey') THEN
        ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Employee_departmentId_fkey') THEN
        ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Employee_designationId_fkey') THEN
        ALTER TABLE "Employee" ADD CONSTRAINT "Employee_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SalaryStructure_employeeId_fkey') THEN
        ALTER TABLE "SalaryStructure" ADD CONSTRAINT "SalaryStructure_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Payslip_employeeId_fkey') THEN
        ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayslipItem_payslipId_fkey') THEN
        ALTER TABLE "PayslipItem" ADD CONSTRAINT "PayslipItem_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Account_parentId_fkey') THEN
        ALTER TABLE "Account" ADD CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OpeningBalance_accountId_fkey') THEN
        ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OpeningBalance_periodId_fkey') THEN
        ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "FinancialPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JournalEntry_periodId_fkey') THEN
        ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "FinancialPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JournalEntryLine_entryId_fkey') THEN
        ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JournalEntryLine_accountId_fkey') THEN
        ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BinLocation_warehouseId_fkey') THEN
        ALTER TABLE "BinLocation" ADD CONSTRAINT "BinLocation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CostingLot_purchaseId_fkey') THEN
        ALTER TABLE "CostingLot" ADD CONSTRAINT "CostingLot_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CostingLot_grnId_fkey') THEN
        ALTER TABLE "CostingLot" ADD CONSTRAINT "CostingLot_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "GoodsReceiptNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoodsReceiptNote_purchaseId_fkey') THEN
        ALTER TABLE "GoodsReceiptNote" ADD CONSTRAINT "GoodsReceiptNote_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoodsReceiptNoteItem_grnId_fkey') THEN
        ALTER TABLE "GoodsReceiptNoteItem" ADD CONSTRAINT "GoodsReceiptNoteItem_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "GoodsReceiptNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierPayment_supplierId_fkey') THEN
        ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierPaymentInvoice_paymentId_fkey') THEN
        ALTER TABLE "SupplierPaymentInvoice" ADD CONSTRAINT "SupplierPaymentInvoice_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "SupplierPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Accounting integration columns (IF NOT EXISTS safe)
DO $$ BEGIN
    ALTER TABLE "expense_categories" ADD COLUMN "accountId" TEXT;
EXCEPTION WHEN duplicate_column THEN null; WHEN SQLSTATE '42P01' THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "Expense" ADD COLUMN "paymentAccountId" TEXT;
EXCEPTION WHEN duplicate_column THEN null; WHEN SQLSTATE '42P01' THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "Expense" ADD COLUMN "journalEntryId" TEXT;
EXCEPTION WHEN duplicate_column THEN null; WHEN SQLSTATE '42P01' THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "Account" ADD COLUMN "createdBy" TEXT;
EXCEPTION WHEN duplicate_column THEN null; WHEN SQLSTATE '42P01' THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "Account" ADD COLUMN "updatedBy" TEXT;
EXCEPTION WHEN duplicate_column THEN null; WHEN SQLSTATE '42P01' THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "JournalEntry" ADD COLUMN "createdBy" TEXT;
EXCEPTION WHEN duplicate_column THEN null; WHEN SQLSTATE '42P01' THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "JournalEntry" ADD COLUMN "updatedBy" TEXT;
EXCEPTION WHEN duplicate_column THEN null; WHEN SQLSTATE '42P01' THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "JournalEntryLine" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
EXCEPTION WHEN duplicate_column THEN null; WHEN SQLSTATE '42P01' THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "JournalEntryLine" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
EXCEPTION WHEN duplicate_column THEN null; WHEN SQLSTATE '42P01' THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "OpeningBalance" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
EXCEPTION WHEN duplicate_column THEN null; WHEN SQLSTATE '42P01' THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "OpeningBalance" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
EXCEPTION WHEN duplicate_column THEN null; WHEN SQLSTATE '42P01' THEN null;
END $$;

-- Accounting integration indexes & FK (safe)
CREATE INDEX IF NOT EXISTS "expense_categories_accountId_idx" ON "expense_categories"("accountId");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_categories_accountId_fkey') THEN
        ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Expense_paymentAccountId_idx" ON "Expense"("paymentAccountId");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Expense_paymentAccountId_fkey') THEN
        ALTER TABLE "Expense" ADD CONSTRAINT "Expense_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Expense_journalEntryId_key" ON "Expense"("journalEntryId");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Expense_journalEntryId_fkey') THEN
        ALTER TABLE "Expense" ADD CONSTRAINT "Expense_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Seed default accounting enabled setting (disabled by default)
INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
SELECT 'accounting_enabled', 'false', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "SystemSetting" WHERE "key" = 'accounting_enabled');

-- Expense indexes & FK
CREATE INDEX IF NOT EXISTS "Expense_categoryId_idx" ON "Expense"("categoryId");
CREATE INDEX IF NOT EXISTS "Expense_expenseDate_idx" ON "Expense"("expenseDate");
CREATE INDEX IF NOT EXISTS "Expense_createdAt_idx" ON "Expense"("createdAt");

-- Add Expense FK to expense_categories (safe)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Expense_categoryId_fkey') THEN
        ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
