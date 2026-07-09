# State Machine Audit Report

> **Status:** Verified against implementation  
> **Date:** 2026-07-09  
> **Method:** Full backend code audit of orders.service.ts, dispatch.service.ts, payments.service.ts, refunds.service.ts, stock.service.ts, packing.service.ts, courier-webhook.service.ts, inventory.service.ts, products.service.ts, schema.prisma (1886 lines)

---

## Architecture Rule: State Machine Independence

**Order State Machine, Payment State Machine, and Dispatch State Machine are separate systems.**

They MUST NOT be mixed. An Order Status is not a Payment Status is not a Dispatch Status. Each has its own lifecycle, its own owner, and its own persistence.

---

## 1. Order State Machine

**Owner:** Orders module (`orders.service.ts`)  
**Persistence:** `Order.statusId` → `OrderStatus` table (DB model, not enum — statuses are dynamic/seedable)  
**Validation:** Dual path:
- Legacy path (`updateStatus`, `cancelByCustomer`): validates via `OrderStatus.nextStatuses` JSON column
- New path (`transitionOrderStatus`): validates via `ORDER_TRANSITIONS` code constant

### Definitive State Table (from migration 20260704100000 + code constant)

| # | Status | Initial | Final | Allowed Next Transitions |
|---|--------|---------|-------|-------------------------|
| 1 | Pending | YES | no | Payment Pending, Hold, Confirmed, Cancelled |
| 2 | Payment Pending | no | no | Payment Verifying, Hold, Confirmed, Cancelled |
| 3 | Payment Verifying | no | no | Confirmed, Hold, Cancelled |
| 4 | Hold | no | no | Pending, Confirmed, Cancelled |
| 5 | Confirmed | no | no | Packed, Packing Hold, Cancelled |
| 6 | Packed | no | no | Shipping, Packing Hold |
| 7 | Packing Hold | no | no | Packed, Cancelled |
| 8 | Shipping | no | no | Delivered, Partial |
| 9 | Delivered | no | YES | Return Pending |
| 10 | Partial | no | no | Return Pending |
| 11 | Return Pending | no | no | Returned, Damaged |
| 12 | Returned | no | YES | Damaged |
| 13 | Damaged | no | YES | (none) |
| 14 | Cancelled | no | YES | Confirmed (reactivation) |

### Transition Matrix (code constant at orders.service.ts:29-44)

```
Pending → [Payment Pending, Hold, Confirmed, Cancelled]
Payment Pending → [Payment Verifying, Hold, Confirmed, Cancelled]
Payment Verifying → [Confirmed, Hold, Cancelled]
Hold → [Pending, Confirmed, Cancelled]
Confirmed → [Packed, Packing Hold, Cancelled]
Packed → [Shipping, Packing Hold]
Packing Hold → [Packed, Cancelled]
Shipping → [Delivered, Partial]
Delivered → [Return Pending]
Partial → [Return Pending]
Return Pending → [Returned, Damaged]
Returned → [Damaged]
Cancelled → [Confirmed]
Damaged → []
```

### Side Effects Per Transition

| To Status | Side Effect | Method | File:Line |
|-----------|------------|--------|-----------|
| Confirmed | `takeCostSnapshot()` — snapshots estimated cost per item | `handleConfirmedSideEffects` | orders:1603-1606 |
| Confirmed | `deductStockForOrder()` — decrements `managedStockQuantity`, writes ManagedStockLedger `ORDER_DEDUCTION` | `handleConfirmedSideEffects` | orders:1710-1770 |
| Cancelled | `stockService.release()` — decrements `reservedStock` | `handleCancelledSideEffects` | orders:1608-1610 |
| Cancelled | `restoreStockForCancelledOrder()` — increments `managedStockQuantity`, writes ManagedStockLedger `CANCEL_RELEASE` (idempotent) | `handleCancelledSideEffects` | orders:1772-1835 |
| Returned | `handleReturnedSideEffects()` — increments `managedStockQuantity`, writes ManagedStockLedger `RETURN` (idempotent) | transition router | orders:1612-1675 |
| Delivered | Auto-pays COD `cash` payment (UNPAID→PAID) | `updateStatus` | orders:989-1003 |
| Cancelled / Returned / Return Pending | Fires `fireRefundEvent` (tracking) | `updateStatus` | orders:1038 |

