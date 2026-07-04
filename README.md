# EcoMate Web

Production-grade, multi-tenant e-commerce platform with admin panel, storefront, and API — monorepo architecture. Licensed per-client via KeyMate/Keygen integration. Deployed via Docker + Portainer on VPS with GitHub Actions CI/CD.

## Architecture

```
EcoMate Web/
├── apps/
│   ├── admin/          React 19 SPA — Dashboard, orders, products, CRM, HR/accounting
│   ├── backend/        NestJS 11 (Fastify) — REST API, Prisma 7 + PostgreSQL 16
│   ├── pos/            React 19 SPA — Point of Sale (PWA, offline-capable)
│   └── storefront/     Next.js 16 — Public storefront, landing pages, checkout
├── packages/
│   ├── feature-flags/  NestJS module — runtime feature gating via license entitlements
│   ├── license-engine/ License validation client — KeyMate API + 7-day local cache
│   └── shared-types/   Shared TypeScript definitions across workspaces
├── docker-compose.yml  5 services (postgres, redis, backend, storefront, admin)
├── portainer/          Portainer stack config + self-hosted Keygen CE license server
├── docs/               Feature specs, deployment guides, superpowers design docs
└── .github/workflows/  CI (lint/test/build) + CD (Docker build/push + Portainer deploy)
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Monorepo** | npm workspaces (no Turborepo) |
| **Backend** | NestJS 11 + Fastify, TypeScript (strict) |
| **Admin** | React 19, Vite 6, TanStack Router, TanStack Query, TanStack Table |
| **Storefront** | Next.js 16 (App Router, standalone output) |
| **Database** | PostgreSQL 16 + Prisma 7 ORM |
| **Cache/Queue** | Redis 7 + BullMQ |
| **Auth** | Passport (JWT strategy), bcryptjs |
| **Admin UI** | shadcn/ui (Radix primitives), Tailwind CSS v4, Recharts, TipTap editor |
| **Storefront UI** | Tailwind CSS v4, Motion (Framer Motion), Lucide icons |
| **Validation** | Zod, class-validator, class-transformer |
| **Testing** | Vitest (admin/storefront), Jest (backend), Playwright (browser tests) |
| **CI/CD** | GitHub Actions → ghcr.io → Portainer webhook |
| **Containerization** | Docker (3-stage backend with JS obfuscation, 2-stage storefront & admin) |
| **Reverse Proxy** | Traefik (VPS) or Nginx (admin Docker image) |
| **Email** | Nodemailer |
| **File Storage** | AWS S3 + local uploads via sharp |
| **License Server** | Keygen CE (self-hosted) + KeyMate SaaS |
| **Security** | Helmet (Fastify), rate limiting, JS obfuscation, CSP headers, account lockout |

## Applications

### `apps/backend` — NestJS REST API

Fastify-based API at port 4000. Key modules:

- **Auth** — JWT login/register, refresh tokens, failed attempt lockout, RBAC
- **Catalog** — Products, variants, categories, brands, inventory, purchasing, GRN, size charts, attributes, tags, combos
- **Orders** — Checkout, payments, order lifecycle, shipping (Steadfast, Pathao, Redx, Carrybee), refunds, dispatch, packing, shipment tracking
- **CRM** — Customers, leads, referrals, email campaigns, notification templates, reviews
- **POS** — Point of Sale endpoints, offline sync support
- **Finance** — Chart of Accounts, double-entry journal entries, financial periods, expense management, opening balances
- **HR** — Employee management, payroll, attendance
- **CMS** — Pages, landing pages (template + custom HTML), media gallery
- **Operations** — Warehouses, suppliers, costing lots, pixel tracking, delivery areas, coupons, tasks
- **License** — License activation via KeyMate, encrypted credential storage (AES-256-GCM)
- **Security** — IP/phone blocking system, throttling, Helmet CSP
- **Platform** — Search, import/export, product feed (Google/Meta), queue management, cache, image processing, uploads, system settings

### `apps/admin` — React SPA Dashboard

Served at `/admin/` base path. Features:

- Dashboard with realtime charts (Recharts)
- Product/order/customer CRUD with TanStack Table (sort, filter, pagination)
- Landing page builder with TipTap editor
- Media gallery with upload, crop, compress
- Employee/HR management + payroll
- Accounting module (double-entry bookkeeping)
- Settings: store config, shipping zones, tax rates, email templates
- RBAC-based access control
- License activation page (first-run setup)

### `apps/pos` — React 19 SPA Point of Sale

PWA with offline support via service worker + IndexedDB. Features:

- Barcode/QR scanner for quick product lookup
- Offline mode with local queue, auto-sync on reconnect
- Cash, card, mobile banking payment handling
- Receipt printing (Bluetooth thermal printer)
- Customer display (dual-screen support)
- Order holds, splits, and discounts
- Shift management with cash-in/cash-out logging

### `apps/storefront` — Next.js 16 Public Site

- Product browsing, search, filtering
- Cart + checkout flow
- Landing pages (template + custom HTML modes)
- ISR with 300s revalidation
- Tracking pixel integration (Meta, TikTok)
- Dev-mode rewrites admin to local Vite dev server
- Security headers, image optimization, standalone Docker output

## Packages

| Package | Description |
|---------|-------------|
| `@ecomate/license-engine` | License validation against KeyMate API. Native addon (node-gyp). 7-day local cache. |
| `@ecomate/feature-flags` | NestJS module for runtime feature gating, driven by license entitlements. |
| `@ecomate/shared-types` | Shared TypeScript interfaces and types used across apps. |

## Quick Start (Development)

```bash
# 1. Install dependencies (root monorepo)
npm install

