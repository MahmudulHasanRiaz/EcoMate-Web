import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly nativePool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);

    super({
      adapter,
      log: process.env.NODE_ENV === 'development'
        ? [{ level: 'query', emit: 'event' }, { level: 'warn', emit: 'event' }, { level: 'error', emit: 'stdout' }]
        : [{ level: 'warn', emit: 'event' }, { level: 'error', emit: 'stdout' }],
    });
    this.nativePool = pool;
  }

  private async runRaw(sql: string): Promise<void> {
    const client = await this.nativePool.connect();
    try {
      await client.query(sql);
    } finally {
      client.release();
    }
  }

  async onModuleInit() {
    const client = this as any;
    if (process.env.NODE_ENV === 'development') {
      client.$on('query', (e: any) => {
        if (e.duration > 1000) {
          this.logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
        }
      });
    }
    client.$on('warn', (e: any) => {
      this.logger.warn(`Prisma warning: ${e.message || e.target}`);
    });
    await this.$connect();
    await this.ensureSchemaColumns();
    await this.logDatabaseColumns();
    await this.seedAdminUser();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private async logDatabaseColumns(): Promise<void> {
    try {
      const res = await this.$queryRawUnsafe<any[]>(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'Product'
      `);
      const cols = res.map(r => r.column_name).join(', ');
      this.logger.log(`[SCHEMA CHECK] Database "Product" columns: ${cols}`);
    } catch (e: any) {
      this.logger.warn(`Failed to inspect Product columns: ${e.message}`);
    }
  }

  /**
   * Idempotent schema-drift repair.
   *
   * Prisma Migrate can fall out of sync with the real database when:
   * - Columns were added via `prisma db push` and never captured in a migration
   * - A migration was interrupted or rolled back
   * - The database was restored from a backup predating a migration
   *
   * This method runs on every startup via raw SQL (bypassing Prisma's typed
   * client entirely) so the app ALWAYS starts in a consistent state, regardless
   * of migration history.  All statements are IF NOT EXISTS — completely safe
   * to run multiple times.
   */
  private async ensureSchemaColumns(): Promise<void> {
    // Step 0: Create tables that may not exist yet (idempotent via IF NOT EXISTS).
    // Must run BEFORE the column/FK fixes below because those reference these tables.
    const tableFixes: string[] = [
      `CREATE TABLE IF NOT EXISTS "Warehouse" (
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
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "Warehouse_slug_key" ON "Warehouse"("slug")`,
      `CREATE INDEX IF NOT EXISTS "Warehouse_isActive_idx" ON "Warehouse"("isActive")`,
      `CREATE TABLE IF NOT EXISTS "BinLocation" (
        "id" TEXT NOT NULL,
        "warehouseId" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "zone" TEXT,
        "rack" TEXT,
        "shelf" TEXT,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "BinLocation_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE INDEX IF NOT EXISTS "BinLocation_warehouseId_idx" ON "BinLocation"("warehouseId")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "BinLocation_warehouseId_code_key" ON "BinLocation"("warehouseId", "code")`,

      `CREATE TABLE IF NOT EXISTS "Supplier" (
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
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "totalPurchases" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "totalPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
        CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_slug_key" ON "Supplier"("slug")`,
      `CREATE INDEX IF NOT EXISTS "Supplier_isActive_idx" ON "Supplier"("isActive")`,

      `CREATE TABLE IF NOT EXISTS "CouponUsage" (
        "id" TEXT NOT NULL,
        "couponId" TEXT NOT NULL,
        "orderId" TEXT NOT NULL,
        "userId" TEXT,
        "discount" DECIMAL(10,2) NOT NULL,
        "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CouponUsage_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE INDEX IF NOT EXISTS "CouponUsage_couponId_idx" ON "CouponUsage"("couponId")`,
      `CREATE INDEX IF NOT EXISTS "CouponUsage_orderId_idx" ON "CouponUsage"("orderId")`,
      `CREATE INDEX IF NOT EXISTS "CouponUsage_userId_idx" ON "CouponUsage"("userId")`,

      `CREATE TABLE IF NOT EXISTS "CostingLot" (
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
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "CostingLot_lotNumber_key" ON "CostingLot"("lotNumber")`,

      `CREATE TABLE IF NOT EXISTS "GoodsReceiptNote" (
        "id" TEXT NOT NULL,
        "grnNumber" TEXT NOT NULL,
        "purchaseId" TEXT NOT NULL,
        "receivedBy" TEXT,
        "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "GoodsReceiptNote_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "GoodsReceiptNote_grnNumber_key" ON "GoodsReceiptNote"("grnNumber")`,

      `CREATE TABLE IF NOT EXISTS "GoodsReceiptNoteItem" (
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
      )`,

      `CREATE TABLE IF NOT EXISTS "SupplierPayment" (
        "id" TEXT NOT NULL,
        "supplierId" TEXT NOT NULL,
        "amount" DECIMAL(14,2) NOT NULL,
        "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "paymentMethod" TEXT,
        "reference" TEXT,
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
      )`,

      `CREATE TABLE IF NOT EXISTS "SupplierPaymentInvoice" (
        "id" TEXT NOT NULL,
        "paymentId" TEXT NOT NULL,
        "invoiceNo" TEXT NOT NULL,
        CONSTRAINT "SupplierPaymentInvoice_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "SupplierPaymentInvoice_invoiceNo_key" ON "SupplierPaymentInvoice"("invoiceNo")`,

      `CREATE TABLE IF NOT EXISTS "Purchase" (
        "id" TEXT NOT NULL,
        "supplierId" TEXT NOT NULL,
        "referenceNo" TEXT NOT NULL,
        "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "expectedDate" TIMESTAMP(3),
        "status" TEXT NOT NULL DEFAULT 'draft',
        "subtotal" DECIMAL(12,2) NOT NULL,
        "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "total" DECIMAL(12,2) NOT NULL,
        "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "notes" TEXT,
        "createdBy" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "Purchase_referenceNo_key" ON "Purchase"("referenceNo")`,
      `CREATE INDEX IF NOT EXISTS "Purchase_supplierId_idx" ON "Purchase"("supplierId")`,
      `CREATE INDEX IF NOT EXISTS "Purchase_status_idx" ON "Purchase"("status")`,
      `CREATE INDEX IF NOT EXISTS "Purchase_createdAt_idx" ON "Purchase"("createdAt")`,

      `CREATE TABLE IF NOT EXISTS "PurchaseItem" (
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
      )`,
      `CREATE INDEX IF NOT EXISTS "PurchaseItem_purchaseId_idx" ON "PurchaseItem"("purchaseId")`,
      `CREATE INDEX IF NOT EXISTS "PurchaseItem_productId_idx" ON "PurchaseItem"("productId")`,

      `CREATE TABLE IF NOT EXISTS "Expense" (
        "id" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "categoryId" TEXT NOT NULL,
        "amount" DECIMAL(10,2) NOT NULL,
        "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "expenseDate" TIMESTAMP(3) NOT NULL,
        "paymentMethod" TEXT,
        "paymentAccountId" TEXT,
        "journalEntryId" TEXT,
        "referenceNo" TEXT,
        "notes" TEXT,
        "receiptUrl" TEXT,
        "createdBy" TEXT,
        "updatedBy" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "Expense_journalEntryId_key" ON "Expense"("journalEntryId")`,
      `CREATE INDEX IF NOT EXISTS "Expense_categoryId_idx" ON "Expense"("categoryId")`,
      `CREATE INDEX IF NOT EXISTS "Expense_paymentAccountId_idx" ON "Expense"("paymentAccountId")`,

      `CREATE TABLE IF NOT EXISTS "Account" (
        "id" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "parentId" TEXT,
        "description" TEXT,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "isGroup" BOOLEAN NOT NULL DEFAULT false,
        "createdBy" TEXT,
        "updatedBy" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "Account_code_key" ON "Account"("code")`,
      `CREATE INDEX IF NOT EXISTS "Account_type_idx" ON "Account"("type")`,
      `CREATE INDEX IF NOT EXISTS "Account_parentId_idx" ON "Account"("parentId")`,

      `CREATE TABLE IF NOT EXISTS "FinancialPeriod" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "startDate" TIMESTAMP(3) NOT NULL,
        "endDate" TIMESTAMP(3) NOT NULL,
        "isClosed" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "FinancialPeriod_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "FinancialPeriod_startDate_endDate_key" ON "FinancialPeriod"("startDate", "endDate")`,

      `CREATE TABLE IF NOT EXISTS "OpeningBalance" (
        "id" TEXT NOT NULL,
        "accountId" TEXT NOT NULL,
        "periodId" TEXT NOT NULL,
        "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "OpeningBalance_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "OpeningBalance_accountId_periodId_key" ON "OpeningBalance"("accountId", "periodId")`,
      `CREATE INDEX IF NOT EXISTS "OpeningBalance_periodId_idx" ON "OpeningBalance"("periodId")`,

      `CREATE TABLE IF NOT EXISTS "JournalEntry" (
        "id" TEXT NOT NULL,
        "entryNo" TEXT NOT NULL,
        "periodId" TEXT NOT NULL,
        "entryDate" TIMESTAMP(3) NOT NULL,
        "description" TEXT NOT NULL,
        "totalDebit" DECIMAL(14,2) NOT NULL,
        "totalCredit" DECIMAL(14,2) NOT NULL,
        "isOpening" BOOLEAN NOT NULL DEFAULT false,
        "referenceNo" TEXT,
        "createdBy" TEXT,
        "updatedBy" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "JournalEntry_entryNo_key" ON "JournalEntry"("entryNo")`,
      `CREATE INDEX IF NOT EXISTS "JournalEntry_periodId_idx" ON "JournalEntry"("periodId")`,
      `CREATE INDEX IF NOT EXISTS "JournalEntry_entryDate_idx" ON "JournalEntry"("entryDate")`,

      `CREATE TABLE IF NOT EXISTS "JournalEntryLine" (
        "id" TEXT NOT NULL,
        "entryId" TEXT NOT NULL,
        "accountId" TEXT NOT NULL,
        "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "description" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "JournalEntryLine_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE INDEX IF NOT EXISTS "JournalEntryLine_entryId_idx" ON "JournalEntryLine"("entryId")`,
      `CREATE INDEX IF NOT EXISTS "JournalEntryLine_accountId_idx" ON "JournalEntryLine"("accountId")`,

      `CREATE TABLE IF NOT EXISTS "expense_categories" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "slug" TEXT NOT NULL,
        "description" TEXT,
        "icon" TEXT,
        "color" TEXT,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "accountId" TEXT,
        CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "expense_categories_slug_key" ON "expense_categories"("slug")`,
      `CREATE INDEX IF NOT EXISTS "expense_categories_accountId_idx" ON "expense_categories"("accountId")`
    ];

    for (const sql of tableFixes) {
      try {
        await this.runRaw(sql);
      } catch (err: any) {
        this.logger.warn(`Schema drift table fix skipped: ${err.message}`);
      }
    }

    // Step 1: Add columns that may be missing (idempotent via IF NOT EXISTS).
    // Each ALTER TABLE runs in its own call because PostgreSQL does not
    // support multiple semicolon-separated statements in a single query().
    const columnFixes: [string, string][] = [
      // === Product Table ===
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "name" TEXT`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "slug" TEXT`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'simple'`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "description" TEXT`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "shortDesc" TEXT`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "basePrice" DECIMAL(10,2) NOT NULL DEFAULT 0`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "salePrice" DECIMAL(10,2)`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sku" TEXT`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "stock" INTEGER NOT NULL DEFAULT 0`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "lowStockQty" INTEGER`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "categoryId" TEXT`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "tags" JSONB DEFAULT '[]'`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "images" JSONB DEFAULT '[]'`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "seoMeta" JSONB DEFAULT '{}'`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "manageStock" BOOLEAN NOT NULL DEFAULT false`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "brandId" TEXT`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "reservedStock" INTEGER NOT NULL DEFAULT 0`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "defaultBinLocationId" TEXT`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT`],
      ['Product',        `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sizeChartId" TEXT`],

      // === ProductVariant Table ===
      ['ProductVariant', `ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "productId" TEXT`],
      ['ProductVariant', `ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "sku" TEXT`],
      ['ProductVariant', `ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "price" DECIMAL(10,2)`],
      ['ProductVariant', `ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "stock" INTEGER NOT NULL DEFAULT 0`],
      ['ProductVariant', `ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "image" TEXT`],
      ['ProductVariant', `ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true`],
      ['ProductVariant', `ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "reservedStock" INTEGER NOT NULL DEFAULT 0`],
      ['ProductVariant', `ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "binLocationId" TEXT`],
      ['ProductVariant', `ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT`],

      // === Combo Table ===
      ['Combo',          `ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "name" TEXT`],
      ['Combo',          `ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "slug" TEXT`],
      ['Combo',          `ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "description" TEXT`],
      ['Combo',          `ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "shortDesc" TEXT`],
      ['Combo',          `ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "basePrice" DECIMAL(10,2) NOT NULL DEFAULT 0`],
      ['Combo',          `ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "salePrice" DECIMAL(10,2)`],
      ['Combo',          `ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "image" TEXT`],
      ['Combo',          `ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "images" JSONB DEFAULT '[]'`],
      ['Combo',          `ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "categoryId" TEXT`],
      ['Combo',          `ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "tags" JSONB DEFAULT '[]'`],
      ['Combo',          `ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "seoMeta" JSONB DEFAULT '{}'`],
      ['Combo',          `ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false`],
      ['Combo',          `ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true`],
      ['Combo',          `ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "manageStock" BOOLEAN NOT NULL DEFAULT false`],
      ['Combo',          `ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "stock" INTEGER NOT NULL DEFAULT 0`],
      ['Combo',          `ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3)`],
      ['Combo',          `ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "endDate" TIMESTAMP(3)`],
      ['Combo',          `ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "reservedStock" INTEGER NOT NULL DEFAULT 0`],
      ['Combo',          `ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT`],
      // === OrderItem Table ===
      ['OrderItem',      `ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "costingLotId" TEXT`],

      // === Coupon Table ===
      ['Coupon',         `ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'flat'`],
      ['Coupon',         `ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "value" DECIMAL(10,2) NOT NULL DEFAULT 0`],
      ['Coupon',         `ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "minOrderValue" DECIMAL(10,2)`],
      ['Coupon',         `ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "maxUses" INTEGER`],
      ['Coupon',         `ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "usedCount" INTEGER NOT NULL DEFAULT 0`],
      ['Coupon',         `ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "maxUsesPerCustomer" INTEGER`],
      ['Coupon',         `ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "percentageCap" DECIMAL(5,2)`],
      ['Coupon',         `ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "startsAt" TIMESTAMP(3)`],
      ['Coupon',         `ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3)`],
      ['Coupon',         `ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true`],
    ];


    for (const [table, sql] of columnFixes) {
      try {
        await this.runRaw(sql);
      } catch (err: any) {
        this.logger.warn(`Schema drift fix skipped for ${table}: ${err.message}`);
      }
    }

    // Foreign key constraints — each in its own DO block
    const fkFixes: string[] = [
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_brandId_fkey') THEN
          ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey"
            FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_warehouseId_fkey') THEN
          ALTER TABLE "Product" ADD CONSTRAINT "Product_warehouseId_fkey"
            FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductVariant_warehouseId_fkey') THEN
          ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_warehouseId_fkey"
            FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_sizeChartId_fkey') THEN
          ALTER TABLE "Product" ADD CONSTRAINT "Product_sizeChartId_fkey"
            FOREIGN KEY ("sizeChartId") REFERENCES "SizeChart"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderItem_costingLotId_fkey') THEN
          ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_costingLotId_fkey"
            FOREIGN KEY ("costingLotId") REFERENCES "CostingLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OpeningBalance_accountId_fkey') THEN
          ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_accountId_fkey"
            FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OpeningBalance_periodId_fkey') THEN
          ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_periodId_fkey"
            FOREIGN KEY ("periodId") REFERENCES "FinancialPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JournalEntry_periodId_fkey') THEN
          ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_periodId_fkey"
            FOREIGN KEY ("periodId") REFERENCES "FinancialPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JournalEntryLine_entryId_fkey') THEN
          ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_entryId_fkey"
            FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JournalEntryLine_accountId_fkey') THEN
          ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_accountId_fkey"
            FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_categories_accountId_fkey') THEN
          ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_accountId_fkey"
            FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Expense_categoryId_fkey') THEN
          ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey"
            FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Expense_paymentAccountId_fkey') THEN
          ALTER TABLE "Expense" ADD CONSTRAINT "Expense_paymentAccountId_fkey"
            FOREIGN KEY ("paymentAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Expense_journalEntryId_fkey') THEN
          ALTER TABLE "Expense" ADD CONSTRAINT "Expense_journalEntryId_fkey"
            FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Purchase_supplierId_fkey') THEN
          ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplierId_fkey"
            FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseItem_purchaseId_fkey') THEN
          ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseId_fkey"
            FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierPayment_supplierId_fkey') THEN
          ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey"
            FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierPaymentInvoice_paymentId_fkey') THEN
          ALTER TABLE "SupplierPaymentInvoice" ADD CONSTRAINT "SupplierPaymentInvoice_paymentId_fkey"
            FOREIGN KEY ("paymentId") REFERENCES "SupplierPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CouponUsage_couponId_fkey') THEN
          ALTER TABLE "CouponUsage" ADD CONSTRAINT "CouponUsage_couponId_fkey"
            FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CouponUsage_orderId_fkey') THEN
          ALTER TABLE "CouponUsage" ADD CONSTRAINT "CouponUsage_orderId_fkey"
            FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$`,
    ];

    for (const sql of fkFixes) {
      try {
        await this.runRaw(sql);
      } catch (err: any) {
        this.logger.warn(`Schema drift FK fix skipped: ${err.message}`);
      }
    }

    this.logger.log('Schema drift check: all required columns verified ✓');
  }

  private async seedAdminUser(): Promise<void> {
    try {
      const email = process.env.ADMIN_EMAIL || 'admin@ecomate.com';
      const plainPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
      const bcrypt = require('bcryptjs');
      const adminPassword = await bcrypt.hash(plainPassword, 12);

      await (this as any).user.upsert({
        where: { email },
        update: {
          password: adminPassword,
        },
        create: {
          firstName: 'Super',
          lastName: 'Admin',
          username: 'superadmin',
          email,
          phoneNumber: '+8801700000000',
          password: adminPassword,
          role: 'superadmin',
          status: 'active',
        },
      });
      this.logger.log(`[License/Seed] Admin user synced/seeded: ${email}`);
    } catch (err: any) {
      this.logger.warn(`Failed to auto-seed admin user: ${err.message}`);
    }
  }
}