### Cancel Business Rule Verification

**Claim:** "Orders can be cancelled before they are handed over to the courier. After courier handover, it becomes a Return workflow."

**Implementation verification:**
- `Cancelled` is allowed from: Pending, Payment Pending, Payment Verifying, Hold, Confirmed, Packed, Packing Hold (per ORDER_TRANSITIONS constant)
- `Cancelled` is **NOT** allowed from: Shipping, Delivered, Partial, Return Pending, Returned, Damaged
- Shipping = courier handover milestone. This confirms the business rule: cancel before courier handover only.
- Post-courier: only `Return Pending → Returned` path exists.
- Additionally, `refunds.service.ts:113-121` blocks cancellation if active dispatches exist (HANDED_OVER, PICKED_UP, IN_TRANSIT, DELIVERED).

**Verdict:** ✅ **Business rule confirmed against implementation.**

### Anomalies

1. **Dual validation paths** — `updateStatus()` validates via DB `nextStatuses` (modifiable via admin endpoint), `transitionOrderStatus()` validates via code constant. These can diverge.
2. **Packing service bypasses validation** — writes `statusId` directly without checking `nextStatuses`.
3. **Courier webhook bypasses validation** — writes `statusId` directly for DELIVERED/PARTIAL/RETURN_PENDING.
4. **Seed/migration drift** — seed.ts has different status set than migration (Processing vs Hold, Shipped vs Shipping).

---

## 2. Payment State Machine

**Owner:** Payments module (`payments.service.ts`, `refunds.service.ts`) + Orders module (`order.paymentStatus`)  
**Persistence:** Two layers:
- `Order.paymentStatus` (enum: PaymentStatus) — computed/derived from individual payments
- `Payment.status` (enum: PaymentStatus) — individual payment record status

### PaymentStatus Enum (schema.prisma:59-70)
```
PAYMENT_PENDING, PENDING, PAID, PARTIAL_PAID, PARTIAL_REFUNDED,
UNPAID, FAILED, CANCELLED, REFUNDED, PAYMENT_VERIFYING
```

### Payment Status Transitions — Order Level

```
[Order Created]
    │
    ├──(CASH_ON_DELIVERY)──→ UNPAID ──→ PAID (on delivery)
    │
    └──(FULL/PARTIAL PAYMENT)──→ PAYMENT_PENDING
                                      │
                              (submit proof)
                                      │
                                      ▼
                               PAYMENT_VERIFYING
                                    │
                          ┌─────────┴─────────┐
                          │                   │
                    (approve)           (reject)
                          │                   │
                          ▼                   ▼
                         PAID          PAYMENT_PENDING (loop)
                          │
                    ┌─────┴─────┐
                    │           │
              (full refund)  (partial refund)
                    │           │
                    ▼           ▼
               REFUNDED    PARTIAL_REFUNDED
```

**Derived status logic** (payments.service.ts:134-159):
- Sum of all PAID payments >= order total → `PAID`
- 0 < sum < total → `PARTIAL_PAID`
- Sum = 0 → `PAYMENT_PENDING`

### Payment Record Level

```
[Payment Created]
    │
    ▼
  PENDING
    │
    │ (admin verifies)
    ▼
  PAID | FAILED | CANCELLED (admin sets any status)
```

### Refund Status (independent sub-machine)

```
pending → approved → completed → (terminal)
pending → rejected → (terminal)
```

### State vs Payment Status Mapping

