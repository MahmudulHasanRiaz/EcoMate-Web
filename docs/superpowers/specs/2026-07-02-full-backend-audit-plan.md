# Full Backend Audit: Error Handling, Query Optimization, WebSocket & Fastify

**Date:** 2026-07-02
**Scope:** `apps/backend` — 57 controller modules, 64 services, Prisma schema, infrastructure
**Method:** Domain-grouped phased execution with 3-5 parallel sub-agents per batch

---

## 1. Objective

Audit and fix every backend module across 6 dimensions:

1. **Error Handling** — Every endpoint has proper try/catch, Prisma errors mapped to user-friendly messages, validation errors caught, correct HTTP status codes
2. **Query Optimization** — No N+1 queries, proper `select`/`include` usage, pagination, missing indexes, `findMany` with limits
3. **Bugs & Logic** — Race conditions, null pointer risks, wrong comparisons, off-by-one, edge cases, logical conflicts
4. **Prisma Schema** — Schema models match service usage, no missing relations/fields, all migrations applied
5. **WebSocket** — Real-time needs assessed: SSE vs WebSocket vs polling, proper push mechanism where needed
6. **Fastify** — No Express-isms, Fastify-native reply/request usage, platform-fastify compatibility

## 2. Sub-Agent Design

### 2.1 Per-Module Sub-Agent

Each controller module gets one sub-agent. The sub-agent:

1. Reads all files in the module: controller, service, DTOs, module definition
2. Runs against the 6-point checklist
3. Fixes issues found (Edit files directly)
4. Verifies fixes with `npm run build` and `npx tsc --noEmit`
5. Reports summary of issues found and changes made

### 2.2 Infrastructure Sub-Agents

Modules without dedicated controllers get standalone sub-agents:

| Sub-Agent | Scope |
|-----------|-------|
| `prisma-service` | PrismaService, PrismaModule, connection config, adapter-pg usage |
| `exception-filter` | GlobalExceptionFilter — Prisma error mapping coverage, Fastify compatibility |
| `auth-guards` | JwtAuthGuard, RolesGuard, decorators |
| `license-guard` | LicenseGuard, LicenseModule |
| `feature-guard` | FeatureGuard, feature-flags integration |
| `ip-block-middleware` | IpBlockMiddleware — Fastify middleware compat |
| `correlation-middleware` | CorrelationIdMiddleware |
| `throttler-guard` | ThrottlerGuard, rate limiting config |
| `cache-service` | CacheService, caching strategy |
| `email-service` | EmailService, email-queue |
| `storage-service` | StorageService, file handling |

### 2.3 Cross-Cutting Audit Sub-Agents (Phase 7)

| Sub-Agent | Scope |
|-----------|-------|
| `websocket-audit` | Scans all modules for polling patterns that should be WebSocket/SSE, verifies existing SSE implementation, recommends WebSocket Gateway additions |
| `fastify-audit` | Scans all imports for `@nestjs/platform-express`, `Response`, `Request` from express, verifies Fastify reply/request typing |
| `prisma-schema-audit` | Cross-references all service queries against schema.prisma, checks for unused models, missing indexes, relation completeness |
| `error-consistency-audit` | Ensures all modules follow same error pattern — consistent status codes, error shape, logging format |

## 3. Phase Breakdown

### Phase 0: Infrastructure
Order: Prisma → ExceptionFilter → Guards → Middleware → Services
*Parallel batch of 3-5 based on dependency*

| Batch | Sub-Agents | Dependencies |
|-------|------------|--------------|
| B0-A | PrismaService, GlobalExceptionFilter | None |
| B0-B | JwtAuthGuard, RolesGuard, LicenseGuard, FeatureGuard, ThrottlerGuard | PrismaService |
| B0-C | IpBlockMiddleware, CorrelationIdMiddleware | None |
| B0-D | CacheService, EmailService, StorageService | PrismaService |

### Phase 1: Core Auth & Security
| Batch | Sub-Agents |
|-------|------------|
| B1-A | auth, users, security |
| B1-B | block-settings, blocked-entries, settings |

### Phase 2: Product Catalog
| Batch | Sub-Agents |
|-------|------------|
| B2-A | products, categories, brands |
| B2-B | attributes, tags, size-charts |
| B2-C | combos, reviews |

### Phase 3: Order Pipeline
| Batch | Sub-Agents |
|-------|------------|
| B3-A | orders (main), orders (order-status) |
| B3-B | payments, checkout-leads |
| B3-C | coupons, refunds, shipment, shipping |
| B3-D | gateways, bkash-pgw, addresses |

