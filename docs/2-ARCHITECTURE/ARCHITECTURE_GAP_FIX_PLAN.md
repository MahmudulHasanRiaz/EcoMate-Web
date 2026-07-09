# Architecture Gap Fix Plan

> **Status:** Draft  
> **Purpose:** Prioritized list of all gaps between documented target architecture and current implementation.  
> **Cross-reference:** `docs/1-BUSINESS/ARCHITECTURE_INVARIANTS.md` (violations table), `docs/2-ARCHITECTURE/STATE_MACHINES.md` (dual stock validation)

---

## Priority: CRITICAL (blocks correctness)

### P0-C1: DeductStockForOrder bypasses StockService

**Location:** `orders.service.ts:1710-1770`
**Documentation target:** Confirm should Physical Inventory CHECK + RESERVE. Managed Stock optional per-product.
**Current behavior:** Direct `tx.productVariant.update({ managedStockQuantity: decrement })` + direct `ManagedStockLedger.record`. Skips `isManagedField` guard, cost lot deduction, `InventoryLog` entry.
**Fix:** Route through `StockService.deduct()` (or new `StockService.checkAndReservePhysical() + StockService.deduct()` if syncManagedStock). Remove direct Prisma writes.

---

### P0-C2: RestoreStockForCancelledOrder bypasses StockService

**Location:** `orders.service.ts:1772-1835`
**Current behavior:** Direct `tx.productVariant.update({ managedStockQuantity: increment })` + direct `ManagedStockLedger.record`.
**Fix:** Route through `StockService.releasePhysical()` + optionally `StockService.release()` for Managed Stock.

---

### P0-C3: HandleReturnedSideEffects bypasses StockService

**Location:** `orders.service.ts:1608-1675`
**Current behavior:** Direct `tx.productVariant.update({ managedStockQuantity: increment })` + direct `ManagedStockLedger.record`.
**Fix:** Route through `StockService.addPhysical()` + optionally `StockService.add()`.

---

### P0-C4: InventoryService.restockOrderItems bypasses StockService

**Location:** `inventory.service.ts:441-621`
**Current behavior:** 4 direct `managedStockQuantity` writes + 4 direct `ManagedStockLedger.record` calls + 2 direct `InventoryLog.create` calls.
**Fix:** Route through `StockService.addPhysical()` + optionally `StockService.add()`. Single ledger write path.

---

### P0-C5: InventoryService.adjust bypasses StockService

**Location:** `inventory.service.ts:239-439`
**Current behavior:** 4 direct `managedStockQuantity` writes + direct `ManagedStockLedger.record`.
**Fix:** Route through StockService. `adjust` should call `StockService.addPhysical()` with manual-adjust reference.

---

### P0-S1: Missing PhysicalInventory model

**Location:** Prisma schema — entire model absent
**What's needed:** New `PhysicalInventory` model with fields:
- `id String @id @default(cuid())`
- `productId String`
- `warehouseId String`
- `quantity Int @default(0)`
- `reservedQuantity Int @default(0)`
- Relations to Product + Warehouse
**Note:** Inventory Management feature gated — only created/relevant when feature is enabled.

---

### P0-S2: Missing syncManagedStock field on Product

**Location:** Product model (schema.prisma:393-441) — field absent
**What's needed:** `syncManagedStock Boolean @default(false)` on Product model.

---

### P0-B1: Dual Deduction — Confirm + HANDED_OVER both deduct

**Location:** `orders.service.ts:1734-1755` (deduct at Confirm) + `dispatch.service.ts:184-191` (deduct at HANDED_OVER via StockService)
**Documentation target:** Confirm should only CHECK + RESERVE Physical Inventory. DEDUCT only at HANDED_OVER. Managed Stock optional at either point (per syncManagedStock toggle).
**Fix:** Remove `managedStockQuantity--` from Confirm path. Keep Physical Inventory reserve only. Move deduction to HANDED_OVER-only.

---

### P0-B2: reservedStock never decremented at Confirm

**Location:** `orders.service.ts:1734-1755` — `deductStockForOrder` does NOT decrement `reservedStock`
**Documentation target:** This is **correct by design** — reservedStock stays elevated until HANDED_OVER or cancel. BUT the `available = managedStockQuantity - reservedStock` calculation is incorrect between Confirm and HANDED_OVER.
**Fix:** No fix needed for the decrement (correct behavior). But add documentation/guard that `available` calculation during this window is known-imprecise.

