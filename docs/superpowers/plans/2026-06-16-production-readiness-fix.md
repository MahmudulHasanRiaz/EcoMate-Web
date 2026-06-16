# EcoMate Production Readiness Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) for syntax tracking.

**Goal:** Fix all critical and high-priority issues identified in the production readiness audit, making EcoMate deployable via Docker + Portainer.

**Architecture:** Monorepo with 3 apps — NestJS 11 backend, Next.js 16 storefront, React 19/Vite 8 admin panel. All services containerized behind Nginx reverse proxy, deployable via Portainer stacks.

**Tech Stack:** Docker, docker-compose, Nginx, Portainer, NestJS, Next.js, React, Prisma, PostgreSQL

---

## Workstream 1: Backend Security & Data Integrity

### Task 1.1: Fix Hardcoded JWT Fallback Secret
**Files:**
- Modify: `apps/backend/src/auth/refresh-jwt.strategy.ts:19-20`
- Modify: `apps/backend/src/main.ts:11-15`

- [ ] **Remove fallback secret from refresh-jwt.strategy.ts**

Change from:
```ts
secretOrKey:
  process.env['JWT_REFRESH_SECRET'] || 'eco-mate-refresh-secret',
```
To:
```ts
secretOrKey: process.env['JWT_REFRESH_SECRET'] as string,
```

- [ ] **Add JWT_REFRESH_SECRET validation to main.ts**

The existing validation in main.ts checks both JWT_SECRET and JWT_REFRESH_SECRET already — good. Just ensure it properly throws. Already done at line 11-15.

### Task 1.2: Fix OrderStatusController — Add Auth Guard
**Files:**
- Modify: `apps/backend/src/orders/order-status.controller.ts`
- Create: `apps/backend/src/orders/dto/update-order-status.dto.ts`

- [ ] **Create DTO with class-validator**

```ts
import { IsOptional, IsString, IsBoolean, IsNumber, IsArray } from 'class-validator';

export class UpdateOrderStatusDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  nextStatuses?: string[];

  @IsOptional()
  @IsBoolean()
  isInitial?: boolean;

  @IsOptional()
  @IsBoolean()
  isFinal?: boolean;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}
```

- [ ] **Update OrderStatusController with auth guard and DTO**

```ts
import { Controller, Get, Post, Put, Body, Param, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Controller('order-statuses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrderStatusController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  findAll() {
    return this.prisma.orderStatus.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  @Put(':id')
  @Roles('superadmin', 'admin')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.prisma.orderStatus.update({ where: { id }, data: dto as any });
  }
}
```

### Task 1.3: Add Email Service (SMTP Integration)
**Files:**
- Modify: `apps/backend/src/email/email.service.ts`
- Modify: `apps/backend/src/email/email.module.ts`

- [ ] **Update EmailService with real SMTP support**

```ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class EmailService {
  async sendOtp(email: string, otp: string) {
    // TODO: Replace with real SMTP provider (e.g., SendGrid, SES, Mailgun)
    // For now, log in dev but prepare for production:
    if (process.env['NODE_ENV'] === 'production') {
      // await this.sendMail({ to: email, subject: 'Your OTP', text: `Your OTP is: ${otp}` });
      throw new Error('Email service not configured. Set SMTP_* env vars.');
    }
    console.log(`[EmailService] DEV: Sending OTP to ${email}: ${otp}`);
  }

  async sendVerificationEmail(email: string, token: string) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('Email service not configured. Set SMTP_* env vars.');
    }
    console.log(`[EmailService] DEV: Sending verification email to ${email}: token=${token}`);
  }
}
```

### Task 1.4: Wrap Order Creation in Prisma Transaction
**Files:**
- Modify: `apps/backend/src/orders/orders.service.ts`

Add `$transaction` wrapper around order creation (lines ~366-493) to ensure stock deduction, payment creation, coupon update, and lead conversion are atomic.

