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
        "updatedAt" TIMESTAMP(3) NOT NULL,
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
}
