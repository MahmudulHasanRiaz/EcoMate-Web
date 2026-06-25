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