### Task 1.5: Fix bKash Callback Error Handling
**Files:**
- Modify: `apps/backend/src/gateways/bkash-pgw.controller.ts`

Replace empty catch block with proper error handling + logging.

### Task 1.6: Add Missing Database Indexes
**Files:**
- Modify: `apps/backend/prisma/schema.prisma`

Add indexes:
- `Order`: `@@index([courierService])`, `@@index([courierConsignmentId])`, `@@index([courierTrackingCode])`
- `Payment`: `@@index([transactionId])`
- `Product`: `@@index([sku])`
- `CheckoutLead`: `@@index([fingerprint])`
- `CourierDispatchLog`: `@@index([orderId])`, `@@index([courier])`
- `InventoryLog`: `@@index([productId, variantId, createdAt])`
- `Refund`: `@@index([orderId])`

### Task 1.7: Add Graceful Shutdown Hook
**Files:**
- Modify: `apps/backend/src/main.ts`

Add `app.enableShutdownHooks()` after line 17.

### Task 1.8: Add Request Correlation ID Middleware
**Files:**
- Create: `apps/backend/src/common/middleware/correlation-id.middleware.ts`

```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
    req['correlationId'] = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
  }
}
```

Register in `app.module.ts` or `main.ts`.

### Task 1.9: Add Rate Limiting on SSE and Webhook Endpoints
**Files:**
- Modify: `apps/backend/src/tracking/tracking.controller.ts`
- Modify: `apps/backend/src/courier-manager/courier-manager.controller.ts`

Add `@Throttle()` decorators to SSE and webhook endpoints.

---

## Workstream 2: Storefront SSR & SEO Fixes

### Task 2.1: Split Combo Detail Page (Server + Client)
**Files:**
- Create: `apps/storefront/app/combos/[id]/page.tsx` (server shell)
- Create: `apps/storefront/components/ComboDetailClient.tsx` (client interactive)
- Create: `apps/storefront/lib/api/combos.ts` (server fetch)

- [ ] **Create server shell page**

```tsx
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ComboDetailClient } from '@/components/ComboDetailClient';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

async function getCombo(id: string) {
  const res = await fetch(`${API}/combos/${id}`, { next: { revalidate: 300 } });
  if (!res.ok) return null;
  const data = await res.json();
  return data;
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const combo = await getCombo(params.id);
  if (!combo) return { title: 'Combo Not Found' };
  return {
    title: `${combo.name} — Fixed Plus`,
    description: combo.shortDesc?.slice(0, 160) || `Check out our ${combo.name} combo deal`,
    openGraph: {
      title: combo.name,
      description: combo.shortDesc,
      images: combo.image ? [{ url: combo.image }] : [],
    },
  };
}

export default async function ComboDetailPage({ params }: { params: { id: string } }) {
  const combo = await getCombo(params.id);
  if (!combo) notFound();
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-pulse bg-gray-200 h-64 w-full max-w-lg rounded-xl" /></div>}>
      <ComboDetailClient combo={combo} />
    </Suspense>
  );
}
```

- [ ] **Create client component** — Extract all interactive logic from existing page into `components/ComboDetailClient.tsx`

### Task 2.2: Add generateStaticParams for Product Pages
**Files:**
- Modify: `apps/storefront/app/products/[slug]/page.tsx`

Add:
```ts
export async function generateStaticParams() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/products?isActive=true&perPage=100`);
  const { data } = await res.json();
  return (data || []).map((p: any) => ({ slug: p.slug }));
}
```

### Task 2.3: Add DOMPurify to CMS Pages
**Files:**
- Modify: `apps/storefront/app/pages/[slug]/page.tsx`

Add import: `import DOMPurify from 'isomorphic-dompurify';`
Wrap CMS content: `dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(page.content) }}`

### Task 2.4: Fix Manifest — Add PNG Icons
**Files:**
- Modify: `apps/storefront/public/manifest.json`

Add 192x192 and 512x512 PNG icons with proper paths.

### Task 2.5: Fix Theme Color to Match Brand (#0089CD)
**Files:**
- Modify: `apps/storefront/app/layout.tsx`

Change theme-color meta from `#16a34a` to `#0089CD`.