### Phase 4: Finance & HR
| Batch | Sub-Agents |
|-------|------------|
| B4-A | accounting, expenses, expense-categories |
| B4-B | financial-periods, opening-balances, payroll |
| B4-C | purchases, suppliers, employees |

### Phase 5: Marketing & Content
| Batch | Sub-Agents |
|-------|------------|
| B5-A | campaigns, cms-pages, landing-pages |
| B5-B | referrals, notifications, tracking |

### Phase 6: Operations
| Batch | Sub-Agents |
|-------|------------|
| B6-A | courier-manager, courier-webhook, courier |
| B6-B | inventory, media, upload |
| B6-C | import, search, delivery-areas |
| B6-D | images, license, health, system-settings |

### Phase 7: Cross-Cutting Audit
| Batch | Sub-Agents |
|-------|------------|
| B7-A | WebSocket Audit, Fastify Audit, Prisma Schema Audit, Error Consistency Audit |

## 4. Safety & Execution Model

### 4.1 Git Branch Strategy
```
main
├── audit/phase-0-infrastructure
├── audit/phase-1-core
├── audit/phase-2-catalog
├── audit/phase-3-orders
├── audit/phase-4-finance
├── audit/phase-5-marketing
├── audit/phase-6-operations
└── audit/phase-7-cross-cutting
```

Each phase branch branches from `main`. After phase completion and verification, merge to `main`.

### 4.2 Batch Execution Flow
```
For each batch (3-5 sub-agents):
  1. Create feature branch from phase branch for each sub-agent
  2. Spawn 3-5 sub-agents in parallel
  3. Each sub-agent:
     a. Audits module against 6-point checklist
     b. Fixes issues found
     c. Runs npm run build && npx tsc --noEmit
     d. Reports summary
  4. All sub-agents complete → merge feature branches to phase branch
  5. Run verification gates:
     - npm run build
     - npm run test (existing tests)
     - npx prisma validate
     - npx tsc --noEmit
  6. If any gate fails:
     - Identify failing module
     - Revert its commit
     - Re-run its sub-agent with corrected instructions
  7. All batches in phase complete → merge phase branch to main
```

### 4.3 Verification Gates
| Gate | Command | When |
|------|---------|------|
| TypeScript compile | `npx tsc --noEmit` | After each batch |
| Build | `npm run build` | After each batch |
| Prisma validate | `npx prisma validate` | After each batch |
| Existing tests | `npm run test` | After each phase |

### 4.4 Rollback
If a sub-agent introduces a breaking change:
1. `git revert <commit-hash>` for that module
2. Re-run sub-agent with corrected scope
3. Re-verify

## 5. Reporting Format

Each sub-agent returns:

```json
{
  "module": "auth",
  "files": ["auth.controller.ts", "auth.service.ts", "auth.module.ts"],
  "checklist": {
    "error_handling": {"status": "fixed", "issues": 2, "details": ["Missing try/catch in login endpoint", "Prisma P2002 not mapped"]},
    "query_optimization": {"status": "passed", "issues": 0},
    "bugs": {"status": "fixed", "issues": 1, "details": ["Null check missing in getUserById"]},
    "prisma_gaps": {"status": "passed", "issues": 0},
    "websocket": {"status": "na", "issues": 0},
    "fastify": {"status": "fixed", "issues": 1, "details": ["Express Response type used"]}
  },
  "files_modified": ["apps/backend/src/auth/auth.service.ts"],
  "verification": {"build": "passed", "typescript": "passed"}
}
```

## 6. Total Effort Estimate

| Item | Count |
|------|-------|
| Total sub-agents | ~67 (57 modules + 10 infra) |
| Phases | 8 |
| Batches | ~18-20 |
| Parallel per batch | 3-5 |
| Estimated total batches | 20 |
| Estimated time per batch | 5-10 minutes |
| Estimated total time | ~2-3 hours |

## 7. Risk Register

| Risk | Mitigation |
|------|-----------|
| Conflicting changes from parallel sub-agents | Separate feature branches per sub-agent, merge one at a time |
| Build breaks after fix | Verification gate after every batch |
| Missing edge case in audit | Cross-cutting audit in Phase 7 catches systemic gaps |
| Prisma migration drift noted | Phase 7 Prisma Schema Audit covers all models |
| WebSocket recommendation implementation scope | Phase 7 WebSocket audit recommends; implementation scoped separately |