---

## Priority: HIGH (blocks feature parity)

### P1-S1: StockService lacks physical inventory operations

**Location:** `stock.service.ts:272-339`
**What's missing:**
- `reservePhysical()` — increments `PhysicalInventory.reservedQuantity`
- `deductPhysical()` — decrements `PhysicalInventory.quantity` + `PhysicalInventory.reservedQuantity`
- `releasePhysical()` — decrements `PhysicalInventory.reservedQuantity`
- `addPhysical()` — increments `PhysicalInventory.quantity`
- `checkPhysicalAvailability()` — returns `PhysicalInventory.quantity - PhysicalInventory.reservedQuantity`
**Fix:** Add new `operatePhysical()` method or extend `operate()` to accept a `layer` parameter (`'managed' | 'physical' | 'both'`).

---

### P1-S2: StockService writes only to InventoryLog, never to ManagedStockLedger

**Location:** `stock.service.ts:250-270` (`logInventory` method)
**Documentation target:** StockService should write to ManagedStockLedger (for Managed Stock operations) and Physical Ledger (future, for Physical operations).
**Current behavior:** `inventoryLog.create()` only.
**Fix:** Add `ManagedStockLedger.record()` call in StockService for deduct/add operations. InventoryLog becomes legacy-only.

---

### P1-B3: No ALWAYS_OUT_OF_STOCK guard

**Location:** `orders.service.ts:541-627` (create), `addItem`, `updateOrder` — no availabilityMode check
**Fix:** Before every order creation path: if `product.availabilityMode === 'ALWAYS_OUT_OF_STOCK'`, throw `BadRequestException`.

---

### P1-V1: Packing service bypasses order status validation

**Location:** `packing.service.ts:137-147` (`markDone`), `180-191` (`markHold`)
**Current behavior:** Direct `prisma.order.update({ statusId })` without ANY transition validation.
**Fix:** Use `ordersService.updateStatus()` or `ordersService.transitionOrderStatus()` instead of direct Prisma write.

---

### P1-V2: Courier webhook bypasses order status validation

**Location:** `courier-webhook.service.ts:269-271` (`syncToDispatch`)
**Current behavior:** Direct `prisma.order.update({ statusId })` for DELIVERED/PARTIAL/RETURN_PENDING without transition validation.
**Fix:** Route through `ordersService.updateStatus()` with transition validation.

---

### P1-V3: OrderStatus seed/migration mismatch

**Location:** `prisma/seed.ts:103-117` (13 statuses) vs `prisma/migrations/*` (14 statuses, different names)
**Differences:**
| Seed-only | Migration-only |
|-----------|---------------|
| Processing | Payment Verifying |
| Shipped | Hold |
| Refunded | Shipping |
| | Partial |

**Fix:** Align seed with migration canonical set. Seed must produce exactly the 14 statuses the code expects.

---

### P1-V4: Two parallel state machine validation mechanisms

**Location:** `orders.service.ts:29-44` (`ORDER_TRANSITIONS` constant) vs DB `OrderStatus.nextStatuses` JSON column
**Risk:** Can diverge — admin endpoint can modify `nextStatuses` in DB but not the code constant.
**Fix:** Choose ONE canonical source:
- Option A: Code constant as single source of truth (remove `nextStatuses` validation path)
- Option B: DB as source of truth (remove `ORDER_TRANSITIONS`, ensure seed is canonical)
- Option C: Code constant validates, DB `nextStatuses` is read-only display

---

## Priority: MEDIUM (correctness improvement)

### P2-S1: DeductCostingLots not mode-aware

**Location:** `stock.service.ts:222-248` (definition), `302` (call site)
**Current behavior:** Runs for ALL modes — `ALWAYS_IN_STOCK`, `ALWAYS_OUT_OF_STOCK`, `MANAGED_STOCK`, `INVENTORY_CONTROLLED`.
**Documentation target:** Only run for MANAGED_STOCK when Inventory Management disabled, or for Physical Inventory costing when enabled.
**Fix:** Add `availabilityMode` check before calling `deductCostingLots`.

---

### P2-S2: Dispatch has NO transition validation

**Location:** `dispatch.service.ts:140-202`
**Current behavior:** `status as any` cast accepts any string. No "from → to" validation.
**Fix:** Add `DISPATCH_TRANSITIONS` constant mapping valid transitions. Validate before update.

---

