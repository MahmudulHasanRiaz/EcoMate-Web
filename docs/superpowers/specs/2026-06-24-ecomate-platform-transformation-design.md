# EcoMate Platform Transformation Design
> **Superseded by:** `docs/2-ARCHITECTURE/ARCHITECTURE.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

**Date:** 2026-06-24
**Status:** Draft

## 1. Overview

EcoMate is a production e-commerce platform (monorepo: backend NestJS/Express, admin TanStack Router, storefront Next.js) deployed for client FIXEDPLUS via GitHub Actions + Docker + GHCR + Portainer.

**Goal:** Transform into a licensable, obfuscated, modular Business OS with horizontal scaling, without disrupting existing clients.

---

## 2. Architecture: Core + Client Overlay Model

```
ecomate/
├── packages/
│   ├── core/                  # Shared business logic
│   ├── license-engine/        # C++ N-API addon (obfuscated)
│   ├── feature-flags/         # License→feature mapping
│   └── types/                 # Shared TypeScript types
├── apps/
│   ├── backend/               # NestJS → Fastify migration
│   ├── admin/                 # TanStack Router admin
│   └── storefront/            # Next.js storefront
└── clients/                   # Optional overlays per client (gitignored for most)
    └── client-xyz/
        ├── admin-overlay/
        ├── storefront-overlay/
        └── client.config.ts
```

**Key properties:**
- Core updates → all clients receive automatically
- Client overlay → only in that client's Docker image
- No overlay breaks core (interface-bound)
- Build-time merge: core + overlay → single obfuscated Docker image

### Client Overlay Mechanism

Client overlay = **loose files + Docker build-time substitution**. Not git branch, not submodule.

```
GitHub Action build step:
1. Checkout main branch (core source)
2. If overlay dir exists in clients/client-xyz/:
   - Copy overlay files into respective app dirs (same path = override)
   - Merge client.config.ts into build env
3. Build
4. Obfuscate
5. Docker image tagged: ghcr.io/ecomate/ecomate-backend:client-xyz
```

Overlay rules:
- Same file path in overlay → overrides core at build time
- New file in overlay → added to image
- Overlay can import core modules, core never imports overlay
- `clients/` dir gitignored except example files | secrets stored as GitHub Secrets
- Client without overlay → uses pure core image

### Client Config Schema
```typescript
// clients/client-xyz/client.config.ts
export default {
  clientId: 'client_abc123',
  displayName: 'XYZ Store',
  features: {
    // Extend core features
    customOrderField: true,
  },
  overrides: {
    // Replace specific components/views
    admin: { loginLogo: '/overrides/xyz-logo.svg' },
    storefront: { theme: { primaryColor: '#00A859' } },
  },
  branding: {
    primaryColor: '#00A859',
    logo: '/overrides/xyz-logo.svg',
    favicon: '/overrides/xyz-favicon.ico',
  },
}
```

---

## 3. License System: Keygen CE + Hybrid

### Architecture

```
License Server (Keygen CE, self-hosted)
    │
    ├── Online check (configurable interval, default 7 days)
    │
    └── Offline fallback: Signed JWT cached locally
```

### License Token Structure
```json
{
  "clientId": "client_abc123",
  "plan": "enterprise",
  "packages": ["pos", "multi-warehouse"],
  "customFeatures": ["yellow-courier-integration"],
  "limits": { "cpus": 2, "memory": "2G", "users": 10, "stores": 3 },
  "exp": 1763568000,
  "iat": 1732032000
}
```

### Client-Side Enforcement (C++ N-API)
- License verification runs in native C++ addon — invisible to JS layer
- JWT verification with public key embedded in binary blob
- Machine fingerprinting
- Anti-debugging + integrity checks
- On failure: **graceful degradation** (limited mode, never crash)

### Hybrid Strategy
| Scenario | Behavior |
|---|---|
| Keygen reachable | Verify + sync fresh license |
| Keygen offline, cached JWT valid | Continue normally |
| Keygen offline, cached JWT expired | Limited mode (7-day grace) |
| License revoked | Keygen returns revoked → degraded on next online check |

---

## 4. Code Protection Pipeline

```
Source Code → npm ci + build → Obfuscation → Docker build → GHCR push
```

**Obfuscation layers:**
1. **JavaScript:** `javascript-obfuscator` — control flow flattening, string encryption, dead code
2. **License engine:** C++ N-API addon (compiled binary, not readable from JS)
3. **Runtime:** Anti-debug, integrity self-check
4. **Network:** All license traffic is signed JWT

---

## 5. Fastify Migration

### Strategy: Platform swap only

```diff
- import { NestExpressApplication } from '@nestjs/platform-express';
+ import { NestFastifyApplication } from '@nestjs/platform-fastify';

