# Phase 4: Core Extension — Implementation Plan
> **Superseded by:** `docs/2-ARCHITECTURE/ARCHITECTURE.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** Add Inventory Advance, Supplier & Purchase Management, Expense Management, SMTP/SMS Gateway + Order Notification modules.

**Architecture:** Each module = Prisma model + NestJS module (controller/service/dto) + feature-flag gated. Admin UI added via TanStack Router routes.

---

### Task 1: Supplier Management

**Files:** `apps/backend/prisma/schema.prisma` (add Supplier model), `apps/backend/src/suppliers/` (module, controller, service, DTO)

### Task 2: Purchase Management

**Files:** `apps/backend/prisma/schema.prisma` (add Purchase model), `apps/backend/src/purchases/` (module, controller, service, DTO)

### Task 3: Expense Management

**Files:** `apps/backend/prisma/schema.prisma` (add Expense model), `apps/backend/src/expenses/` (module, controller, service, DTO)

### Task 4: Inventory Enhancements

**Files:** Modify existing `apps/backend/src/inventory/` — add low-stock alerts, inventory valuation, stock transfer between stores

### Task 5: SMTP/SMS Gateway + Order Notification

**Files:** `apps/backend/prisma/schema.prisma` (add NotificationSetting model), `apps/backend/src/notifications/` (module, controller, service)