### P2-S3: Dispatch missing ASSIGNED_TO_RIDER status

**Location:** Prisma schema DispatchStatus enum (lines 961-971)
**Documentation target:** `PENDING → DISPATCHED → HANDED_OVER → PICKED_UP → IN_TRANSIT → ASSIGNED_TO_RIDER → DELIVERED`
**Current enum:** Missing ASSIGNED_TO_RIDER.
**Fix:** Add to DispatchStatus enum. Add transition entries. Add side-effect handling (courier assignment notification).

---

### P2-V1: ProductsService writes ManagedStockLedger directly

**Location:** `products.service.ts:594-604, 718-742`
**Current behavior:** Direct `prisma.managedStockLedger.create()` for initial stock and mode changes.
**Fix:** Route through `StockService.add()` / `ManagedStockLedgerService.record()` (if that exists as intermediary).

---

### P2-V2: Refund dispatch check is partial

**Location:** `refunds.service.ts:103-132`
**Current behavior:** Dispatch existence check only runs when `targetStatusId` is provided during refund creation.
**Fix:** Always check active dispatches before allowing cancellation. Add check on `updateStatus` as well as `create`.

---

### P2-V3: Packing lock race condition

**Location:** `packing.service.ts:109-147` (`markDone`)
**Risk:** No runtime guard against status change between `getQueue()` and `markDone()`. An order could be cancelled between queue fetch and pack completion.
**Fix:** Add optimistic locking — verify order status hasn't changed before updating.

---

## Priority: LOW (enhancement)

### P3-S1: Missing COSTING_ENABLED toggle

**Location:** No system-wide setting for costing mode
**Current behavior:** `takeCostSnapshot` always runs, `costType` always `'estimated'`.
**Documentation target:** Costing mode-aware per Inventory Management setting.
**Fix:** Add system setting. Physical Inventory Mode B → actual cost from CostingLot. Mode A → estimated cost from standardCost.

---

### P3-S2: costType always 'estimated'

**Location:** `orders.service.ts:1703`
**Current behavior:** Hardcoded `costType: 'estimated'`.
**Documentation target:** Should switch to `'actual'` when Inventory Management is enabled and CostingLot data is available.
**Fix:** After HANDED_OVER, update costSnapshot from CostingLot deduction result.

---

### P3-S3: DeductCostingLots runs for combo products without mode check

**Location:** `stock.service.ts:222-248`
**Current behavior:** Guard `if (!params.comboId)` skips combo products only.
**Fix:** Replace comboId guard with availabilityMode guard.

---

## Dependency Order

```
Phase A — Schema migrations (no code changes)
  ├── P0-S1: PhysicalInventory model
  ├── P0-S2: syncManagedStock field
  ├── P2-S3: ASSIGNED_TO_RIDER enum val
  └── P1-V3: Fix OrderStatus seed

Phase B — StockService centralization (no schema changes)
  ├── P1-S1: Add physical inventory operations
  ├── P1-S2: Write to ManagedStockLedger (not just InventoryLog)
  └── P2-S1: Make DeductCostingLots mode-aware

Phase C — Fix bypasses (depend on Phase B)
  ├── P0-C1: DeductStockForOrder → StockService
  ├── P0-C2: RestoreStockForCancelledOrder → StockService
  ├── P0-C3: HandleReturnedSideEffects → StockService
  ├── P0-C4: RestockOrderItems → StockService
  └── P0-C5: InventoryService.adjust → StockService

Phase D — State machine fixes
  ├── P0-B1: Remove Confirm deduct, keep HANDED_OVER only
  ├── P1-V1: Packing validation
  ├── P1-V2: Courier webhook validation
  ├── P1-V4: Unify ORDER_TRANSITIONS vs nextStatuses
  ├── P2-S2: Dispatch transition validation
  └── P2-V2: Refund dispatch check

Phase E — Guards and enhancements
  ├── P1-B3: ALWAYS_OUT_OF_STOCK guard
  ├── P2-V3: Packing lock race condition
  ├── P3-S1: COSTING_ENABLED toggle
  ├── P3-S2: costType switching
  └── P3-S3: Combo guard
```

---

## Total: 24 gaps (5 CRITICAL schema + 4 CRITICAL stock bypass + 2 CRITICAL business logic + 4 HIGH schema + 2 HIGH stock + 3 HIGH validation + 3 MEDIUM correctness + 3 LOW enhancement)