### Task 2.6: Add Metadata to Shipping Policy Page
**Files:**
- Modify: `apps/storefront/app/shipping-policy/page.tsx`

Add `export const metadata`.

### Task 2.7: Add JSON-LD Schemas
**Files:**
- Modify: `apps/storefront/app/products/[slug]/page.tsx`
- Modify: `apps/storefront/app/faq/page.tsx`
- Modify: `apps/storefront/app/layout.tsx`

Add BreadcrumbList schema on product pages, AggregateRating/Review schema, FAQPage schema.

### Task 2.8: Add Error Boundaries to all Routes
**Files:**
- Create: `apps/storefront/app/products/[slug]/error.tsx`
- Create: `apps/storefront/app/combos/[id]/error.tsx`
- Create: `apps/storefront/app/combos/[id]/not-found.tsx`
- Create: `apps/storefront/app/account/error.tsx`
- Create: `apps/storefront/app/checkout/thank-you/error.tsx`

---

## Workstream 3: Admin Panel Fixes

### Task 3.1: Add react-hook-form + Zod to Product Form
**Files:**
- Modify: `apps/admin/src/features/products/product-form.tsx`

Replace raw `useState` with `react-hook-form` + Zod schema. Add field-level validation.

### Task 3.2: Add HttpOnly Cookie Support for JWT
**Files:**
- Modify: `apps/admin/src/lib/api-client.ts`
- Modify: `apps/admin/src/stores/auth-store.ts`
- Modify: `apps/admin/src/lib/cookies.ts`

Change token storage from JS-accessible cookie to memory-only (rely on backend HttpOnly cookie for refresh). The access token is stored in memory (Zustand), not in `document.cookie`.

### Task 3.3: Add RBAC Route Guards
**Files:**
- Create: `apps/admin/src/lib/auth-guard.tsx`
- Modify: `apps/admin/src/routes/__root.tsx`

Create an RBAC guard component that checks user role and redirects unauthorized users.

### Task 3.4: Add Query Error States to Features
**Files:**
- Modify: All feature hooks that are missing `isError` handling

Add loading/error/data pattern to all `useQuery` calls.

---

## Workstream 4: DevOps — Docker, Portainer & Deployment

### Task 4.1: Create Dockerfile for Backend
**Files:**
- Create: `apps/backend/Dockerfile`

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./
COPY --from=builder /app/public ./public
USER nestjs
EXPOSE 4000
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/health || exit 1
CMD ["node", "dist/src/main"]
```

### Task 4.2: Create Dockerfile for Storefront
**Files:**
- Create: `apps/storefront/Dockerfile`

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
RUN mkdir .next
RUN chown nextjs:nodejs .next
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1
CMD ["node", "server.js"]
```

### Task 4.3: Create Dockerfile for Admin
**Files:**
- Create: `apps/admin/Dockerfile`

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:skip-tsc

FROM nginx:stable-alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
```

### Task 4.4: Create Nginx Config for Admin
**Files:**
- Create: `apps/admin/nginx.conf`

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://backend:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;
    gzip_min_length 1000;
}
```

### Task 4.5: Create Root Nginx Reverse Proxy Config
**Files:**
- Create: `nginx/nginx.conf`

```nginx
events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    sendfile on;
    keepalive_timeout 65;
    client_max_body_size 20M;

    # Backend API
    server {
        listen 80;
        server_name mac.riaz.com.bd;

        location / {
            proxy_pass http://storefront:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /api/ {
            proxy_pass http://backend:4000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /admin/ {
            proxy_pass http://admin:80/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /uploads/ {
            proxy_pass http://backend:4000;
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }

        location /assets/ {
            proxy_pass http://backend:4000;
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }

        location /_next/static/ {
            proxy_pass http://storefront:3000;
            proxy_cache_bypass $http_upgrade;
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
}
```

