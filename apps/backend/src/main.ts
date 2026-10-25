// Patch BigInt serialization for JSON responses (Prisma aggregation returns BigInt)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { join } from 'path';
import {
  NestFastifyApplication,
  FastifyAdapter,
} from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { auth } from './better-auth/auth.config';
import { baPrisma } from './better-auth/prisma';
import { CacheService } from './cache/cache.service';
import { PrismaService } from './prisma/prisma.service';
import { randomUUID } from 'crypto';

// BA brute-force attempt log (F5): key `${ip}:${endpoint}` → attempt
// timestamps (60s window); lockouts key → locked-until ms.
const baAttemptLog = new Map<string, number[]>();
const baLockouts = new Map<string, number>();

async function bootstrap() {
  // Load .env — try project root, backend root, then cwd
  const { config } = await import('dotenv');
  config({ path: join(__dirname, '..', '..', '..', '..', '.env') }); // monorepo root
  config({ path: join(__dirname, '..', '..', '.env') }); // apps/backend/
  config(); // cwd fallback

  if (!process.env['JWT_SECRET'] || !process.env['JWT_REFRESH_SECRET']) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'JWT_SECRET and JWT_REFRESH_SECRET are required in production. Set them via environment variables.',
      );
    }
    console.warn(
      '[bootstrap] JWT_SECRET/JWT_REFRESH_SECRET not set — using dev defaults',
    );
    process.env['JWT_SECRET'] =
      process.env['JWT_SECRET'] ||
      'eco-mate-jwt-secret-change-in-production-2026';
    process.env['JWT_REFRESH_SECRET'] =
      process.env['JWT_REFRESH_SECRET'] ||
      'eco-mate-refresh-secret-change-in-production-2026';
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
  );
  app.enableShutdownHooks();
  const cacheService = app.get(CacheService);
  const prismaService = app.get(PrismaService);
  let durableMaintenanceMemo: {
    expiresAt: number;
    value?: { mode: 'full_backup' | 'restore' };
  } = { expiresAt: 0 };
  const activeWriteMarkers = new Map<string, string>();
  const clearActiveWriteMarker = async (requestId: string) => {
    const marker = activeWriteMarkers.get(requestId);
    if (!marker) return;
    activeWriteMarkers.delete(requestId);
    await cacheService.delete(marker);
  };

  await app.register(helmet, {
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https://*.r2.dev',
          'https://images.unsplash.com',
        ],
        connectSrc: [
          "'self'",
          'https://*.r2.dev',
          ...(process.env['CSP_CONNECT_SRC']
            ? [process.env['CSP_CONNECT_SRC']]
            : []),
        ],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
      },
    },
  });

  await app.register(compress);

  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', async (request, reply) => {
      let pathname = request.url.split('?', 1)[0];
      try {
        pathname = decodeURIComponent(pathname);
      } catch {
        return reply.code(400).send({ message: 'Malformed request path' });
      }
      // Legacy local backups were written beneath uploads before private
      // backup storage existed. Never expose them through the public static
      // media route; authenticated backup streaming remains available.
      if (
        pathname === '/uploads/backups' ||
        pathname.startsWith('/uploads/backups/')
      ) {
        return reply.code(404).send({ message: 'Not found' });
      }

      const isHealthRead =
        (request.method === 'GET' || request.method === 'HEAD') &&
        pathname.startsWith('/api/health');
      const isTrackedWrite =
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
        (pathname.startsWith('/api/') || pathname.startsWith('/uploads/'));
      if (isTrackedWrite) {
        const marker =
          `system:backup-active-write:${process.pid}:` +
          `${request.id}:${randomUUID()}`;
        activeWriteMarkers.set(String(request.id), marker);
        await cacheService.set(
          marker,
          { startedAt: new Date().toISOString() },
          24 * 60 * 60 * 1000,
        );
      }
      let maintenance = await cacheService.get<{
        mode?: 'full_backup' | 'restore';
      }>('system:backup-maintenance');
      if (
        !maintenance &&
        !isHealthRead &&
        (pathname.startsWith('/api/') || pathname.startsWith('/uploads/'))
      ) {
        const requestIsRead =
          request.method === 'GET' || request.method === 'HEAD';
        if (!requestIsRead || durableMaintenanceMemo.expiresAt <= Date.now()) {
          try {
            const tableRows = await prismaService.rawQuery<{ exists: boolean }>(
              `SELECT to_regclass('ecomate_control.backup_restore_operation') IS NOT NULL AS "exists"`,
            );
            let durableRestoring = false;
            if (tableRows[0]?.exists === true) {
              const restoreRows = await prismaService.rawQuery<{ active: boolean }>(
                `SELECT EXISTS (
                  SELECT 1
                  FROM "ecomate_control"."backup_restore_operation"
                  WHERE "phase" IN ('preparing','database_committed','failed_after_commit')
                ) AS "active"`,
              );
              durableRestoring = restoreRows[0]?.active === true;
            }
            const sessionRows = await prismaService.rawQuery<{ active: boolean }>(
              `SELECT EXISTS (
                SELECT 1
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND application_name = 'ecomate-backup-restore'
              ) AS "active"`,
            );
            const restoreActive = sessionRows[0]?.active === true || durableRestoring;
            const durableOwner = restoreActive
              ? { status: 'restoring' }
              : await prismaService.backupJob.findFirst({
                  where: {
                    OR: [
                      { status: 'restoring' },
                      { status: 'running', scope: 'db_files' },
                    ],
                  },
                  select: { status: true },
                });
            durableMaintenanceMemo = {
              expiresAt: Date.now() + 1000,
              value: durableOwner
                ? {
                    mode:
                      durableOwner.status === 'restoring'
                        ? 'restore'
                        : 'full_backup',
                  }
                : undefined,
            };
          } catch {
            // During psql DDL phases the catalog itself can be momentarily
            // unavailable. Fail closed for API/media traffic, but health checks
            // were excluded above so the container is not restarted mid-restore.
            durableMaintenanceMemo = {
              expiresAt: Date.now() + 1000,
              value: { mode: 'restore' },
            };
          }
        }
        maintenance = durableMaintenanceMemo.value;
      }
      if (maintenance?.mode && request.method !== 'OPTIONS') {
        const isRead = request.method === 'GET' || request.method === 'HEAD';
        const isBackupRead = isRead && pathname.startsWith('/api/admin/backup');
        const apiOrMediaRequest =
          pathname.startsWith('/api/') || pathname.startsWith('/uploads/');
        const shouldBlock =
          apiOrMediaRequest &&
          !isBackupRead &&
          !isHealthRead &&
          (maintenance.mode === 'restore' || !isRead);

        if (shouldBlock) {
          reply.header('Retry-After', '30');
          return reply.code(503).send({
            statusCode: 503,
            message:
              maintenance.mode === 'restore'
                ? 'Restore in progress; retry shortly'
                : 'Full backup snapshot in progress; writes are temporarily paused',
          });
        }
      }
      if (
        pathname.startsWith('/uploads/') &&
        (request.method === 'POST' || request.method === 'PUT')
      ) {
        const contentType = request.headers['content-type'];
        if (contentType && !contentType.startsWith('image/')) {
          console.warn(
            `Non-image upload attempt: ${request.method} ${request.url} (${contentType})`,
          );
        }
      }
    });

  await app.register(fastifyStatic, {
    root: join(process.cwd(), 'uploads'),
    prefix: '/uploads/',
    // Local restore can atomically replace bytes at the same media URL. Do not
    // instruct browsers/CDNs to pin that path for a year.
    maxAge: 60 * 60 * 1000,
    immutable: false,
    // SECURITY (2026-10-25, F15): /uploads/ serves user-controlled files
    // (incl. stored HTML/SVG) from the API origin. Sandbox + nosniff mean
    // a stored HTML file can never run scripts or be sniffed into an
    // executable type in a visitor's browser, even if one slips past the
    // MIME-only extension rule.
    setHeaders: (res) => {
      res.header('Content-Security-Policy', 'sandbox');
      res.header('X-Content-Type-Options', 'nosniff');
    },
  });
  await app.register(fastifyStatic, {
    // The on-disk layout is public/assets/<...> and the public URL space is
    // /assets/<...> — the root must be the assets folder itself. Pointing it
    // at public/ instead shifted every URL to /assets/assets/<...> and made
    // /assets/logos/* 404 (the bundled gateway/courier logos never loaded).
    root: join(process.cwd(), 'public', 'assets'),
    prefix: '/assets/',
    maxAge: 365 * 24 * 60 * 60 * 1000,
    immutable: true,
    decorateReply: false,
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
    },
  });

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
    allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id'],
    maxAge: 86400,
  });

  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onResponse', async (request, reply) => {
      await clearActiveWriteMarker(String(request.id));
      const duration = reply.elapsedTime.toFixed(0);
      const requestPath = request.url.split(/[?#]/, 1)[0];
      console.log(
        `${request.method} ${requestPath} ${reply.statusCode} ${duration}ms`,
      );
    });
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequestAbort', async (request) => {
      await clearActiveWriteMarker(String(request.id));
    });

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.setGlobalPrefix('api', { exclude: ['/'] });

  const fastifyInstance = app.getHttpAdapter().getInstance();

  // BA: intercept via onRequest hook with hijack
  const corsOrigins = process.env['CORS_ORIGIN']
    ? process.env['CORS_ORIGIN'].split(',').map((o) => o.trim())
    : [
        'http://localhost:5173',
        'http://localhost:3000',
        'https://mac.riaz.com.bd',
      ];
  fastifyInstance.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/better-auth/')) return;
    // SECURITY (2026-10-25, F5): per-IP brute-force limiter for the
    // credential endpoints, applied BEFORE the hijack (the hijacked BA
    // handler runs outside Nest guards/rate-limiters). 10 attempts per
    // IP per endpoint per minute, then 429 for 15 minutes. In-memory
    // (single-instance API); a lockout here never blocks legitimate
    // traffic from other IPs. Email-keyed limiting is intentionally NOT
    // done here — it would require consuming the request body before
    // the hijacked handler reads it.
    if (
      request.method === 'POST' &&
      (request.url.startsWith('/api/better-auth/sign-in/email') ||
        request.url.startsWith('/api/better-auth/sign-up/email'))
    ) {
      // Fastify runs with trustProxy: true, so request.ip already follows
      // the edge's X-Forwarded-For. (Residual: if the edge does not strip
      // client-sent XFF, this key is spoofable — same caveat as the rest
      // of the app's IP handling; the edge must overwrite XFF.)
      const ip = request.ip || 'unknown';
      const key = `${ip}:${request.url.split('?')[0]}`;
      const now = Date.now();
      const attempts = (baAttemptLog.get(key) || []).filter(
        (t) => now - t < 60_000,
      );
      attempts.push(now);
      baAttemptLog.set(key, attempts);
      const lockedUntil = baLockouts.get(key);
      if (lockedUntil && now < lockedUntil) {
        reply.code(429).send({
          message: 'Too many sign-in attempts. Try again later.',
        });
        return;
      }
      if (attempts.length > 10) {
        baLockouts.set(key, now + 15 * 60_000);
        reply.code(429).send({
          message: 'Too many sign-in attempts. Try again later.',
        });
        return;
      }
    }
    try {
      reply.hijack();
      const rawBody = await new Promise<string>((resolve) => {
        if (['GET', 'HEAD', 'DELETE'].includes(request.method))
          return resolve('');
        const chunks: Buffer[] = [];
        const raw = request.raw;
        raw.on('data', (chunk: Buffer) => chunks.push(chunk));
        raw.on('end', () => resolve(Buffer.concat(chunks).toString()));
        raw.on('error', () => resolve(''));
        const timer = setTimeout(
          () => resolve(Buffer.concat(chunks).toString()),
          1000,
        );
        raw.on('end', () => clearTimeout(timer));
      });
      const url = new URL(request.url, `http://${request.headers.host}`);
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(', '));
      }

      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        body: rawBody || undefined,
      });
      const response = await auth.handler(req);
      const res = reply.raw;
      const body = await response.text();
      res.statusCode = response.status;
      const setCookieHeaders: string[] = [];
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') setCookieHeaders.push(value);
        else res.setHeader(key, value);
      });
      if (setCookieHeaders.length)
        res.setHeader('set-cookie', setCookieHeaders);
      // CORS: since hijack bypasses @fastify/cors, set headers manually
      const origin = request.headers.origin;
      if (origin && corsOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader(
          'Access-Control-Allow-Methods',
          'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        );
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type,Authorization',
        );
      }
      // BA -> UserProfile sync: reuse baPrisma singleton instead of creating new connections
      if (response.status === 200 && rawBody && request.method === 'POST') {
        const urlPath = url.pathname;
        try {
          const parsedBody = JSON.parse(rawBody);

          if (urlPath.endsWith('/change-password') && parsedBody.newPassword) {
            const { fromNodeHeaders } = await import('better-auth/node');
            const bHeaders = fromNodeHeaders(request.headers);
            const session = await auth.api.getSession({ headers: bHeaders });
            if (session?.user?.id) {
              const profile = await baPrisma.userProfile.findFirst({
                where: { betterAuthUserId: session.user.id },
                select: { id: true, betterAuthUserId: true },
              });
              if (profile?.betterAuthUserId) {
                const bcrypt = await import('bcryptjs');
                const hashedPassword = await bcrypt.hash(
                  parsedBody.newPassword,
                  12,
                );
                await baPrisma.userProfile.update({
                  where: { id: profile.id },
                  data: { password: hashedPassword },
                });
              }
              // SECURITY (2026-10-25): a password change revokes every
              // OTHER session (the current one stays, so the user who just
              // changed their password is not logged out). Stolen sessions
              // must not survive a password change. Reset-password revokes
              // ALL sessions via revokeSessionsOnPasswordReset in
              // auth.config.ts; sign-out already deletes its own session.
              try {
                const currentToken = (session as any)?.session?.token;
                await baPrisma.betterAuthSession.deleteMany({
                  where: {
                    userId: session.user.id,
                    ...(currentToken
                      ? { token: { not: currentToken } }
                      : {}),
                  },
                });
              } catch (revokeErr) {
                console.error(
                  '[BA-sync] Failed to revoke other sessions after password change:',
                  revokeErr,
                );
              }
            }
          }

          if (urlPath.endsWith('/change-email') && parsedBody.newEmail) {
            const { fromNodeHeaders } = await import('better-auth/node');
            const bHeaders = fromNodeHeaders(request.headers);
            const session = await auth.api.getSession({ headers: bHeaders });
            if (session?.user?.id) {
              const profile = await baPrisma.userProfile.findFirst({
                where: { betterAuthUserId: session.user.id },
                select: { id: true, betterAuthUserId: true },
              });
              if (profile?.betterAuthUserId) {
                await baPrisma.userProfile.update({
                  where: { id: profile.id },
                  data: {
                    email: parsedBody.newEmail,
                    emailVerified: session.user.emailVerified,
                  },
                });
              }
            }
          }
        } catch (syncErr) {
          console.error(
            '[BA-sync] Failed to sync BA change to UserProfile:',
            syncErr,
          );
        }
      }

      res.end(body);
    } catch (error) {
      request.log.error(error);
      try {
        reply.raw.statusCode = 500;
        reply.raw.setHeader('content-type', 'application/json');
        if (
          request.headers.origin &&
          corsOrigins.includes(request.headers.origin)
        ) {
          reply.raw.setHeader(
            'Access-Control-Allow-Origin',
            request.headers.origin,
          );
          reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        reply.raw.end(JSON.stringify({ error: 'Authentication error' }));
      } catch {
        /* ignore */
      }
    }
  });

  const port = process.env['PORT'] || 4000;
  await app.listen(port, '0.0.0.0');

  console.log(`Server running on http://localhost:${port}`);
}
bootstrap();

// Global error handlers to prevent process crash on unhandled rejections
process.on('unhandledRejection', (reason) => {
  console.error(
    '[FATAL] Unhandled Rejection:',
    reason instanceof Error ? reason.message : reason,
  );
});
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error.message);
});
