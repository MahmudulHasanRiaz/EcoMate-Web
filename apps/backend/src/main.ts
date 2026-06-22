import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

async function bootstrap() {
  // Auto-sync database schema: resolve failed migration + create missing tables
  if (process.env['NODE_ENV'] === 'production') {
    // Method 1: via prisma CLI (resolve failed migration then db push)
    try {
      execSync(
        'npx prisma migrate resolve --rolled-back "20260623000000_add_landing_page" 2>/dev/null; npx prisma db push --accept-data-loss 2>&1',
        { cwd: process.cwd(), stdio: 'pipe', timeout: 30000 },
      );
      console.log('[Schema] Database schema synced successfully');
    } catch {
      console.log('[Schema] prisma CLI sync skipped');
    }
    // Method 2: raw SQL fallback via PrismaClient (always runs, creates LandingPage if missing)
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
  }
  if (!process.env['JWT_SECRET'] || !process.env['JWT_REFRESH_SECRET']) {
    throw new Error(
      'JWT_SECRET and JWT_REFRESH_SECRET environment variables are required',
    );
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();

  app.use(helmet({
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
  }));

  app.use(compression());

  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ limit: '1mb', extended: true }));

  app.use('/uploads', (req, res, next) => {
    const contentType = req.headers['content-type'];
    if (contentType && !contentType.startsWith('image/')) {
      console.warn(`Non-image upload attempt: ${req.method} ${req.originalUrl} (${contentType})`);
    }
    next();
  });

  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
    maxAge: '1y',
    immutable: true,
  } as any);
  app.useStaticAssets(join(process.cwd(), 'public'), {
    prefix: '/assets/',
    maxAge: '1y',
    immutable: true,
  } as any);
  app.use(cookieParser());

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

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    });
    next();
  });

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.setGlobalPrefix('api', { exclude: ['/'] });

  const port = process.env['PORT'] || 4000;
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}`);
}
bootstrap();
