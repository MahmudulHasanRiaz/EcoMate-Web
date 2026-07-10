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

async function bootstrap() {
  if (!process.env['JWT_SECRET'] || !process.env['JWT_REFRESH_SECRET']) {
    throw new Error(
      'JWT_SECRET and JWT_REFRESH_SECRET environment variables are required',
    );
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
  );
  app.enableShutdownHooks();

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
        connectSrc: ["'self'", 'https://*.r2.dev'],
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
      if (
        request.url.startsWith('/uploads/') &&
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
      const duration = reply.elapsedTime.toFixed(0);
      console.log(
        `${request.method} ${request.url} ${reply.statusCode} ${duration}ms`,
      );
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