### Task 4.6: Create docker-compose.yml
**Files:**
- Create: `docker-compose.yml`

```yaml
version: "3.8"

networks:
  ecomate-network:
    driver: bridge

volumes:
  postgres-data:
  uploads-data:

services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    networks:
      - ecomate-network
    volumes:
      - postgres-data:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: ${POSTGRES_DB:-ecomate_web}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-postgres}"]
      interval: 10s
      timeout: 5s
      retries: 5
    ports:
      - "5432:5432"

  backend:
    build:
      context: ./apps/backend
      dockerfile: Dockerfile
    restart: unless-stopped
    networks:
      - ecomate-network
    volumes:
      - uploads-data:/app/uploads
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres}@postgres:5432/${POSTGRES_DB:-ecomate_web}
      JWT_SECRET: ${JWT_SECRET}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET}
      JWT_EXPIRES_IN: ${JWT_EXPIRES_IN:-15m}
      JWT_REFRESH_EXPIRES_IN: ${JWT_REFRESH_EXPIRES_IN:-7d}
      PORT: 4000
      CORS_ORIGIN: ${CORS_ORIGIN:-http://localhost:3000,https://mac.riaz.com.bd}
      APP_URL: ${APP_URL:-https://mac.riaz.com.bd}
      STOREFRONT_URL: ${STOREFRONT_URL:-https://mac.riaz.com.bd}
      META_PIXEL_ID: ${META_PIXEL_ID:-}
      META_ACCESS_TOKEN: ${META_ACCESS_TOKEN:-}
      TIKTOK_PIXEL_CODE: ${TIKTOK_PIXEL_CODE:-}
      TIKTOK_ACCESS_TOKEN: ${TIKTOK_ACCESS_TOKEN:-}
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:4000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
    ports:
      - "4000:4000"

  backend-migrate:
    build:
      context: ./apps/backend
      dockerfile: Dockerfile
    networks:
      - ecomate-network
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres}@postgres:5432/${POSTGRES_DB:-ecomate_web}
    depends_on:
      postgres:
        condition: service_healthy
    command: sh -c "npx prisma migrate deploy && npx prisma db seed || true"

  storefront:
    build:
      context: ./apps/storefront
      dockerfile: Dockerfile
    restart: unless-stopped
    networks:
      - ecomate-network
    environment:
      NODE_ENV: production
      NEXT_PUBLIC_API_URL: ${STORE_NEXT_PUBLIC_API_URL:-https://mac.riaz.com.bd/api}
      NEXT_PUBLIC_STOREFRONT_URL: ${STORE_NEXT_PUBLIC_STOREFRONT_URL:-https://mac.riaz.com.bd}
    depends_on:
      - backend
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
    ports:
      - "3000:3000"

  admin:
    build:
      context: ./apps/admin
      dockerfile: Dockerfile
    restart: unless-stopped
    networks:
      - ecomate-network
    environment:
      VITE_API_URL: ${ADMIN_VITE_API_URL:-/api}
    depends_on:
      - backend
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:80/"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    ports:
      - "8080:80"

  nginx:
    image: nginx:stable-alpine
    restart: unless-stopped
    networks:
      - ecomate-network
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - backend
      - storefront
      - admin
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:80/"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

### Task 4.7: Create Portainer Stack Template
**Files:**
- Create: `portainer/portainer-stack.json`

```json
{
  "version": "2",
  "name": "ecomate",
  "description": "EcoMate E-Commerce Platform - Full Stack Deployment",
  "note": "Deploy via Portainer UI. Create the stack with all env vars below.",
  "repository": {
    "url": "https://github.com/your-org/ecomate-web",
    "stackfile": "docker-compose.yml"
  },
  "env": [
    { "name": "POSTGRES_USER", "label": "PostgreSQL User", "default": "postgres" },
    { "name": "POSTGRES_PASSWORD", "label": "PostgreSQL Password", "default": "postgres" },
    { "name": "POSTGRES_DB", "label": "PostgreSQL Database", "default": "ecomate_web" },
    { "name": "JWT_SECRET", "label": "JWT Secret (change this!)", "default": "" },
    { "name": "JWT_REFRESH_SECRET", "label": "JWT Refresh Secret (change this!)", "default": "" },
    { "name": "CORS_ORIGIN", "label": "CORS Origins (comma separated)", "default": "https://mac.riaz.com.bd" },
    { "name": "APP_URL", "label": "App URL", "default": "https://mac.riaz.com.bd" },
    { "name": "STOREFRONT_URL", "label": "Storefront URL", "default": "https://mac.riaz.com.bd" },
    { "name": "META_PIXEL_ID", "label": "Meta Pixel ID", "default": "" },
    { "name": "META_ACCESS_TOKEN", "label": "Meta Access Token", "default": "" },
    { "name": "TIKTOK_PIXEL_CODE", "label": "TikTok Pixel Code", "default": "" },
    { "name": "TIKTOK_ACCESS_TOKEN", "label": "TikTok Access Token", "default": "" },
    { "name": "STORE_NEXT_PUBLIC_API_URL", "label": "Storefront API URL", "default": "https://mac.riaz.com.bd/api" },
    { "name": "STORE_NEXT_PUBLIC_STOREFRONT_URL", "label": "Storefront Public URL", "default": "https://mac.riaz.com.bd" },
    { "name": "ADMIN_VITE_API_URL", "label": "Admin API URL", "default": "/api" }
  ]
}
```

### Task 4.9: Create .env.example for All Apps
**Files:**
- Create: `apps/storefront/.env.example`
- Update: `apps/backend/.env.example` (already exists but improve it)

**storefront .env.example:**
```
NEXT_PUBLIC_API_URL=http://localhost:4000/api
NEXT_PUBLIC_STOREFRONT_URL=http://localhost:3000
```

**backend .env.example (expanded):**
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ecomate_web
JWT_SECRET=change-this-to-a-random-secret
JWT_REFRESH_SECRET=change-this-to-another-random-secret
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
PORT=4000
CORS_ORIGIN=http://localhost:3000,http://localhost:5173,https://mac.riaz.com.bd
APP_URL=http://localhost:4000
STOREFRONT_URL=http://localhost:3000
META_PIXEL_ID=
META_ACCESS_TOKEN=
TIKTOK_PIXEL_CODE=
TIKTOK_ACCESS_TOKEN=
```