- const app = await NestFactory.create<NestExpressApplication>(AppModule);
+ const app = await NestFactory.create<NestFastifyApplication>(AppModule);
```

**Middleware replacements:**
| Express | Fastify equivalent |
|---|---|
| `helmet` | `@fastify/helmet` |
| `compression` | `@fastify/compress` |
| `cookie-parser` | `@fastify/cookie` |
| Express `json/urlencoded` | Fastify built-in |

**No impact on:** Prisma, Guards, Pipes, Interceptors, Controllers, Services, DTOs.

---

## 6. Redis & BullMQ

### Queues
| Queue | Purpose |
|---|---|
| `import-queue` | Product/order import (existing job manager → BullMQ) |
| `email-queue` | Transactional emails |
| `license-sync` | Periodic license checks |
| `webhook-queue` | Outgoing webhooks |
| `report-generation` | Heavy analytics reports |

### Redis usage
- BullMQ broker
- Cache (existing `CacheModule` → Redis-backed)
- Rate limiting (ThrottlerModule → Redis)
- WebSocket pub/sub (admin live updates)

---

## 7. Deployment Architecture: Shared Cluster + Horizontal Scale

```
Traefik (Layer 7, SSL termination, auto Let's Encrypt)
    │
    ├── Docker Swarm Cluster ────────────────────────┐
    │   ├── Node 1 (32G/8vCPU)                       │
    │   │   ├── stack: client-xyz (backend+admin+sf) │
    │   │   ├── stack: client-abc                    │
    │   │   └── stack: client-def                    │
    │   ├── Node 2 (32G/8vCPU) ← added when scaling  │
    │   └── Node N                                   │
    └── Shared services
        ├── PostgreSQL (replica-ready)
        ├── Redis
        └── Keygen CE (license server)
```

### Per-client Stack (docker-compose)
```yaml
services:
  backend:
    image: ghcr.io/ecomate/ecomate-backend:client-xyz
    deploy:
      resources:
        limits: { cpus: '1', memory: 1G }
  admin:    same image pattern
  storefront: same image pattern
```

### New Client Onboarding
```
1. Client pays → License issued in Keygen CE
2. GitHub Action "Deploy Client" triggered (manual):
   - Input: client name, plan, target server, custom domain
   - Builds obfuscated Docker image
   - Pushes to GHCR
   - Portainer API creates stack with resource limits
   - DNS setup (manual)
3. Client receives URL + admin credentials
```

### Horizontal Scaling
```
1. Monitor → node capacity full
2. Purchase new VPS (5 min)
3. Docker Swarm join → `docker swarm join --token xxx`
4. Portainer detects new node automatically
5. (Optional) Move heavy client stacks to new node
```

---

## 8. Feature Module Groups

### Group 1: Core Extension (Phase 1)
- Inventory Management (advance) — enhance existing
- Supplier & Purchase Management
- Expense Management
- SMTP/SMS Gateway + Order Notification (customizable)

### Group 2: Sales & Marketing (Phase 2)
- Meta/TikTok Catalog Sync
- Meta Ad Account + Campaign Management & Analytics
- Multi Pixel Tracking + Offline Conversion
- Multi Store Sync (WooCommerce/Shopify)
- Landing Page Builder improvements (last phase)
- Wholesale & Wholesaler Management

### Group 3: Finance & HR (Phase 3)
- Accounting (with Cutup, Payroll)
- Analytics (P&L, Product-wise Profit)
- Advanced HR Management

### Group 4: Physical Operations (Phase 4)
- POS (Multi-showroom/Branch)
- Multi-server deployment enhancements

---

## 9. Database Model: Shared-Schema Multi-Client

**Choice:** Single PostgreSQL instance, shared tables with `clientId` column on every model that needs isolation.

### Rationale
- Simpler than separate DBs per client
- Zero migration for FIXEDPLUS (add `clientId` column with default)
- Connection pooling efficient (1 pool for all)
- Switch to separate DB later possible but not needed now

### Isolation Pattern
```prisma
model Product {
  clientId  String @default("fixedplus") // core client ID
  // ... existing fields
  @@index([clientId])
}
```

- Core client (FIXEDPLUS) keeps `clientId = "fixedplus"`
- Each new client gets unique `clientId`
- All CRUD service methods filter by `clientId` from license token
- Keygen CE enforces client can't access other client's data

### Attachment Isolation
- Media files: `uploads/{clientId}/` directory prefix
- S3 (future): `bucket/{clientId}/` prefix

---

## 10. Billing Server

**Separate mini-project, not part of monorepo.**

```
billing-server/
├── API (simple — Express or Hono)
├── Keygen CE integration (create/update/revoke licenses)
├── Stripe/SSLCommerz payment integration
└── Webhook receiver (payment success → auto-extend license)
```

- Minimal surface: create customer, issue license, handle payment, send webhook
- Client admin UI redirects to billing server for payments
- Billing server calls Keygen CE API to update license
- Billing server sends webhook to client's app to refresh cached license

---

## 11. Image Access Control (GHCR)

**Strategy: GitHub Packages granular permissions.**

```yaml
# Each client image pushed to GHCR
# Package visibility = private
# Only GitHub Actions + Portainer webhook server can pull

ghcr.io/ecomate/ecomate-backend:fixedplus    # FIXEDPLUS
ghcr.io/ecomate/ecomate-backend:client-xyz   # Client XYZ
```

Control:
- GitHub Actions has `packages: write` — push allowed
- Each client's Portainer/Server has deploy key scoped to specific image
- No cross-client image pull possible
- Shared images (e.g., `ecomate-backend:latest`) used only for internal dev

---

## 12. Failure Scenarios (Operational Runbook)

| Scenario | Impact | Mitigation |
|---|---|---|
| Docker Swarm manager down | Cluster orchestration paused | Multiple manager nodes (3 managers, raft consensus) |
| Node fails | Containers on that node stop | Swarm reschedules to other nodes. Per-client stack in compose ensures restart |
| GHCR down | Cannot deploy new version | Retry in GH Action. Build cached locally. No existing service impact |
| Keygen CE down | Existing licenses keep working (hybrid) | Cached JWT valid. 7-day grace. No hard block |
| PostgreSQL fails | All clients down | WAL streaming replica. Promote replica on failure. PgBouncer connection pooling for fast failover |
| Redis down | Queues stuck, cache cold | BullMQ jobs persisted in PG. Cache rebuilds from DB. Throttler uses memory fallback |
| Billing server down | No new subscriptions | Existing licenses unaffected. New clients wait |
| Full cluster failure | Complete outage | Backup + restore to new cluster (documented runbook) |
| Deployment corruption | Broken image | Previous image tag still in GHCR. Use Portainer to "Rollback" to previous stack |

---

## 13. FIXEDPLUS Coexistence (Critical)

FIXEDPLUS runs production. Must never break.

### Strategy: Dual-Track Until Ready
```
Week 1-4:   Core refactor (Fastify swap, Redis add) — deploy to FIXEDPLUS
            All changes = zero functional diff, only infra change
Week 5-8:   Obfuscation pipeline — deploy to FIXEDPLUS
            Same behavior, different binary
Week 9+:    License engine — FIXEDPLUS gets unlimited license
            Feature flags in code but all true for FIXEDPLUS
            New client onboarding on shared cluster
```

### Pin Existing Client Behavior
```yaml
# FIXEDPLUS docker stack stays same format
# Only image tag changes, compose structure identical
# Portainer webhook = same as today
```

### Feature Flag Default for Existing Clients
```typescript
// license-engine returns unlimited for FIXEDPLUS
const license = licenseEngine.verify(token);
// Old code: all features available
// New code: license.canUse('inventory-advance') → true for FIXEDPLUS
// When feature NOT in license → false
```

No legacy code path needed — just feature flag check at entry points.

---

## 14. WebSocket Architecture

### Protocol
- **Library:** Socket.IO with Redis adapter
- **Gateway namespace:** `/ws/admin`
- **Events (server→client):** `order.new`, `order.status`, `notification`, `inventory.low`, `task.assigned`
- **Events (client→server):** `subscribe.orders`, `subscribe.inventory`
- **Auth:** Socket.IO middleware validates JWT from socket handshake

### Constraints
- Redis adapter enables horizontal scale (multi-node pub/sub)
- Admin-only — storefront uses no WebSocket
- Falls back to polling if WebSocket fails
- Core commerce (checkout, payment, order placement) works without WebSocket — API-first

---

## 15. Client Billing UI

Each client sees in their admin panel:
- Current plan + expiry
- Usage stats (API calls, storage, users)
- Billing history
- Payment button → redirects to billing server
- Auto instructions for renewal

---

## 16. Database Optimization

- **Phase 1:** Index audit + slow query analysis + PgBouncer for connection pooling
- **Phase 2:** Prisma remains (no Drizzle migration now — scope is too large)
- **Drizzle migration:** Considered separately in future phase

---

## 17. Migration Plan (Zero Impact on FIXEDPLUS)

| Phase | Changes | FIXEDPLUS Impact |
|---|---|---|
| **Prep** | Keygen CE setup, `packages/` creation, C++ addon scaffold | None |
| **Fastify** | Platform swap only (no API change) | None — functional zero |
| **Obfuscation** | Build pipeline change only | Same behavior, different binary |
| **License** | Inject unlimited license for FIXEDPLUS | Continues as-is |
| **Redis/BullMQ** | Add Redis container, migrate cache | Performance improve |
| **New Modules** | License-gated features | Optional upgrade |
| **DB Optimization** | Indexes + PgBouncer | Query faster |

---

## 18. Package Structure (Draft)

| Package | Limits | Example Features |
|---|---|---|
| Essential | 0.5 CPU, 512MB | Core ecommerce, 1 user |
| Growth | 1 CPU, 1GB | + POS, coupons, 3 users |
| Enterprise | 2 CPU, 2GB | + Multi-warehouse, adv. reports, 10 users |
| Ultimate | Unlimited | + Custom modules, priority support |
| Add-on: POS | — | POS module |
| Custom | Per-nego | Client-specific features |

*(Final package mapping depends on which modules are in which group phase.)*