| State | Scope | 
|-------|-------|
| PAYMENT_PENDING | Order created, awaiting payment |
| UNPAID | COD order, not yet paid |
| PAYMENT_VERIFYING | Customer submitted proof, awaiting admin |
| PAID | Payment completed |
| PARTIAL_PAID | Some payments received, not full amount |
| REFUNDED | Full amount refunded |
| PARTIAL_REFUNDED | Partial amount refunded |
| PENDING | Individual payment record, awaiting verification |
| FAILED | Payment failed (exists in enum, never explicitly set in code) |
| CANCELLED | Only set during WooCommerce import |

**Key finding:** `FAILED` status is never assigned by any business logic — it exists in the enum but has no code path to set it.

---

## 3. Dispatch State Machine

**Owner:** Dispatch module (`dispatch.service.ts`)  
**Persistence:** `Dispatch.status` (enum: DispatchStatus)  
**Validation:** **NONE** — any string accepted via `status as any` cast

### DispatchStatus Enum (schema.prisma:961-971)
```
DISPATCHED, HANDED_OVER, PICKED_UP, IN_TRANSIT, DELIVERED,
PARTIAL, RETURN_PENDING, RETURNED, CANCELLED
```

### Current Implementation — No Validation

**File:** `dispatch.service.ts:140-201` — `updateStatus()`:
- Accepts ANY string as new status (line 142: `status: status as any`)
- No transition map exists
- No "from → to" validation

### Side Effects Per Status

| To Status | Timestamp | Stock Operation | Order Status Change |
|-----------|-----------|----------------|---------------------|
| DISPATCHED | — | — | — |
| HANDED_OVER | sets `handedOverAt` | `stockService.operate('deduct', ...)` | — |
| PICKED_UP | sets `pickedUpAt` | — | — |
| IN_TRANSIT | — | — | — |
| DELIVERED | sets `deliveredAt` | — | Webhook also sets Order→`Delivered` |
| PARTIAL | — | — | Webhook also sets Order→`Partial` |
| RETURN_PENDING | — | — | Webhook also sets Order→`Return Pending` |
| RETURNED | clears `deliveredAt` | `stockService.operate('add', ...)` | — |
| CANCELLED | — | — | — |

### Business Rule: Dispatch is Independent from Order

**Claim:** "Dispatch may happen any time AFTER Order = Confirmed. It may happen BEFORE Packed. It may happen AFTER Packed."

**Verification:**
- `POST /dispatch` has **NO check** on Order status — creates dispatch for any order ✅
- `PATCH /dispatch/:id/status` does **NOT** change Order status (independent) ✅
- Courier webhook `syncToDispatch()` updates Order status (coupling for DELIVERED/PARTIAL/RETURN_PENDING) ⚠️
- **BUT:** `DISPATCHED` is the default status on create — there's no automatic HANDED_OVER transition when the courier manager dispatches

**Verdict:** Mostly independent. The webhook coupling is the only place where Dispatch status changes Order status, and it only affects 3 statuses.

### Anomalies

1. **No transition validation** — any string accepted. `DAMAGED` is used in stock logic but doesn't exist in the enum.
2. **No Order status guard** on `create()` — can create dispatch for Cancelled or Pending orders.
3. **CourierManagerService.dispatch()** does NOT create Dispatch records — it only updates Order courier fields.
4. **`DISPATCHED` default** — dispatches start in DISPATCHED status with no automatic HANDED_OVER when courier API is called.

---

## 4. Event Flow Matrix

### Order Transition → Triggered Events