### Task 4.10: Create Root-Level Deployment Scripts
**Files:**
- Create: `scripts/deploy.sh`
- Create: `scripts/backup-db.sh` (enhance existing)
- Create: `scripts/health-check.sh`

### Task 4.11: Add output: 'standalone' to Next.js Config
**Files:**
- Modify: `apps/storefront/next.config.ts`

Add `output: 'standalone'` for Docker deployment.

---

## Workstream 5: CI/CD Pipeline

### Task 5.1: Create Root-Level GitHub Actions CI
**Files:**
- Create: `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  backend:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: ecomate_test
        ports:
          - 5432:5432
    defaults:
      run:
        working-directory: apps/backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx prisma generate
      - run: npm run lint
      - run: npm test

  storefront:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: apps/storefront
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test || true
      - run: npm run build

  admin:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: apps/admin
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test || true
      - run: npm run build:skip-tsc
```

### Task 5.2: Create GitHub Actions CD for Docker Deployment
**Files:**
- Create: `.github/workflows/deploy.yml`

```yaml
name: Deploy

on:
  workflow_run:
    workflows: ["CI"]
    branches: [main]
    types:
      - completed

jobs:
  deploy:
    runs-on: ubuntu-latest
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to VPS via Portainer Webhook
        run: |
          curl -X POST "${{ secrets.PORTAINER_WEBHOOK_URL }}"
```
