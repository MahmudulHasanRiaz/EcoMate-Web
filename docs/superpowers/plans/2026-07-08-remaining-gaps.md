# Remaining Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Close 6 remaining gaps: error messages, order state machine, cost type badges, downgrade flow, FeatureFlagsService rebuild, edge cases + keep "*" wildcard

**Architecture:** 6 independent tasks across backend (NestJS/Prisma) and frontend (React/TanStack Router). Tasks touch different files so they can run in parallel.

**Tech Stack:** NestJS, Prisma, React, TanStack Router, Recharts

---

### Task A: 72 English-friendly error messages on /license-denied

**Files:**
- Modify: `apps/admin/src/features/errors/license-denied.tsx`
- Read: `packages/shared-types/src/license-types.ts` (for FEATURES keys)

Replace generic message with user-friendly English messages per feature. Map is inline in the component. If feature key not in map, fall back to generic.

```
{feature: 'admin_brands'} → "Brand management is not included in your current plan."
{feature: 'storefront_wishlist'} → "The wishlist feature is not available on your current plan."
```

Also add "*" wildcard support: if the license has "*", hasFeature returns true always (already in license-store.ts). Verify requireFeature.ts handles this.

---

### Task B: Order state transition guards + per-state side effects

**Files:**
- Modify: `apps/backend/src/orders/orders.service.ts`
- Read: `apps/backend/src/orders/orders.module.ts`
- Test: `apps/backend/src/orders/__tests__/orders.service.spec.ts`

Add a `transitionOrderStatus(orderId, newStatus, performedBy)` method that:
1. Reads current order with current status
2. Validates transition is allowed per state machine rules
3. Executes per-state side effects (stock deduction on confirm, stock restore on cancel, etc.)

Valid transitions (from plan Section 11.3):
- Pending → Payment Pending, Hold, Confirmed, Cancelled
- Confirmed → Packed, Packing Hold, Cancelled
- Packed → Shipping, Packing Hold
- Shipping → Delivered, Partial
- Delivered → Return Pending
- Partial → Return Pending
- Return Pending → Returned, Damaged
- Cancelled → Confirmed (reactivation)
- Damaged = final state

Side effects per state (from plan Section 11.2 table):
- Confirmed: ORDER_DEDUCTION for MANAGED_STOCK, cost snapshot
- Cancelled: CANCEL_RELEASE stock restore, duplicate restock prevention
- Returned: RETURN stock restore
- Delivered: auto-confirm payment, accounting entries (stub)
- Others: no stock impact

---

### Task C: Cost Type badges in reports

**Files:**
- Modify: `apps/admin/src/features/analytics/components/SalesKpiCards.tsx`
- Read: `apps/admin/src/features/dashboard/` (for existing report patterns)

Add "Estimated" / "Actual" label next to profit-related KPIs in SalesKpiCards. If `admin_accounting` feature is active, show "Actual Profit". Otherwise show "Estimated Profit".

---

### Task D: FeatureFlagsService dist rebuild + "*" wildcard integration

**Files:**
- Build: `packages/feature-flags/` (rebuild dist)
- Modify: `packages/feature-flags/src/feature-flags.service.ts` (add "*" wildcard support)

1. Add wildcard detection: if features array includes "*", canUse() returns true for all keys
2. Rebuild dist: run tsc in packages/feature-flags
3. Verify backend typecheck still passes

---

### Task E: Downgrade flow (Inventory → Basic)

**Files:**
- Modify: `apps/backend/src/license/license.service.ts`
- Modify: `apps/admin/src/components/layout/authenticated-layout.tsx`

When license is synced and `admin_inventory` feature is removed:
1. Backend: all INVENTORY_CONTROLLED products auto-revert to MANAGED_STOCK
2. Frontend: show toast "Inventory management has been removed from your plan. Inventory data is now read-only."
3. Frontend: hide inventory UI sections (already handled by sidebar gating)

---

### Task F: Edge case handling

**Files:**
- Modify: `apps/admin/src/components/layout/authenticated-layout.tsx`
- Modify: `apps/admin/src/stores/license-store.ts`

1. License expiry mid-session: Add periodic check (every 5 min) that re-fetches /license/status. If state changes to expired/inactive, show banner and redirect to /license/activate
2. Multiple tabs: Use localStorage + storage event to sync feature changes across tabs
3. Concurrent stock operations: Add Prisma $transaction with serializable isolation for ManagedStockLedger writes

---

### Task G: FeatureFlagsService dist rebuild

**Files:**
- Build: `packages/feature-flags/`
- Verify: `apps/backend/`

See Task D — combined into one task.