| Transition | StockService | ManagedStockLedger | InventoryLog | Analytics Event | Accounting | Notification | Order Status Change |
|-----------|-------------|-------------------|-------------|----------------|------------|--------------|-------------------|
| **Create → Pending** | `reserve()` ✅ | — | via StockService | — | — | — | — |
| **→ Confirmed** | — | ✅ ORDER_DEDUCTION (OUT) | — | — | Cost snapshot taken | — | statusId updated |
| **→ Cancelled** | `release()` ✅ | ✅ CANCEL_RELEASE (IN) | — | `order.status_changed` | Refund tracking event | — | statusId updated |
| **→ Delivered** | — | — | — | — | COD auto-paid | — | statusId updated |
| **→ Packed** | — | — | — | — | — | — | statusId updated (bypasses validation) |
| **→ Returned** | — | ✅ RETURN (IN) | — | — | — | — | statusId updated |
| **→ Shipping** | — | — | — | — | — | — | statusId updated |
| **→ Return Pending** | — | — | — | Refund event (if from Cancelled) | — | — | statusId updated |
| **Add Item** | `reserve()` ✅ | — | — | — | — | — | — |
| **Remove Item** | `release()` ✅ | — | — | — | — | — | — |

### Dispatch Transition → Triggered Events

| Transition | StockService | ManagedStockLedger | Order Status | Analytics |
|-----------|-------------|-------------------|-------------|-----------|
| **→ HANDED_OVER** | `operate('deduct')` | via StockService (InventoryLog, not MSL) | — | — |
| **→ DELIVERED** | — | — | webhook → Delivered | — |
| **→ RETURNED** | `operate('add')` | via StockService (InventoryLog, not MSL) | — | — |
| **→ PARTIAL** | — | — | webhook → Partial | — |
| **→ RETURN_PENDING** | — | — | webhook → Return Pending | — |

### Payment Transition → Triggered Events

| Transition | Stock Service | Order Status | Refund | Analytics |
|-----------|-------------|-------------|--------|-----------|
| **Proof submitted → PAYMENT_VERIFYING** | — | status→Payment Verifying | — | — |
| **Proof approved → PAID** | — | status→Confirmed | — | — |
| **Proof rejected → PAYMENT_PENDING** | — | status→Payment Pending | — | — |
| **Refund completed** | — | — | Refund approved → processed | — |

---

## 5. Stock Event Matrix per Availability Mode

### MANAGED_STOCK

| Trigger | Action | Affects | Ledger | Guard |
|---------|--------|---------|--------|-------|
| Order created | `reserve()` | `reservedStock++` | InventoryLog | None needed |
| Order confirmed | `deductStockForOrder()` (direct) | `managedStockQuantity--` | ManagedStockLedger (ORDER_DEDUCTION) | Must be MANAGED_STOCK + manageStock |
| Order cancelled | `release()` + `restoreStockForCancelledOrder()` | `reservedStock--` + `managedStockQuantity++` | ManagedStockLedger (CANCEL_RELEASE) | Must be MANAGED_STOCK (idempotent) |
| Order returned | `handleReturnedSideEffects()` | `managedStockQuantity++` | ManagedStockLedger (RETURN) | Must be MANAGED_STOCK (idempotent) |
| Dispatch HANDED_OVER | `operate('deduct')` | `managedStockQuantity--` + `reservedStock--` | InventoryLog (legacy) | None |
| Dispatch RETURNED | `operate('add')` | `managedStockQuantity++` | InventoryLog (legacy) | None |
| GRN received | `add()` | `managedStockQuantity++` | InventoryLog (legacy) | None |
| Manual adjust | `adjust()` | `managedStockQuantity±` | ManagedStockLedger (MANUAL_ADD/REMOVE) | Rejects non-MANAGED_STOCK |

**⚠️ Key Issue:** `reservedStock` is NEVER cleared on confirm. It stays elevated for confirmed orders. It's only decremented on cancellation (release) or at dispatch HANDED_OVER (operate('deduct') decrements both fields). This means `available = managedStockQuantity - reservedStock` is inaccurate between confirm and dispatch.

### INVENTORY_CONTROLLED

| Trigger | Action | Affects | Notes |
|---------|--------|---------|-------|
| Order created | `reserve()` | `reservedStock++` | No special handling yet |
| Order confirmed | SKIPPED | — | Correct — no managed stock to deduct |
| Order cancelled | `release()` | `reservedStock--` | Runs |
| Manual adjust | THROWS | — | "Use Purchase Orders" |
| Restock | Only InventoryLog | — | No managed stock mutation |
| Valuation | EXCLUDED | — | Correct |
| License downgrade | Auto-reverts to MANAGED_STOCK | — | Safety net |

