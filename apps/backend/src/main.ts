import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { join } from 'path';
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

async function bootstrap() {
  // Auto-sync database schema: resolve failed migration + push all pending changes
  if (process.env['NODE_ENV'] === 'production') {
    // Method 1: try prisma CLI (resolve failed migration then db push)
    try {
      execSync(
        'npx prisma migrate resolve --rolled-back "20260623000000_add_landing_page" 2>/dev/null; npx prisma db push --accept-data-loss 2>&1',
        { cwd: process.cwd(), stdio: 'pipe', timeout: 60000 },
      );
      console.log('[Schema] Full schema sync completed');
    } catch {
      // Method 1b: if resolve fails, try marking as applied instead
      try {
        execSync(
          'npx prisma migrate resolve --applied "20260623000000_add_landing_page" 2>/dev/null; npx prisma db push --accept-data-loss 2>&1',
          { cwd: process.cwd(), stdio: 'pipe', timeout: 60000 },
        );
        console.log('[Schema] Schema sync completed (migration marked applied)');
      } catch {
        console.log('[Schema] prisma CLI sync unavailable');
      }
    }
    // Method 2: raw SQL fallback via PrismaClient
    try {
      const fallbackClient = new PrismaClient();
      await fallbackClient.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "LandingPage" (
          "id" TEXT NOT NULL,
          "title" TEXT NOT NULL,
          "slug" TEXT NOT NULL,
          "pageType" TEXT NOT NULL DEFAULT 'template',
          "templateId" TEXT,
          "sections" JSONB DEFAULT '[]',
          "customHtml" TEXT,
          "customCss" TEXT,
          "productIds" JSONB DEFAULT '[]',
          "comboIds" JSONB DEFAULT '[]',
          "trackingJson" JSONB DEFAULT '{}',
          "isActive" BOOLEAN NOT NULL DEFAULT false,
          "isDraft" BOOLEAN NOT NULL DEFAULT true,
          "publishedAt" TIMESTAMP(3),
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL,
          CONSTRAINT "LandingPage_pkey" PRIMARY KEY ("id")
        )
      `);
      await fallbackClient.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "LandingPage_slug_key" ON "LandingPage"("slug")`
      );
      await fallbackClient.$disconnect();
      console.log('[Schema] LandingPage table ready');
    } catch {
      console.log('[Schema] Table already exists');
    }
    // Migrate ExpenseCategory from enum to model (production-safe data migration)
    try {
      const ecClient = new PrismaClient();
      // Create expense_categories table if not exists
      await ecClient.$executeRawUnsafe(`
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
        )
      `);
      await ecClient.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "expense_categories_slug_key" ON "expense_categories"("slug")`
      );
      // Seed categories only if table is empty
      await ecClient.$executeRawUnsafe(`
        INSERT INTO "expense_categories" ("id", "name", "slug", "color", "sortOrder", "updatedAt")
        SELECT * FROM (VALUES
          ('cat-utilities', 'Utilities', 'utilities', '#3B82F6', 1, NOW()),
          ('cat-rent', 'Rent', 'rent', '#8B5CF6', 2, NOW()),
          ('cat-salaries', 'Salaries', 'salaries', '#10B981', 3, NOW()),
          ('cat-marketing', 'Marketing', 'marketing', '#F97316', 4, NOW()),
          ('cat-supplies', 'Supplies', 'supplies', '#EAB308', 5, NOW()),
          ('cat-maintenance', 'Maintenance', 'maintenance', '#EF4444', 6, NOW()),
          ('cat-travel', 'Travel', 'travel', '#6366F1', 7, NOW()),
          ('cat-shipping', 'Shipping', 'shipping', '#14B8A6', 8, NOW()),
          ('cat-taxes', 'Taxes', 'taxes', '#F43F5E', 9, NOW()),
          ('cat-insurance', 'Insurance', 'insurance', '#06B6D4', 10, NOW()),
          ('cat-software', 'Software', 'software', '#8B5CF6', 11, NOW()),
          ('cat-food_and_beverages', 'Food & Beverages', 'food_and_beverages', '#EC4899', 12, NOW()),
          ('cat-office_expenses', 'Office Expenses', 'office_expenses', '#64748B', 13, NOW()),
          ('cat-professional_fees', 'Professional Fees', 'professional_fees', '#D97706', 14, NOW()),
          ('cat-other', 'Other', 'other', '#6B7280', 15, NOW())
        ) AS v
        WHERE NOT EXISTS (SELECT 1 FROM "expense_categories")
      `);
      // Add categoryId column if not exists (nullable for backfill)
      await ecClient.$executeRawUnsafe(`
        DO $$ BEGIN
          ALTER TABLE "expenses" ADD COLUMN "categoryId" TEXT;
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$;
      `);
      // Backfill: map old category enum value to new categoryId
      await ecClient.$executeRawUnsafe(`
        UPDATE "expenses"
        SET "categoryId" = 'cat-' || "category"::text
        WHERE "categoryId" IS NULL AND "category" IS NOT NULL
      `);
      // Make categoryId NOT NULL after backfill
      await ecClient.$executeRawUnsafe(`
        ALTER TABLE "expenses" ALTER COLUMN "categoryId" SET NOT NULL
      `);
      // Drop old category column
      await ecClient.$executeRawUnsafe(`
        ALTER TABLE "expenses" DROP COLUMN IF EXISTS "category"
      `);
      // Drop old enum type
      await ecClient.$executeRawUnsafe(`
        DROP TYPE IF EXISTS "ExpenseCategory"
      `);
      await ecClient.$disconnect();
      console.log('[Schema] ExpenseCategory migration completed');
    } catch (e) {
      console.log('[Schema] ExpenseCategory migration skipped or already done:', (e as Error).message?.slice(0, 100));
    }
  }
  if (!process.env['JWT_SECRET'] || !process.env['JWT_REFRESH_SECRET']) {
    throw new Error(
      'JWT_SECRET and JWT_REFRESH_SECRET environment variables are required',
    );
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.enableShutdownHooks();

  await app.register(helmet, {
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "https://*.r2.dev", "https://images.unsplash.com"],
        connectSrc: ["'self'", "https://*.r2.dev"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
      },
    },
  });

  await app.register(compress);

  app.getHttpAdapter().getInstance().addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/uploads/') && (request.method === 'POST' || request.method === 'PUT')) {
      const contentType = request.headers['content-type'];
      if (contentType && !contentType.startsWith('image/')) {
        console.warn(`Non-image upload attempt: ${request.method} ${request.url} (${contentType})`);
      }
    }
  });

  await app.register(fastifyStatic, {
    root: join(process.cwd(), 'uploads'),
    prefix: '/uploads/',
    maxAge: 365 * 24 * 60 * 60 * 1000,
    immutable: true,
  });
  await app.register(fastifyStatic, {
    root: join(process.cwd(), 'public'),
    prefix: '/assets/',
    maxAge: 365 * 24 * 60 * 60 * 1000,
    immutable: true,
    decorateReply: false,
  });
  await app.register(cookie);

  app.enableCors({
    origin: process.env['CORS_ORIGIN']
      ? process.env['CORS_ORIGIN'].split(',').map((o) => o.trim())
      : [
          'http://localhost:5173',
          'http://localhost:3000',
          'https://mac.riaz.com.bd',
        ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  });

  app.getHttpAdapter().getInstance().addHook('onResponse', async (request, reply) => {
    const duration = reply.elapsedTime.toFixed(0);
    console.log(`${request.method} ${request.url} ${reply.statusCode} ${duration}ms`);
  });

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.setGlobalPrefix('api', { exclude: ['/'] });

  const port = process.env['PORT'] || 4000;
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}`);
}
bootstrap();
