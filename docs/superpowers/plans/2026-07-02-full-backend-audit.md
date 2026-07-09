# Full Backend Audit Implementation Plan
> **Superseded by:** `docs/2-ARCHITECTURE/ARCHITECTURE.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Each task = one phase = multiple sub-agents in parallel. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run 70 sub-agents across 8 phases to audit & fix all backend modules for error handling, query optimization, bugs, Prisma gaps, WebSocket needs, and Fastify conversion.

**Architecture:** Domain-grouped phased execution. Phase 0 = infrastructure, Phases 1-6 = feature modules grouped by domain, Phase 7 = cross-cutting audit. Each phase uses 3-5 parallel sub-agents, with verification gates (build, typecheck, test) between batches.

**Tech Stack:** NestJS 11, Fastify, Prisma (PostgreSQL), TypeScript, SSE (existing), no WebSocket yet

---

## File Structure

Files to be modified (per module):
- `apps/backend/src/<module>/*.controller.ts`
- `apps/backend/src/<module>/*.service.ts`
- `apps/backend/src/<module>/*.module.ts`
- `apps/backend/src/<module>/*.dto.ts` (if applicable)
- `apps/backend/prisma/schema.prisma` (if schema changes needed)

Infrastructure files:
- `apps/backend/src/common/filters/global-exception.filter.ts`
- `apps/backend/src/common/middleware/*.ts`
- `apps/backend/src/common/decorators/*.ts`
- `apps/backend/src/prisma/*.ts`
- `apps/backend/src/cache/*.ts`
- `apps/backend/src/email/*.ts`
- `apps/backend/src/storage/*.ts`
- `apps/backend/src/main.ts`

---

### Task 0: Git Scaffolding

- [ ] **Step 0.1: Verify current git status**
  ```bash
  git status
  git log --oneline -5
  ```
  Expected: clean working tree, on `main` or working branch.

- [ ] **Step 0.2: Create phase branches**
  ```bash
  git checkout -b audit/phase-0-infrastructure
  git checkout main
  git checkout -b audit/phase-1-core
  git checkout main
  git checkout -b audit/phase-2-catalog
  git checkout main
  git checkout -b audit/phase-3-orders
  git checkout main
  git checkout -b audit/phase-4-finance
  git checkout main
  git checkout -b audit/phase-5-marketing
  git checkout main
  git checkout -b audit/phase-6-operations
  git checkout main
  git checkout -b audit/phase-7-cross-cutting
  git checkout main
  ```

- [ ] **Step 0.3: Verify npm build works before starting**
  ```bash
  npm run build 2>&1 | tail -5
  ```
  Expected: `Successfully compiled: X modules` or similar. If fails, fix first.

---

### Task 1: Phase 0 — Infrastructure (8 sub-agents)

**Objective:** Audit & fix cross-cutting infrastructure services, guards, filters, middleware.

**Batch B0-A (2 parallel):**

- [ ] **Step 1.1: Spawn sub-agent — PrismaService**
  **Files:** `apps/backend/src/prisma/prisma.service.ts`, `apps/backend/src/prisma/prisma.module.ts`
  **Check:**
  - Connection pooling config (do we use `@prisma/adapter-pg` adapter-pg correctly?)
  - `PrismaClient` lifecycle — singleton, onModuleInit, onModuleDestroy
  - Query logging / middleware setup
  - Error propagation — are Prisma errors re-thrown or caught?
  - Fastify compatibility — no Express references
  **Fix:** Any issues found. Verify with `npx tsc --noEmit`.

- [ ] **Step 1.2: Spawn sub-agent — GlobalExceptionFilter**
  **Files:** `apps/backend/src/common/filters/global-exception.filter.ts`
  **Check:**
  - All Prisma error codes mapped (P2000-P2025): P2000 (value too long), P2002 (unique constraint), P2003 (foreign key), P2025 (not found)
  - Response shape consistent for Fastify vs Express
  - HttpException caught and formatted
  - Unknown errors → 500 with correlation ID
  - Unhandled promise rejections handled?
  **Fix:** Add missing Prisma error mappings. Verify with `npx tsc --noEmit`.

- [ ] **Step 1.3: Verify batch B0-A**
  ```bash
  npx tsc --noEmit
  npm run build
  ```

**Batch B0-B (4 parallel):**

- [ ] **Step 1.4: Spawn sub-agent — JwtAuthGuard**
  **Files:** `apps/backend/src/common/guards/*.ts` (JwtAuthGuard, RolesGuard)
  **Check:**
  - Token validation error response (401 shape)
  - Role checking logic — no logical conflict
  - Fastify compatibility (execution context)
  - Missing `@SetMetadata` / reflection patterns correct for NestJS 11
  **Fix:** Issues found. Verify build.

- [ ] **Step 1.5: Spawn sub-agent — LicenseGuard**
  **Files:** `apps/backend/src/common/guards/license.guard.ts`, `apps/backend/src/license/`
  **Check:**
  - License validation caching
  - Error response on expired/missing license
  - No Express references
  **Fix:** Issues found. Verify build.

- [ ] **Step 1.6: Spawn sub-agent — FeatureGuard**
  **Files:** `apps/backend/src/common/guards/feature.guard.ts`, `packages/feature-flags/`
  **Check:**
  - Feature flag resolution error handling
  - Missing flag fallback behavior
  - Prisma/cache query optimization for flag lookup
  **Fix:** Issues found. Verify build.

- [ ] **Step 1.7: Spawn sub-agent — ThrottlerGuard**
  **Files:** Check `app.module.ts` for ThrottlerModule config, `apps/backend/src/common/guards/throttler*.ts`
  **Check:**
  - ThrottlerGuard registered globally
  - Rate limit error response format
  - Fastify store compatibility (using `@nestjs/throttler-storage-redis` or memory?)
  - Correct limits per endpoint sensitivity
  **Fix:** Issues found. Verify build.

- [ ] **Step 1.8: Verify batch B0-B**
  ```bash
  npx tsc --noEmit
  npm run build
  ```

**Batch B0-C (4 parallel):**

- [ ] **Step 1.9: Spawn sub-agent — IpBlockMiddleware**
  **Files:** `apps/backend/src/common/middleware/ip-block.middleware.ts`
  **Check:**
  - Fastify middleware API (`app.use` vs Fastify `addHook`)
  - Block check query optimization (cached?)
  - Database query for IP/phone block lookup — missing index?
  - Error handling on DB failure (don't block all traffic if DB is down)
  **Fix:** Issues found. Verify build.

- [ ] **Step 1.10: Spawn sub-agent — CorrelationIdMiddleware**
  **Files:** `apps/backend/src/common/middleware/correlation-id.middleware.ts`
  **Check:**
  - Fastify `onRequest` hook vs Express middleware
  - Correlation ID generation and propagation
  - Header handling (Fastify `req.headers` vs Express `req.get`)
  **Fix:** Issues found. Verify build.

- [ ] **Step 1.11: Spawn sub-agent — CacheService**
  **Files:** `apps/backend/src/cache/`
  **Check:**
  - Cache implementation — in-memory vs Redis?
  - TTL strategy — no unbounded growth
  - Error handling on cache miss/expiry
  - Fallback when cache unavailable
  - Fastify compatibility
  **Fix:** Issues found. Verify build.

- [ ] **Step 1.12: Spawn sub-agent — EmailService**
  **Files:** `apps/backend/src/email/`, `apps/backend/src/queue/email-queue.*`
  **Check:**
  - Email sending error handling (retry logic?)
  - Queue implementation — bull/bullmq? Proper job handling?
  - Template rendering error handling
  - Prisma query optimization for email log/queue
  **Fix:** Issues found. Verify build.

- [ ] **Step 1.13: Verify batch B0-C**
  ```bash
  npx tsc --noEmit
  npm run build
  ```

**Batch B0-D (1 sub-agent):**

- [ ] **Step 1.14: Spawn sub-agent — StorageService**
  **Files:** `apps/backend/src/storage/`
  **Check:**
  - File upload/download error handling
  - Disk space check? Streaming?
  - File path traversal protection
  - Fastify `reply.sendFile` vs Express `res.sendFile`
  - Media cleanup query optimization
  **Fix:** Issues found. Verify build.

- [ ] **Step 1.15: Verify batch B0-D** and merge phase
  ```bash
  npx tsc --noEmit && npm run build && npm run test 2>&1 | tail -10
  git add -A && git commit -m "audit(infrastructure): phase 0 complete"
  git checkout main && git merge audit/phase-0-infrastructure --no-ff
  ```

---

### Task 2: Phase 1 — Core Auth & Security (6 sub-agents)

**Batch B1-A (3 parallel):**

- [ ] **Step 2.1: Spawn sub-agent — auth module**
  **Files:** `apps/backend/src/auth/*.controller.ts`, `*.service.ts`
  **Check:**
  - Each endpoint (register, login, refresh, logout, me, change-password, forgot-password, verify-otp, reset-password, verify-email):
    - Try/catch wrapping? Specific error messages (not "Something went wrong")?
    - Prisma queries — N+1? Missing `select`? Proper `where` clause?
    - Password hashing — bcrypt cost factor? Timing-safe comparison?
    - JWT signing/verification — proper secret, expiry?
    - Refresh token rotation — old token invalidated?
    - OTP verification — expiry check? Rate limiting?
    - No Express `res`/`req` — Fastify `reply`/`request`
  **Fix:** Issues found. Verify with `npx tsc --noEmit`.

- [ ] **Step 2.2: Spawn sub-agent — users module**
  **Files:** `apps/backend/src/users/*.controller.ts`, `*.service.ts`
  **Check:**
  - CRUD + bulk-delete + bulk-update + invite + settings endpoints:
    - Error handling for duplicate email, not found, validation
    - Query optimization: `findMany` without limit? N+1 on roles/permissions?
    - Role/user assignment — logical consistency
    - Invite flow — email send error handling
    - Bulk operations — transaction rollback on partial failure?
    - Fastify types
  **Fix:** Issues found. Verify build.

- [ ] **Step 2.3: Spawn sub-agent — security module**
  **Files:** `apps/backend/src/security/*.controller.ts`, `*.service.ts`
  **Check:**
  - Block-info and auto-block-stats endpoints
  - Query optimization for block info aggregation
  - Error handling on missing data
  **Fix:** Issues found. Verify build.

- [ ] **Step 2.4: Verify batch B1-A**
  ```bash
  npx tsc --noEmit && npm run build
  ```

**Batch B1-B (3 parallel):**

- [ ] **Step 2.5: Spawn sub-agent — block-settings module**
  **Files:** `apps/backend/src/block-settings/`
  **Check:**
  - GET/PUT for block settings
  - Validation on settings update
  - Prisma query optimization
  **Fix:** Issues found. Verify build.

- [ ] **Step 2.6: Spawn sub-agent — blocked-entries module**
  **Files:** `apps/backend/src/blocked-entries/`
  **Check:**
  - Block/unblock/whitelist IP and phone endpoints
  - Query optimization for block lookup (index on phone/IP columns)
  - Error handling on duplicate block
  - Bulk operations transaction safety
  **Fix:** Issues found. Verify build.

- [ ] **Step 2.7: Spawn sub-agent — settings module**
  **Files:** `apps/backend/src/settings/`
  **Check:**
  - Profile/account/appearance/notifications/display update endpoints
  - Validation error handling
  - Prisma query optimization — proper `include` of relations
  - User settings upsert pattern
  **Fix:** Issues found. Verify build.

- [ ] **Step 2.8: Verify batch B1-B & merge phase**
  ```bash
  npx tsc --noEmit && npm run build && npm run test
  git add -A && git commit -m "audit(core): phase 1 complete"
  git checkout main && git merge audit/phase-1-core --no-ff
  ```

---

### Task 3: Phase 2 — Product Catalog (8 sub-agents)

**Batch B2-A (4 parallel):**

- [ ] **Step 3.1: Spawn sub-agent — products module**
  **Files:** `apps/backend/src/products/`
  **Check:**
  - All endpoints: GET / (list with filters), GET /slug/:slug, GET /:id, POST /, PUT /:id, DELETE /:id, POST /bulk/delete, POST /bulk/update, POST /:id/variants/generate, PUT /:id/variants/:variantId
  - Error handling: product not found, slug conflict, variant generation failure, SKU duplicate
  - Query optimization: N+1 on categories/tags/variants/attributes? Pagination with `skip`/`take`? Missing `include`/`select`?
  - Bulk operations: transaction rollback? Progress tracking?
  - Variant generation: attribute combination logic — any combinatorial explosion risk?
  - Soft delete pattern — are deleted products still queried?
  - WebSocket need: real-time stock update? (likely yes for inventory)
  - Fastify types
  **Fix:** Issues found. Verify build.

- [ ] **Step 3.2: Spawn sub-agent — categories module**
  **Files:** `apps/backend/src/categories/`
  **Check:**
  - Tree/menu endpoint — recursive query optimization (CTE vs N+1)
  - Self-referencing relation (parentId) — cycle detection?
  - Error handling: circular parent assignment, not found
  **Fix:** Issues found. Verify build.

- [ ] **Step 3.3: Spawn sub-agent — brands module**
  **Files:** `apps/backend/src/brands/`
  **Check:**
  - CRUD error handling
  - Slug generation — duplicate handling
  - Query optimization: brand with product count?
  **Fix:** Issues found. Verify build.

- [ ] **Step 3.4: Spawn sub-agent — attributes module**
  **Files:** `apps/backend/src/attributes/`
  **Check:**
  - Attribute CRUD + value management
  - Error handling: attribute value duplicate within attribute
  - Query optimization for attribute + values join
  **Fix:** Issues found. Verify build.

- [ ] **Step 3.5: Verify batch B2-A**
  ```bash
  npx tsc --noEmit && npm run build
  ```

**Batch B2-B (3 parallel):**

- [ ] **Step 3.6: Spawn sub-agent — tags module**
  **Files:** `apps/backend/src/tags/`
  **Check:**
  - CRUD + public + bulk-delete + merge endpoints
  - Merge operation: transaction integrity (reassign all product-tag relations)
  - Query optimization: tag count, product association
  **Fix:** Issues found. Verify build.

- [ ] **Step 3.7: Spawn sub-agent — size-charts module**
  **Files:** `apps/backend/src/size-charts/`
  **Check:**
  - CRUD + by-product endpoint
  - Error handling: missing size chart for product
  - Query optimization: by-product slug lookup
  **Fix:** Issues found. Verify build.

- [ ] **Step 3.8: Spawn sub-agent — combos module**
  **Files:** `apps/backend/src/combos/`
  **Check:**
  - CRUD endpoints
  - Combo item pricing logic — correct total calculation?
  - Stock validation — combo items availability check
  - Error handling: combo item not found, invalid pricing
  - Query optimization: N+1 on combo items
  **Fix:** Issues found. Verify build.

- [ ] **Step 3.9: Verify batch B2-B**
  ```bash
  npx tsc --noEmit && npm run build
  ```

**Batch B2-C (2 parallel):**

- [ ] **Step 3.10: Spawn sub-agent — reviews module**
  **Files:** `apps/backend/src/reviews/`
  **Check:**
  - Endpoints: GET /product/:slug, POST /, GET /latest, GET /, PATCH /:id/approve, DELETE /:id
  - Error handling: duplicate review, product not found
  - Query optimization: review with user + product, pagination, N+1
  - Approval workflow logic
  - WebSocket need: real-time review notification to admin?
  **Fix:** Issues found. Verify build.

- [ ] **Step 3.11: Verify batch B2-C & merge phase**
  ```bash
  npx tsc --noEmit && npm run build && npm run test
  git add -A && git commit -m "audit(catalog): phase 2 complete"
  git checkout main && git merge audit/phase-2-catalog --no-ff
  ```

---

### Task 4: Phase 3 — Order Pipeline (10 sub-agents)

**Batch B3-A (2 parallel):**

- [ ] **Step 4.1: Spawn sub-agent — orders (main controller)**
  **Files:** `apps/backend/src/orders/orders.controller.ts`, `orders.service.ts`, related files
  **Check:**
  - All order endpoints: list, my-orders, create, get-by-id, cancel, items, notes, bulk operations, status transitions
  - Error handling: order not found, status transition invalid, payment failure, insufficient stock
  - Query optimization: order with items + payments + shipments (eager loading vs lazy), N+1
  - Status transition state machine — validate allowed transitions
  - Stock deduction on order create — concurrency safety (use Prisma transaction with serializable?)
  - Bulk operations: transaction rollback on any failure
  - SSE endpoint: `GET /orders/stream/updates` — verify proper Observable pattern
  - WebSocket need: SSE is fine for one-way, but bidirectional (admin cancel) might need WebSocket
  - Fastify types: `@Res()`, `@Req()` decorators using Fastify
  - View token rotation — security review
  **Fix:** Issues found. Verify build.

- [ ] **Step 4.2: Spawn sub-agent — order-status module**
  **Files:** `apps/backend/src/orders/order-status.controller.ts`, `order-status.service.ts`
  **Check:**
  - GET / and PUT /:id endpoints
  - Status update validation
  - Error handling: invalid status transition
  **Fix:** Issues found. Verify build.

- [ ] **Step 4.3: Verify batch B3-A**
  ```bash
  npx tsc --noEmit && npm run build
  ```

**Batch B3-B (3 parallel):**

- [ ] **Step 4.4: Spawn sub-agent — payments module**
  **Files:** `apps/backend/src/payments/`
  **Check:**
  - GET /, POST /:orderId, PUT /:id/verify endpoints
  - Payment verification logic — double payment prevention?
  - Error handling: payment gateway failure, invalid amount, already paid order
  - Query optimization: payment lookup by order
  - Prisma transaction: payment + order status update atomicity
  - Fastify types
  **Fix:** Issues found. Verify build.

- [ ] **Step 4.5: Spawn sub-agent — checkout-leads module**
  **Files:** `apps/backend/src/checkout-leads/`
  **Check:**
  - Leads CRUD + summary + status/assign/convert/bulk operations
  - Convert-to-order logic — data integrity
  - Error handling: missing lead, duplicate conversion
  - Query optimization: summary aggregation (count by status)
  - Bulk assign/status: transactional safety
  **Fix:** Issues found. Verify build.

- [ ] **Step 4.6: Spawn sub-agent — addresses module**
  **Files:** `apps/backend/src/addresses/`
  **Check:**
  - CRUD + set-default endpoint
  - Error handling: address not found, user mismatch
  - Default address logic — only one default per user
  - Query optimization: user addresses with default flag
  **Fix:** Issues found. Verify build.

- [ ] **Step 4.7: Verify batch B3-B**
  ```bash
  npx tsc --noEmit && npm run build
  ```

**Batch B3-C (4 parallel):**

- [ ] **Step 4.8: Spawn sub-agent — coupons module**
  **Files:** `apps/backend/src/coupons/`
  **Check:**
  - CRUD + validate + usage endpoints
  - Coupon validation logic: expiry, usage limit, min order amount, user-specific
  - Error handling: expired coupon, usage exhausted, invalid code
  - Query optimization: coupon lookup by code (indexed?), usage count query
  - Race condition: concurrent coupon usage (use Prisma transaction + `$transaction`)
  **Fix:** Issues found. Verify build.

- [ ] **Step 4.9: Spawn sub-agent — refunds module**
  **Files:** `apps/backend/src/refunds/`
  **Check:**
  - GET /, GET /:id, POST /, PUT /:id/status endpoints
  - Refund logic: amount validation (can't exceed paid), status workflow
  - Error handling: already refunded, payment gateway refund failure
  - Prisma transaction: refund + order status update
  **Fix:** Issues found. Verify build.

- [ ] **Step 4.10: Spawn sub-agent — shipment module**
  **Files:** `apps/backend/src/shipment/`
  **Check:**
  - GET /, GET /order/:orderId, PUT /order/:orderId
  - Error handling: already shipped, courier assignment
  - Query optimization: shipment tracking by order
  **Fix:** Issues found. Verify build.

- [ ] **Step 4.11: Spawn sub-agent — shipping module**
  **Files:** `apps/backend/src/shipping/`
  **Check:**
  - Options + zones CRUD
  - Shipping rate calculation logic — correct weight/zone matching?
  - Error handling: no matching zone, invalid rate config
  **Fix:** Issues found. Verify build.

- [ ] **Step 4.12: Verify batch B3-C**
  ```bash
  npx tsc --noEmit && npm run build
  ```

**Batch B3-D (3 parallel):**

- [ ] **Step 4.13: Spawn sub-agent — gateways module**
  **Files:** `apps/backend/src/gateways/`
  **Check:**
  - Gateway config CRUD + options + product/combo overrides
  - Error handling: invalid gateway code, missing config
  - Query optimization: gateway lookup, override resolution chain (product → combo → default)
  - Product/combo override pattern — correct override priority
  **Fix:** Issues found. Verify build.

- [ ] **Step 4.14: Spawn sub-agent — bkash-pgw module**
  **Files:** `apps/backend/src/gateways/bkash-pgw.controller.ts`, `bkash-pgw.service.ts`
  **Check:**
  - POST /create, GET /callback endpoints
  - bKash API integration error handling — timeout, invalid token, payment failure
  - Callback verification — security (HMAC validation?)
  - Idempotency — duplicate callback handling
  - Query optimization
  **Fix:** Issues found. Verify build.

- [ ] **Step 4.15: Verify batch B3-D & merge phase**
  ```bash
  npx tsc --noEmit && npm run build && npm run test
  git add -A && git commit -m "audit(orders): phase 3 complete"
  git checkout main && git merge audit/phase-3-orders --no-ff
  ```

---

### Task 5: Phase 4 — Finance & HR (8 sub-agents)

**Batch B4-A (4 parallel):**

- [ ] **Step 5.1: Spawn sub-agent — accounting module**
  **Files:** `apps/backend/src/accounting/`
  **Check:**
  - Double-entry journal entry logic — debit/credit balance validation
  - Error handling: unbalanced entry, invalid account, period closed
  - Query optimization: ledger report aggregation
  - Prisma transaction: multi-line journal entry atomicity
  **Fix:** Issues found. Verify build.

- [ ] **Step 5.2: Spawn sub-agent — accounts module**
  **Files:** `apps/backend/src/accounts/`
  **Check:**
  - Chart of accounts CRUD + tree endpoint
  - Tree query optimization (recursive CTE vs N+1)
  - Error handling: account with children (prevent delete), duplicate code
  - Financial period integration
  **Fix:** Issues found. Verify build.

- [ ] **Step 5.3: Spawn sub-agent — expenses module**
  **Files:** `apps/backend/src/expenses/`
  **Check:**
  - CRUD + summary endpoints
  - Expense -> accounting integration (journal entry creation)
  - Error handling: category not found, invalid amount
  - Query optimization: summary by category aggregation
  **Fix:** Issues found. Verify build.

- [ ] **Step 5.4: Spawn sub-agent — expense-categories module**
  **Files:** `apps/backend/src/expense-categories/`
  **Check:**
  - CRUD endpoints
  - Error handling: delete category with expenses (cascade or restrict?)
  **Fix:** Issues found. Verify build.

- [ ] **Step 5.5: Verify batch B4-A**
  ```bash
  npx tsc --noEmit && npm run build
  ```

**Batch B4-B (3 parallel):**

- [ ] **Step 5.6: Spawn sub-agent — financial-periods module**
  **Files:** `apps/backend/src/financial-periods/`
  **Check:**
  - CRUD + close/open endpoints
  - Closing logic — no new entries allowed in closed period
  - Error handling: overlapping periods, close with unposted entries
  **Fix:** Issues found. Verify build.

- [ ] **Step 5.7: Spawn sub-agent — opening-balances module**
  **Files:** `apps/backend/src/opening-balances/`
  **Check:**
  - POST /, GET /:periodId endpoints
  - Validation: balance must match period, account exists
  - Query optimization: balances by period
  **Fix:** Issues found. Verify build.

- [ ] **Step 5.8: Spawn sub-agent — payroll module**
  **Files:** `apps/backend/src/payroll/`
  **Check:**
  - Salary structure CRUD + payslip generate/list/approve
  - Payslip generation logic — correct calculation of allowances/deductions
  - Error handling: employee not found, duplicate payslip for period
  - Prisma transaction: payslip generation atomicity
  **Fix:** Issues found. Verify build.

- [ ] **Step 5.9: Verify batch B4-B**
  ```bash
  npx tsc --noEmit && npm run build
  ```

**Batch B4-C (3 parallel):**

- [ ] **Step 5.10: Spawn sub-agent — purchases module**
  **Files:** `apps/backend/src/purchases/`
  **Check:**
  - Purchase order CRUD + GRN (goods receipt note) endpoints
  - GRN logic — stock increase on receipt, costing lot creation
  - Error handling: purchase not found, over-receipt
  - Query optimization: purchase with items + GRNs
  - Prisma transaction: GRN + stock update + costing atomicity
  **Fix:** Issues found. Verify build.

- [ ] **Step 5.11: Spawn sub-agent — suppliers module**
  **Files:** `apps/backend/src/suppliers/`
  **Check:**
  - CRUD + payments endpoints
  - Supplier payment logic — invoice matching
  - Error handling: overpayment, supplier not found
  - Query optimization: payments by supplier
  **Fix:** Issues found. Verify build.

- [ ] **Step 5.12: Spawn sub-agent — employees module**
  **Files:** `apps/backend/src/employees/`
  **Check:**
  - CRUD endpoints
  - Department/designation assignment
  - Error handling: duplicate employee code
  **Fix:** Issues found. Verify build.

- [ ] **Step 5.13: Verify batch B4-C & merge phase**
  ```bash
  npx tsc --noEmit && npm run build && npm run test
  git add -A && git commit -m "audit(finance): phase 4 complete"
  git checkout main && git merge audit/phase-4-finance --no-ff
  ```

---

### Task 6: Phase 5 — Marketing & Content (6 sub-agents)

**Batch B5-A (3 parallel):**

- [ ] **Step 6.1: Spawn sub-agent — campaigns module**
  **Files:** `apps/backend/src/campaigns/`
  **Check:**
  - Campaign CRUD + templates + send/test endpoints
  - Email campaign sending logic — queue integration
  - Template rendering — error handling
  - Query optimization: campaign analytics aggregation
  **Fix:** Issues found. Verify build.

- [ ] **Step 6.2: Spawn sub-agent — cms-pages module**
  **Files:** `apps/backend/src/cms-pages/`
  **Check:**
  - Page CRUD + footer + slug lookup endpoints
  - Error handling: slug conflict, page not found
  - Slug lookup optimization (unique index on slug?)
  **Fix:** Issues found. Verify build.

- [ ] **Step 6.3: Spawn sub-agent — landing-pages module**
  **Files:** `apps/backend/src/landing-pages/`
  **Check:**
  - CRUD + published/preview + publish/unpublish endpoints
  - Publish workflow — versioning?
  - Error handling: slug conflict, invalid template
  **Fix:** Issues found. Verify build.

- [ ] **Step 6.4: Verify batch B5-A**
  ```bash
  npx tsc --noEmit && npm run build
  ```

**Batch B5-B (3 parallel):**

- [ ] **Step 6.5: Spawn sub-agent — referrals module**
  **Files:** `apps/backend/src/referrals/`
  **Check:**
  - My referrals + claim + leads endpoints
  - Referral reward logic — correct calculation
  - Error handling: duplicate claim, invalid referral code
  - Query optimization: referral tree/chain query
  **Fix:** Issues found. Verify build.

- [ ] **Step 6.6: Spawn sub-agent — notifications module**
  **Files:** `apps/backend/src/notifications/`
  **Check:**
  - Settings CRUD + send + logs endpoints
  - Notification sending logic — push/email/SMS?
  - Error handling: invalid channel, sending failure
  - Query optimization: log pagination
  **Fix:** Issues found. Verify build.

- [ ] **Step 6.7: Spawn sub-agent — tracking module**
  **Files:** `apps/backend/src/tracking/`
  **Check:**
  - POST /events, POST /context endpoints
  - Event validation — prevent malformed data
  - Error handling: tracking service unavailable
  **Fix:** Issues found. Verify build.

- [ ] **Step 6.8: Verify batch B5-B & merge phase**
  ```bash
  npx tsc --noEmit && npm run build && npm run test
  git add -A && git commit -m "audit(marketing): phase 5 complete"
  git checkout main && git merge audit/phase-5-marketing --no-ff
  ```

---

### Task 7: Phase 6 — Operations (15 sub-agents)

**Batch B6-A (4 parallel):**

- [ ] **Step 7.1: Spawn sub-agent — courier-manager module**
  **Files:** `apps/backend/src/courier-manager/`
  **Check:**
  - Credentials/cities/zones + dispatch + balance + returns + payments + tracking endpoints
  - Courier API integration error handling: timeout, invalid response, auth failure
  - Webhook secret management — secure generation
  - Bulk dispatch — transaction safety, partial failure handling
  - Query optimization: dispatch log pagination, city/zone caching
  **Fix:** Issues found. Verify build.

- [ ] **Step 7.2: Spawn sub-agent — courier-webhook module**
  **Files:** `apps/backend/src/courier-manager/courier-webhook.controller.ts`, `courier-webhook.service.ts`
  **Check:**
  - Webhook receivers for steadfast, pathao, redx, carrybee
  - Signature verification — security (HMAC validation)
  - Idempotent processing — duplicate webhook prevention
  - Error handling: invalid payload, order not found
  - Prisma transaction: webhook + order status update atomicity
  **Fix:** Issues found. Verify build.

- [ ] **Step 7.3: Spawn sub-agent — inventory module**
  **Files:** `apps/backend/src/inventory/`
  **Check:**
  - Low-stock + logs + stock-overview + adjust + bulk-adjust + valuation + transfer endpoints
  - Stock adjustment logic — correct quantity delta, reason logging
  - Error handling: insufficient stock for transfer, negative stock
  - Query optimization: low-stock threshold query (missing index on stock column?), log pagination
  - Concurrency: stock update with `$transaction` + serializable isolation
  - Valuation: costing method (FIFO/weighted average) correct?
  **Fix:** Issues found. Verify build.

- [ ] **Step 7.4: Spawn sub-agent — media module**
  **Files:** `apps/backend/src/media/`
  **Check:**
  - Media CRUD + attachments + bulk-delete + migrate-orphans
  - File deletion from storage — error handling
  - Polymorphic attachment query optimization
  - Orphan migration — batch processing with progress
  **Fix:** Issues found. Verify build.

- [ ] **Step 7.5: Verify batch B6-A**
  ```bash
  npx tsc --noEmit && npm run build
  ```

**Batch B6-B (3 parallel):**

- [ ] **Step 7.6: Spawn sub-agent — upload module**
  **Files:** `apps/backend/src/upload/`
  **Check:**
  - POST /image, POST /images, POST /from-url endpoints
  - File type validation — security (no arbitrary file upload)
  - File size limit — check Fastify `bodyLimit`
  - Error handling: invalid file type, upload failure, URL fetch failure
  - From-url: timeout, SSRF prevention?
  **Fix:** Issues found. Verify build.

- [ ] **Step 7.7: Spawn sub-agent — import module**
  **Files:** `apps/backend/src/import/`
  **Check:**
  - GET /status/:jobId, POST /products, POST /orders endpoints
  - Import job processing — queue/bull integration?
  - Error handling: malformed file, partial import, job timeout
  - Query optimization: progress tracking
  **Fix:** Issues found. Verify build.

- [ ] **Step 7.8: Spawn sub-agent — search module**
  **Files:** `apps/backend/src/search/`
  **Check:**
  - GET / admin search endpoint
  - Search query optimization — full-text search? Missing index?
  - Error handling: search service unavailable, invalid query
  **Fix:** Issues found. Verify build.

- [ ] **Step 7.9: Verify batch B6-B**
  ```bash
  npx tsc --noEmit && npm run build
  ```

**Batch B6-C (3 parallel):**

- [ ] **Step 7.10: Spawn sub-agent — delivery-areas module**
  **Files:** `apps/backend/src/delivery-areas/`
  **Check:**
  - GET /districts, GET /districts/:district/thanas endpoints
  - Data caching — static data shouldn't hit DB every time
  - Error handling: district not found
  **Fix:** Issues found. Verify build.

- [ ] **Step 7.11: Spawn sub-agent — customers module**
  **Files:** `apps/backend/src/customers/`
  **Check:**
  - List + order-summary + get + block/unblock endpoints
  - Order summary aggregation query optimization
  - Error handling: customer not found, block/unblock logic
  **Fix:** Issues found. Verify build.

- [ ] **Step 7.12: Spawn sub-agent — tasks module**
  **Files:** `apps/backend/src/tasks/`
  **Check:**
  - CRUD + bulk-delete + bulk-update endpoints
  - Task assignment logic — user exists validation
  - Error handling: task not found, invalid assignee
  - Query optimization: task filtering with pagination
  **Fix:** Issues found. Verify build.

- [ ] **Step 7.13: Spawn sub-agent — courier (standalone) module**
  **Files:** `apps/backend/src/courier/`
  **Check:**
  - GET /search, GET /summary endpoints
  - Courier rate search — query optimization (cache rates?)
  - Error handling: no matching courier, API unavailable
  **Fix:** Issues found. Verify build.

- [ ] **Step 7.14: Spawn sub-agent — dashboard module**
  **Files:** `apps/backend/src/dashboard/`
  **Check:**
  - All stats/analytics/kpi endpoints
  - Query optimization: many aggregate queries on large tables — missing indexes? Time range filtering indexed?
  - Error handling: no data period
  **Fix:** Issues found. Verify build.

- [ ] **Step 7.15: Verify batch B6-C**
  ```bash
  npx tsc --noEmit && npm run build
  ```

**Batch B6-D (4 parallel):**

- [ ] **Step 7.16: Spawn sub-agent — images module**
  **Files:** `apps/backend/src/images/`
  **Check:**
  - GET /resize endpoint
  - Image processing error handling
  - Query optimization
  **Fix:** Issues found. Verify build.

- [ ] **Step 7.17: Spawn sub-agent — license module**
  **Files:** `apps/backend/src/license/`
  **Check:**
  - POST /activate, POST /sync, GET /status
  - License validation logic
  - Error handling: invalid/expired license, activation limit
  - Query optimization
  **Fix:** Issues found. Verify build.

- [ ] **Step 7.18: Spawn sub-agent — health module**
  **Files:** `apps/backend/src/health/`
  **Check:**
  - GET /, GET /db-columns endpoints
  - Health check query optimization — lightweight ping
  - DB columns query — don't expose sensitive schema info
  **Fix:** Issues found. Verify build.

- [ ] **Step 7.19: Spawn sub-agent — system-settings module**
  **Files:** `apps/backend/src/system-settings/`
  **Check:**
  - All settings endpoints: branding, storefront, storage, smtp
  - Key-value storage pattern — caching strategy
  - SMTP test — error handling on test send failure
  - Error handling: invalid key, validation
  **Fix:** Issues found. Verify build.

- [ ] **Step 7.20: Verify batch B6-D & merge phase**
  ```bash
  npx tsc --noEmit && npm run build && npm run test
  git add -A && git commit -m "audit(operations): phase 6 complete"
  git checkout main && git merge audit/phase-6-operations --no-ff
  ```

---

### Task 8: Phase 7 — Cross-Cutting Audit (4 sub-agents)

**Batch B7-A (4 parallel):**

- [ ] **Step 8.1: Spawn sub-agent — WebSocket Audit**
  **Files:** All backend controller/service files
  **Check:**
  - Scan all modules for:
    1. Polling patterns (e.g., `setInterval` fetching from API) — should be WebSocket/SSE
    2. SSE implementation in orders — verify correct NestJS `@Sse()` usage, proper cleanup on disconnect
    3. Modules that NEED real-time: orders (existing SSE), notifications (need push), inventory (stock alerts), dashboard (live stats)
    4. Missing WebSocket Gateway — any module that would benefit from bidirectional communication?
  **Recommendations:** Document modules needing WebSocket Gateway additions (implementation scoped separately)
  **Files modified:** None (analysis-only with report)

- [ ] **Step 8.2: Spawn sub-agent — Fastify Conversion Audit**
  **Files:** All backend source files
  **Check:**
  - Search for Express-isms:
    - `@Res()` / `@Req()` without Fastify type params
    - `express` imports in any file
    - `@nestjs/platform-express` in package.json / module imports
    - `response.status().json()` pattern (should be `reply.send()`)
    - `request.query` / `request.params` without Fastify types
    - Express middleware patterns that aren't Fastify-compatible
  **Fix:** Convert all found Express-isms to Fastify-native equivalents
  **Verify:** `npx tsc --noEmit`

- [ ] **Step 8.3: Spawn sub-agent — Prisma Schema Gap Audit**
  **Files:** `apps/backend/prisma/schema.prisma`, all service files
  **Check:**
  - Cross-reference every Prisma query in services against schema:
    - Fields queried that don't exist in schema
    - Relations accessed without `include`/`select`
    - Missing indexes on frequently queried columns (foreign keys, status, dates)
    - Missing `@@unique` or `@unique` constraints
    - Enum values that don't match usage
    - Generated migration status: `npx prisma migrate status`
  **Fix:** Schema additions (indexes, missing constraints)
  **Post-fix:** `npx prisma migrate dev --name audit-gap-fix`

- [ ] **Step 8.4: Spawn sub-agent — Error Consistency Audit**
  **Files:** All controller files
  **Check:**
  - Consistent error response shape across all APIs
  - All `HttpException` / `NotFoundException` etc use same format
  - NestJS `ValidationPipe` response format consistent
  - Fastify vs Express response differences in error format
  - Missing `catch` blocks that would crash the process
  - Any endpoint returning raw Prisma errors to client
  **Fix:** Normalize error responses, add missing error handlers
  **Verify:** `npx tsc --noEmit && npm run build`

- [ ] **Step 8.5: Verify batch B7-A & merge phase**
  ```bash
  npx tsc --noEmit && npm run build && npm run test
  npx prisma validate
  npx prisma migrate status
  git add -A && git commit -m "audit(cross-cutting): phase 7 complete"
  git checkout main && git merge audit/phase-7-cross-cutting --no-ff
  ```

---

### Task 9: Final Verification

- [ ] **Step 9.1: Full build & test suite**
  ```bash
  npm run build
  npm run test
  npx prisma validate
  npx tsc --noEmit
  ```

- [ ] **Step 9.2: Review all phase merge commits summary**
  ```bash
  git log --oneline main --not origin/main 2>/dev/null || git log --oneline -20
  ```

- [ ] **Step 9.3: Push to remote (if configured)**
  ```bash
  git push origin main
  ```

---

## Sub-Agent Prompt Template

Use this template when spawning each sub-agent (replace `<MODULE_NAME>` and list specific files):

```
You are auditing the <MODULE_NAME> module in the EcoMate NestJS backend.

FILES TO AUDIT:
- apps/backend/src/<module>/*.controller.ts
- apps/backend/src/<module>/*.service.ts
- apps/backend/src/<module>/*.module.ts
- apps/backend/src/<module>/*.dto.ts (if any)

CONTEXT:
- NestJS 11 + Fastify (NOT Express)
- Prisma with PostgreSQL
- GlobalExceptionFilter already handles Prisma errors
- JwtAuthGuard, RolesGuard applied globally

CHECKLIST (audit AND fix):

1. ERROR HANDLING
   - Every endpoint wrapped in try/catch?
   - Specific error messages (not generic)?
   - Correct HTTP status codes?
   - Prisma errors handled or re-thrown?
   - Validation errors caught & formatted?

2. QUERY OPTIMIZATION
   - Any N+1 queries (e.g., loop with findUnique inside)?
   - findMany() without where clause or limit?
   - Missing Prisma .select() (fetching unused fields)?
   - Missing database indexes on queried columns?
   - Pagination implemented for list endpoints?

3. BUGS & LOGIC
   - Null/undefined checks before property access?
   - Race conditions in concurrent operations?
   - Incorrect comparisons or off-by-one?
   - Edge cases: empty lists, missing relations, zero values?
   - Logical conflicts: contradictory validation rules?

4. PRISMA SCHEMA GAPS
   - Any field/relation used in service but missing in schema?
   - Any query referencing non-existent model/field?
   - Missing indexes on FK/status/date columns?

5. WEBSOCKET NEED
   - Does this module push real-time updates?
   - Current polling usage that should be SSE/WebSocket?
   - SSE implemented correctly (@Sse() with Observable)?

6. FASTIFY COMPAT
   - No Express Response/Request types
   - Using @Res() with FastifyReply, @Req() with FastifyRequest
   - No express-specific imports

For each issue found:
1. Fix it immediately in the file
2. Run `npx tsc --noEmit` to verify
3. Report: issue description, fix applied, file changed

FINAL REPORT FORMAT:
{
  "module": "<MODULE_NAME>",
  "error_handling": {"status": "passed|fixed|na", "issues_found": N, "details": [...]},
  "query_optimization": {"status": "passed|fixed|na", "issues_found": N, "details": [...]},
  "bugs": {"status": "passed|fixed|na", "issues_found": N, "details": [...]},
  "prisma_gaps": {"status": "passed|fixed|na", "issues_found": N, "details": [...]},
  "websocket": {"status": "passed|fixed|na", "issues_found": N, "details": [...]},
  "fastify": {"status": "passed|fixed|na", "issues_found": N, "details": [...]},
  "files_modified": [...],
  "build_verified": true|false
}
```