**Verdict:** INVENTORY_CONTROLLED is a **stub** — most operations fall through to MANAGED_STOCK paths (reserve, release). Full implementation is future.

### ALWAYS_IN_STOCK

| Trigger | Action | Issues |
|---------|--------|--------|
| Order created | `reserve()` → `reservedStock++` | **Unnecessary** — no stock to reserve |
| Order confirmed | SKIPPED | Correct |
| Order cancelled | `release()` → `reservedStock--` | Unnecessary but harmless |
| Dispatch HANDED_OVER | `operate('deduct')` → `reservedStock--` + costing lots | **MINOR** — reserved touched unnecessarily |
| Manual adjust | THROWS | Correct |

### ALWAYS_OUT_OF_STOCK

| Trigger | Action | Issues |
|---------|--------|--------|
| Order created | `reserve()` → `reservedStock++` | 🔴 **BUG** — orders can be placed for discontinued products |
| Order confirmed | SKIPPED | Correct |
| Order cancelled | `release()` → `reservedStock--` | Runs |
| Manual adjust | THROWS | Correct |

**🔴 BUG-1: No order placement guard for ALWAYS_OUT_OF_STOCK.** Products marked as discontinued can be ordered through all order creation paths. There is no availabilityMode check in `orders.service.ts create()`, `addItem()`, or `updateOrder()`.

---

## 6. Dual Stock Architecture Validation

### A. Which ledger belongs to Managed Stock?
**ManagedStockLedger** — tracks all mutations to `managedStockQuantity`. Movement types: INITIAL, ORDER_DEDUCTION, MANUAL_ADD, MANUAL_REMOVE, ADJUSTMENT, RETURN, CANCEL_RELEASE.

### B. Which service owns Managed Stock mutations?
**StockService** (should be) — but currently 3 services bypass it:
1. **OrdersService** — direct Prisma writes in `deductStockForOrder()`, `restoreStockForCancelledOrder()`, `handleReturnedSideEffects()`
2. **InventoryService** — direct Prisma writes in `adjust()`, `restockOrderItems()`
3. **ProductsService** — direct Prisma writes in `create()`, `update()` (mode changes)

### C. Which ledger belongs to Physical Inventory?
**Does not exist.** There is no dedicated Physical Inventory Ledger in the schema. `InventoryLog` (legacy flat log) is the closest approximation, used for transfer logging and historical tracking. `Warehouse`/`BinLocation` models exist but have no movement tracking.

### D. Which service owns Physical Inventory mutations?
**InventoryService** — via `adjust()` (adjustment), `restockOrderItems()` (return restock), `transfer()` (warehouse transfer). But these still write to Product models (`managedStockQuantity`), not to Inventory-specific models.

### E. Can Inventory module directly modify Managed Stock?
**YES** — `inventory.service.ts` writes to `ProductVariant.managedStockQuantity` and `Product.managedStockQuantity` (lines 251, 281, 334, 410, 507, 530, 571, 590). This violates INV-001.

### F. Can Product module directly modify Physical Inventory?
**No** — ProductsService does not write to `Warehouse`, `BinLocation`, or `InventoryLog`. It writes to `ManagedStockLedger` directly (bypassing ManagedStockLedgerService) but this is for Managed Stock, not Physical Inventory.

### Violations Summary