# 2. Copy env files
cp apps/backend/.env.example apps/backend/.env
cp apps/storefront/.env.example apps/storefront/.env
cp apps/admin/.env.example apps/admin/.env
cp apps/pos/.env.example apps/pos/.env

# 3. Start PostgreSQL + Redis (Docker)
docker compose up -d postgres redis

# 4. Run DB migrations
npm run backend:migrate

# 5. Start all dev servers (or individually)
npm run dev

# Individual servers:
npm run backend:dev    # http://localhost:4000
npm run admin:dev      # http://localhost:5173
npm run storefront:dev # http://localhost:3000
npm run pos:dev        # http://localhost:5174
```

### Dev Bypass (No License Required)

```bash
# Set in apps/backend/.env:
DEV_LICENSE_BYPASS=true
```
Only works when `NODE_ENV !== production`. Bypasses all license checks for local dev.

## Testing

```bash
# Backend (Jest)
cd apps/backend && npx jest

# Admin (Vitest)
cd apps/admin && npx vitest run

# Storefront (Vitest)
cd apps/storefront && npx vitest run

# Full CI pipeline (simulates GitHub Actions)
cd apps/backend && npx jest
cd apps/admin && npx vitest run && npm run build:skip-tsc
cd apps/storefront && npx vitest run && npm run build
```

## Deployment

### CI/CD Pipeline (GitHub Actions)

Push to `main` or `develop` (and PRs to `main`) triggers automated build + push to ghcr.io:

1. **detect-changes** — determines which apps changed
2. **backend** — lint, test (with postgres service container)
3. **storefront** — lint, test, build
4. **admin** — lint, test, build:skip-tsc
5. **build-push-*** — Docker build + push to `ghcr.io/mahmudulhasanriaz/ecomate-{backend,storefront,admin}`

### Docker Compose (VPS + Portainer)

```bash
# Set environment variables in Portainer stack
# Deploy docker-compose.yml with ghcr.io images
# Portainer auto-redeploys via webhook after CI
```

### Per-Client Deployment

```bash
# Manual workflow: .github/workflows/deploy-client.yml
# Select client + license plan → builds client-tagged images → triggers Portainer webhook
```

### Environment Variables

Key variables for production (set in Portainer stack):

| Variable | Description |
|----------|-------------|
| `CLIENT_DOMAIN` | Client domain (e.g., example.com) |
| `JWT_SECRET` | `openssl rand -hex 64` |
| `JWT_REFRESH_SECRET` | Different from JWT_SECRET |
| `POSTGRES_PASSWORD` | DB password |
| `LICENSE_ENCRYPTION_KEY` | `openssl rand -hex 32` (AES-256-GCM) |
| `KEYMATE_API_URL` | KeyMate license server URL |
| `REDIS_PASSWORD` | Redis password |
| `CORS_ORIGIN` | Comma-separated allowed origins |
| `META_PIXEL_ID`, `TIKTOK_PIXEL_CODE` | Tracking pixels |

Full list: `apps/backend/.env.example` and root `.env.example`.

## Database

- **ORM:** Prisma 7
- **Schema:** `apps/backend/prisma/schema.prisma` (~1710 lines, 84 models)
- **Migrations:** 30 migrations
- **Hard rule:** Every `schema.prisma` change REQUIRES a migration file. `db push --accept-data-loss` is FORBIDDEN.

```bash
# Create migration
cd apps/backend && npx prisma migrate dev --name <description>

# Apply in production
npx prisma migrate deploy

# Generate client
npx prisma generate
```

## License Activation

- License credentials stored encrypted in DB (AES-256-GCM), not env vars
- Activation via UI at `/license/activate` after sign-in
- Domain auto-detected from `Host` header
- 7-day offline cache after initial activation
- Requires KeyMate reachable for first activation (no grace period)
- Production Docker images set `NODE_ENV=production` — license is mandatory

API reference: `POST /api/license/activate` — `{ licenseKey, apiKey? }`

## Obfuscation

Backend Docker build applies `javascript-obfuscator` (control flow flattening, string array encoding, dead code injection, self-defending). Config: `apps/backend/obfuscator.config.json`.

## Docs

| File | Contents |
|------|----------|
| `docs/keygen-setup.md` | Self-hosted Keygen CE license server deployment |
| `docs/landing-page-builder.md` | Landing/sales page builder technical spec |
| `docs/portainer-deployment.md` | VPS + Portainer deployment guide |
| `docs/superpowers/` | Feature plans and design specs (accounting, HR, catalog, etc.) |
| `AGENT.md` | AI agent behavior rules and project conventions |
| `apps/backend/.env.example` | Backend environment variables |
| `portainer/keygen/.env.example` | Keygen license server environment |

## Project Conventions

- **TypeScript strict mode** across all workspaces
- **npm workspaces** monorepo (no Turborepo)
- **Shared types** in `packages/shared-types/`
- **Strict app boundaries** — no direct imports between apps
- **API-first** — core commerce should not depend on realtime
- **Migration safety** — every schema change gets a migration file
- **Tests required** for critical flows (checkout, payment, inventory, orders, auth, RBAC, refunds)
- **JS obfuscation** applied to backend production builds only

## Multi-Tenancy

Per-client isolated deployment model:

1. Each client gets a dedicated Docker stack on Portainer
2. Client-specific env vars + domain
3. License plan determines feature entitlement
4. Deploy via `deploy-client.yml` GitHub Actions workflow
5. Images tagged per client (e.g., `ecomate-backend:fixeplus`)