| # | Domain | Invariant Violated | Location | Severity |
|---|--------|-------------------|----------|----------|
| 1 | Inventory | INV-001: Only StockService may mutate managedStockQuantity | inventory.service.ts (8 write sites) | CRITICAL |
| 2 | Orders | INV-001: Only StockService may mutate managedStockQuantity | orders.service.ts (3 methods, 6 write sites) | CRITICAL |
| 3 | Products | INV-002: Only StockService creates ledger entries | products.service.ts (3 direct writes to ManagedStockLedger) | MEDIUM |
| 4 | Stock | INV-002: StockService.operate() writes to InventoryLog not ManagedStockLedger | stock.service.ts:258 | HIGH |
| 5 | Dispatch | INV-014: No transition validation | dispatch.service.ts:142 | MEDIUM |
| 6 | Orders | BUG-1: No ALWAYS_OUT_OF_STOCK guard | orders.service.ts:642-652 | HIGH |
| 7 | Stock | BUG-3: deductCostingLots runs for non-MANAGED_STOCK | stock.service.ts:301-303 | MEDIUM |
| 8 | Stock | BUG-4: Potential double deduction | orders:966 + dispatch:184 | CRITICAL |

---

## 7. Architecture Conflicts Discovered

### Conflict 1: Dual Deduction Path (CRITICAL)
- `orders.service.ts:966` — `deductStockForOrder()` decrements `managedStockQuantity` on Confirmed
- `dispatch.service.ts:184` — `stockService.operate('deduct')` decrements `managedStockQuantity` again on HANDED_OVER
- If an order reaches Confirmed AND the dispatch reaches HANDED_OVER, stock is deducted **twice**.
- The only mitigation is that both check `availabilityMode === 'MANAGED_STOCK'`, but for MANAGED_STOCK products, both fire.

### Conflict 2: reservedStock Never Decremented on Confirm
- `deductStockForOrder()` does NOT decrement `reservedStock`
- `reservedStock` is decremented by `release()` (on cancel) or `operate('deduct')` (at dispatch HANDED_OVER)
- Between Confirmed and HANDED_OVER, `reservedStock` is inflated
- The `available = managedStockQuantity - reservedStock` calculation is wrong for confirmed-but-not-dispatched orders

### Conflict 3: Inconsistent Ledger Writes
- OrdersService writes exclusively to ManagedStockLedger (correct per architecture)
- StockService.operate() writes exclusively to InventoryLog (legacy, should migrate)
- InventoryService writes to BOTH InventoryLog AND ManagedStockLedGER same operation
- ProductsService writes directly to ManagedStockLedger (bypassing service layer)

### Conflict 4: DB State Drift Risk
- `updateStatus()` validates via DB `nextStatuses` — admins can modify transitions via `/order-statuses/:id` endpoint
- `transitionOrderStatus()` validates via code `ORDER_TRANSITIONS` constant — hardcoded
- If DB is modified via admin but code constant is not updated, the two validation paths diverge

### Conflict 5: Packing Bypasses Order Validation
- Packing service writes `statusId` directly via `prisma.order.update()`
- It does NOT pass through `updateStatus()` or `transitionOrderStatus()`
- No NextStatuses validation happens
- Timeline entry is written manually

### What Should Change

| Priority | Change | Type |
|----------|--------|------|
| P0 | Fix dual deduction: route ALL stock ops through StockService, ensure idempotency | Code (Phase 10) |
| P0 | Fix reservedStock not decremented on confirm: add reservedStock decrement in deductStockForOrder() | Code (Phase 10) |
| P1 | Add ALWAYS_OUT_OF_STOCK guard on order creation (create, addItem, updateOrder) | Code (Phase 10) |
| P1 | Add DispatchStatus transition validation | Code (Phase 10) |
| P1 | Migrate StockService.operate() to write ManagedStockLedger | Code (Phase 10) |
| P2 | Fix ProductsService direct ManagedStockLedger writes → use service layer | Code (Phase 10) |
| P2 | Add Dedicated Physical Inventory Ledger model | Schema + Doc (Future) |
| P3 | Implement INVENTORY_CONTROLLED mode | Code + Doc (Future) |
| — | State machine docs in STATE_MACHINES.md (this file) | ✅ Done |
| — | Stock event policies per mode — documented in WORKFLOWS.md | Update needed |