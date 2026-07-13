# Stock & Inventory System Overhaul Implementation Plan v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the stock/inventory system consistent with the spec — central IM gate, correct engine routing per IM state + availabilityMode, and no gaps in order lifecycle reservation/deduction/restore flow.

**Architecture:** `StockRouterService` as single authority returning `{ ms: StockAction, pi: StockAction, msConditionalOnSync: boolean }`. `InventoryEnabledGuard` at controller level. All PI methods require `tx: Prisma.TransactionClient` — no inner transactions. All lifecycle paths (create, confirm, cancel, return, addItem, removeItem, trash, updateOrder, dispatch, POS) use the same caller pattern against the router.

**Tech Stack:** NestJS, Prisma/PostgreSQL, React/TanStack Query, TypeScript

**Reference Docs:**
- `docs/2-ARCHITECTURE/ADR/003-dual-stock-tracking.md`
- `docs/3-DOMAINS/01-inventory.md`
- `docs/superpowers/plans/2026-07-13-stock-inventory-revised-analysis.md` (9-point re-audit)

---

### Routing Matrix (Final)

| IM | Mode | reserve (create) | allocate (confirm) | deduct (HANDED_OVER) | add (return) | release (cancel) | scrap (DAMAGED) |
|----|------|---------|-------------------|---------------------|-------------|-----------------|-------|
| OFF | MS | ms=reserve, pi=skip | ms=skip, pi=skip | ms=deduct, pi=skip | ms=add, pi=skip | ms=release, pi=skip | ms=scrap, pi=skip |
| OFF | IC | **BLOCK** | **BLOCK** | **BLOCK** | **BLOCK** | **BLOCK** | **BLOCK** |
| ON | MS | ms=reserve, pi=skip | ms=skip, pi=allocate | ms=deduct, pi=fulfill, msCond=true | ms=add, pi=add, msCond=true | ms=release, pi=release | ms=scrap, pi=skip |
| ON | IC | ms=skip, pi=allocate | ms=skip, pi=check | ms=skip, pi=fulfill | ms=skip, pi=add | ms=skip, pi=release | ms=skip, pi=skip |

**POS (immediate deduct — no reserve phase):**

| IM | Mode | POS deduct |
|----|------|------------|
| OFF | MS | ms=deduct, pi=skip |
| OFF | IC | BLOCK |
| ON | any | ms=skip, pi=deduct (warehouse from session.showroom.id) |

**Dispatch RETURNED:** skip stock entirely. Let order-level Returned handle restore.

**Dispatch DAMAGED:** skip stock entirely. Already handled at HANDED_OVER.

---

### Caller Pattern (used identically everywhere)

```typescript
const d = this.stockRouter.resolve(product.availabilityMode, opType, imEnabled);

// Execute MS action
if (d.ms !== 'skip') {
  const shouldSkipMs = d.msConditionalOnSync && !product.syncManagedStock;
  if (!shouldSkipMs) {
    await stockService.operate(d.ms, { productId, variantId, quantity, reference, tx });
  }
}

// Execute PI action
if (d.pi !== 'skip') {
  if (!warehouseId) throw new BadRequestException('Warehouse required for PI operation');
  if (d.pi === 'fulfill') {
    await stockService.fulfillPhysicalReservation({ orderId, orderItemId, quantity, reference, tx });
  } else if (d.pi === 'allocate') {
    await stockService.reservePhysicalAllocated({ orderId, orderItemId, productId, variantId, warehouseId, quantity, tx });
  } else if (d.pi === 'check') {
    const avail = await stockService.checkPhysicalAvailability(productId, warehouseId, variantId);
    if (!avail.available || avail.availableStock < quantity) throw new BadRequestException('Insufficient PI');
  } else {
    await stockService.operatePhysical(d.pi as any, { productId, variantId, quantity, warehouseId, reference, tx });
  }
}
```

---

### Files to Create/Modify (21 total)

**Backend (12):**

| File | Action | Responsibility |
|------|--------|---------------|
| `src/stock/stock-router.service.ts` | **CREATE** | `resolve(mode, op, imEnabled) → { ms, pi, msConditionalOnSync }`, `isInventoryManagementEnabled()` |
| `src/stock/stock.module.ts` | MODIFY | Export StockRouterService |
| `src/stock/guards/inventory-enabled.guard.ts` | **CREATE** | Controller-level IM guard |
| `src/stock/stock.service.ts` | MODIFY | `reservePhysicalAllocated`/`fulfillPhysicalReservation`/`releasePhysicalAllocated` — make `tx` required, remove inner `$transaction` |
| `src/stock/stock.service.ts` | MODIFY | `applyStockChange` — block ALL MS mutations for IC mode |
| `src/inventory/inventory.controller.ts` | MODIFY | Add `InventoryEnabledGuard` to physical endpoints |
| `src/inventory/physical-inventory.controller.ts` | MODIFY | Add `InventoryEnabledGuard` |
| `src/inventory/inventory.service.ts` | MODIFY | `stockOverview` hides PI when IM OFF, `adjust` IM gate |
| `src/orders/orders.service.ts` | MODIFY | All lifecycle: create, confirm, cancel, return, addItem, removeItem, trash, updateOrder, transitionOrderStatus |
| `src/dispatch/dispatch.service.ts` | MODIFY | HANDED_OVER: router-based. RETURNED/DAMAGED: skip stock entirely |
| `src/pos/pos-orders.service.ts` | MODIFY | IM ON → PI only (session.showroom.id), IM OFF → availabilityMode routing |
| `src/products/products.service.ts` | MODIFY | IC mode only when IM ON, validate BEFORE DB write |

**Frontend (9):**

| File | Gaps |
|------|------|
| `inventory/index.tsx` | H1, H2, H5, H6, M1, M2 |
| `inventory/detail.tsx` | H3 |
| `inventory/components/inventory-detail-drawer.tsx` | M4 |
| `inventory/components/quick-adjustment-modal.tsx` | M3 |
| `inventory/overview.tsx` | M8 |
| `inventory/physical-stock-table.tsx` | L2 |
| `inventory/history.tsx` | L4 |
| `products/components/products-columns.tsx` | H4, M7 |
| `products/components/product-form.tsx` | M5, L3, M9 |

---

### Phase 0: Core Architecture

#### Task 0.1: Create StockRouterService

**File:** Create `apps/backend/src/stock/stock-router.service.ts`

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type StockAction = 'reserve' | 'release' | 'deduct' | 'add' | 'scrap' | 'fulfill' | 'allocate' | 'check' | 'skip';

export interface StockEngineDecision {
  ms: StockAction;
  pi: StockAction;
  msConditionalOnSync: boolean;
}

@Injectable()
export class StockRouterService {
  constructor(private readonly prisma: PrismaService) {}

  async isInventoryManagementEnabled(): Promise<boolean> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'inventory_enabled' },
    });
    return setting?.value === 'true';
  }

  resolve(
    availabilityMode: string | null | undefined,
    opType: string,
    imEnabled: boolean,
  ): StockEngineDecision {
    const mode = availabilityMode as string | undefined;

    const SKIP: StockEngineDecision = { ms: 'skip', pi: 'skip', msConditionalOnSync: false };
    const MS_ONLY: StockEngineDecision = { ms: opType as StockAction, pi: 'skip', msConditionalOnSync: false };
    const PI_ONLY: StockEngineDecision = { ms: 'skip', pi: opType as StockAction, msConditionalOnSync: false };
    const MS_COND: StockEngineDecision = { ms: opType as StockAction, pi: opType as StockAction, msConditionalOnSync: true };

    if (!mode || mode === 'ALWAYS_IN_STOCK') return SKIP;
    if (mode === 'ALWAYS_OUT_OF_STOCK') return SKIP;

    if (!imEnabled) {
      if (mode === 'INVENTORY_CONTROLLED') {
        return { ...SKIP, skipReason: 'IM disabled — IC not usable' };
      }
      // IM OFF: everything MS
      if (opType === 'check') return SKIP; // check not needed for MS
      return MS_ONLY;
    }

    // IM ON
    if (mode === 'INVENTORY_CONTROLLED') {
      if (opType === 'reserve') return { ms: 'skip', pi: 'allocate', msConditionalOnSync: false };
      if (opType === 'release') return PI_ONLY;
      if (opType === 'deduct') return { ms: 'skip', pi: 'fulfill', msConditionalOnSync: false };
      if (opType === 'add') return PI_ONLY;
      if (opType === 'allocate') return { ms: 'skip', pi: 'allocate', msConditionalOnSync: false };
      if (opType === 'check') return { ms: 'skip', pi: 'check', msConditionalOnSync: false };
      return SKIP;
    }

    // IM ON + MANAGED_STOCK
    if (mode === 'MANAGED_STOCK') {
      if (opType === 'reserve') return MS_ONLY;
      if (opType === 'release') return { ms: 'release', pi: 'release', msConditionalOnSync: false };
      if (opType === 'deduct') return MS_COND;  // deduct: PI=fulfill, MS=deduct(conditional)
      if (opType === 'add') return MS_COND;     // add: PI=add, MS=add(conditional)
      if (opType === 'scrap') return MS_ONLY;
      if (opType === 'allocate') return { ms: 'skip', pi: 'allocate', msConditionalOnSync: false };
      if (opType === 'check') return { ms: 'skip', pi: 'check', msConditionalOnSync: false };
      return MS_ONLY;
    }

    return MS_ONLY;
  }
}
```

- [ ] **Step 1:** Create file with above code

#### Task 0.2: Update StockModule

- [ ] **Step 1:** Modify `apps/backend/src/stock/stock.module.ts` to provide and export `StockRouterService`

```typescript
import { Module, Global } from '@nestjs/common';
import { StockService } from './stock.service';
import { StockRouterService } from './stock-router.service';

@Global()
@Module({
  providers: [StockService, StockRouterService],
  exports: [StockService, StockRouterService],
})
export class StockModule {}
```

- [ ] **Step 2:** Build: `npx nest build` → no errors
- [ ] **Step 3:** Commit

#### Task 0.3: Create InventoryEnabledGuard

**File:** Create `apps/backend/src/stock/guards/inventory-enabled.guard.ts`

```typescript
import { Injectable, CanActivate, ExecutionContext, BadRequestException } from '@nestjs/common';
import { StockRouterService } from '../stock-router.service';

@Injectable()
export class InventoryEnabledGuard implements CanActivate {
  constructor(private readonly stockRouter: StockRouterService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
    if (!imEnabled) {
      throw new BadRequestException(
        'Inventory Management is disabled. Enable it in Settings to use physical inventory features.',
      );
    }
    return true;
  }
}
```

- [ ] **Step 1:** Create file
- [ ] **Step 2:** Build → no errors
- [ ] **Step 3:** Commit

#### Task 0.4: Fix PI methods — make tx required, remove inner transactions

**File:** Modify `apps/backend/src/stock/stock.service.ts`

Changes in `reservePhysicalAllocated`:
- Remove Phase 1's direct `this.prisma` calls — use `params.tx`
- Remove Phase 3's inner `this.prisma.$transaction` — use `params.tx` directly
- Make `tx` required (remove `?`)
- Remove the SERIALIZABLE isolation + retry loop (caller's outer transaction provides this)

Changes in `fulfillPhysicalReservation`:
- Remove the inner `client.$transaction([...])` — use direct `client.updateMany`
- Make `tx` required

Changes in `releasePhysicalAllocated`:
- Already mostly correct with `client = params.tx || this.prisma`
- Make `tx` required, remove fallback

Also fix `applyStockChange` — block ALL MS mutations for IC products:

```typescript
// In applyStockChange, replace isManagedField:
const isManagedField = (p: { availabilityMode: string | null }) => {
  if (!p?.availabilityMode) return true;
  if (p.availabilityMode === 'ALWAYS_IN_STOCK' || p.availabilityMode === 'ALWAYS_OUT_OF_STOCK') return false;
  if (p.availabilityMode === 'INVENTORY_CONTROLLED') return false;
  return true;
};
```

- [ ] **Step 1:** Make `tx` required in `reservePhysicalAllocated` params
- [ ] **Step 2:** Replace `this.prisma` with `params.tx` in Phase 1-2
- [ ] **Step 3:** Remove Phase 3 inner `$transaction`, run directly on `params.tx`
- [ ] **Step 4:** Remove the retry loop (moved to caller)
- [ ] **Step 5:** Make `tx` required in `fulfillPhysicalReservation`
- [ ] **Step 6:** Replace `client.$transaction([...])` with direct `params.tx.updateMany`
- [ ] **Step 7:** Make `tx` required in `releasePhysicalAllocated`
- [ ] **Step 8:** Fix `isManagedField` to block all MS mutations for IC
- [ ] **Step 9:** Build → fix all callers that don't pass `tx`
- [ ] **Step 10:** Commit: `git commit -m "fix: PI methods require tx, remove inner transactions, block IC MS mutations"`

---

### Phase 1: Order Lifecycle

#### Task 1.1: Fix order create — use router + real OrderItem.id

**File:** Modify `apps/backend/src/orders/orders.service.ts`

Key changes:
1. Create order items BEFORE reservations (so real IDs exist)
2. Use `StockRouter` for routing
3. IC products get PI reservation with real `orderItemId`

```typescript
// Inside create() $transaction, replace the reservation block:

// First: create all order items
const createdItems: any[] = [];
for (const item of dto.items) {
  const ci = await tx.orderItem.create({
    data: {
      orderId: created.id,
      productId: item.productId,
      variantId: item.variantId,
      comboId: item.comboId,
      comboSelection: item.comboSelection as any,
      quantity: item.quantity,
      price: item.price,
    },
  });
  createdItems.push(ci);
}

// Then: reserve stock using real OrderItem IDs
const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
for (let i = 0; i < dto.items.length; i++) {
  const item = dto.items[i];
  const dbItem = createdItems[i];
  const product = item.productId
    ? await tx.product.findUnique({ where: { id: item.productId }, select: { availabilityMode: true, warehouseId: true, syncManagedStock: true } })
    : null;

  const d = this.stockRouter.resolve(product?.availabilityMode, 'reserve', imEnabled);

  // MS reserve
  if (d.ms !== 'skip') {
    await this.stockService.reserve({
      productId: item.productId,
      variantId: item.variantId,
      comboId: item.comboId,
      comboSelection: item.comboSelection,
      quantity: item.quantity,
      reference: created.displayId,
      tx,
    });
  }

  // PI allocate
  if (d.pi !== 'skip') {
    const warehouseId = product?.warehouseId;
    if (!warehouseId) throw new BadRequestException(`Warehouse required for IC product`);
    await this.stockService.reservePhysicalAllocated({
      orderId: created.id,
      orderItemId: dbItem.id,  // ← REAL ID
      productId: item.productId!,
      variantId: item.variantId,
      warehouseId,
      quantity: item.quantity,
      tx,
    });
  }
}
```

- [ ] **Step 1:** Reorder — create items first, then reserve
- [ ] **Step 2:** Inject `StockRouterService` into constructor
- [ ] **Step 3:** Build → verify
- [ ] **Step 4:** Commit

#### Task 1.2: Fix updateStatus → Confirmed — use router, no double PI reserve

**File:** Modify `apps/backend/src/orders/orders.service.ts`

Replace the Confirm block in `updateStatus`:

```typescript
if (newStatus.name === 'Confirmed') {
  await this.takeCostSnapshot(id, tx);
  
  const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
  const items = await tx.orderItem.findMany({
    where: { orderId: id },
    include: { product: { select: { id: true, availabilityMode: true, warehouseId: true, name: true } } },
  });

  for (const item of items) {
    const product = item.product;
    if (!product) continue;

    const d = this.stockRouter.resolve(product.availabilityMode, 'allocate', imEnabled);
    if (d.pi === 'skip') continue;

    if (d.pi === 'check') {
      // IC: verify physical availability (already reserved at create)
      const avail = await this.stockService.checkPhysicalAvailability(item.productId!, product.warehouseId!);
      if (!avail.available || avail.availableStock < item.quantity) {
        throw new BadRequestException(`Insufficient physical stock for "${product.name}"`);
      }
    } else if (d.pi === 'allocate') {
      // MANAGED_STOCK with warehouse: create PI reservation (not done at create)
      if (!product.warehouseId) continue;
      const alreadyReserved = await this.stockService.hasExistingPhysicalReservation(id, item.id);
      if (!alreadyReserved) {
        await this.stockService.reservePhysicalAllocated({
          orderId: id,
          orderItemId: item.id,
          productId: item.productId!,
          variantId: item.variantId ?? undefined,
          warehouseId: product.warehouseId,
          quantity: item.quantity,
          tx,
        });
      }
    }
  }
}
```

- [ ] **Step 1:** Replace Confirm block
- [ ] **Step 2:** Build
- [ ] **Step 3:** Commit

#### Task 1.3: Fix updateStatus → Cancelled — single MS release path + PI release

**File:** Modify `apps/backend/src/orders/orders.service.ts`

Replace the Cancelled block:

```typescript
if (newStatus.name === 'Cancelled') {
  // Single MS release path (idempotent via hasExistingRestock)
  await this.releaseStockForCancelledOrder(id, tx);

  // PI release for all items (idempotent via status check inside)
  const cancelItems = await tx.orderItem.findMany({
    where: { orderId: id },
    include: { product: { select: { availabilityMode: true, warehouseId: true } } },
  });
  const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
  if (imEnabled) {
    for (const item of cancelItems) {
      const d = this.stockRouter.resolve(item.product?.availabilityMode, 'release', imEnabled);
      if (d.pi !== 'skip') {
        await this.stockService.releasePhysicalAllocated({ orderId: id, orderItemId: item.id, tx });
      }
    }
  }
}
```

- [ ] **Step 1:** Replace Cancelled block (remove the per-item release loop, keep single `releaseStockForCancelledOrder`)
- [ ] **Step 2:** Build
- [ ] **Step 3:** Commit

#### Task 1.4: Fix addItem — use router

**File:** Modify `apps/backend/src/orders/orders.service.ts`

```typescript
async addItem(orderId: string, dto: UpdateOrderItemDto) {
  // ...existing validation...

  const product = dto.productId
    ? await this.prisma.product.findUnique({ where: { id: dto.productId }, select: { availabilityMode: true, warehouseId: true, syncManagedStock: true, name: true } })
    : null;
  if (product?.availabilityMode === 'ALWAYS_OUT_OF_STOCK') {
    throw new BadRequestException(`"${product.name}" is out of stock`);
  }

  const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
  const d = this.stockRouter.resolve(product?.availabilityMode, 'reserve', imEnabled);

  // Create order item FIRST so we have real ID
  const newItem = await this.prisma.orderItem.create({
    data: {
      orderId, productId: dto.productId, variantId: dto.variantId,
      quantity: dto.quantity, price: dto.price,
    },
  });

  // Then reserve
  if (d.ms !== 'skip') {
    await this.stockService.reserve({
      productId: dto.productId, variantId: dto.variantId,
      quantity: dto.quantity, reference: order.displayId,
    });
  }

  if (d.pi !== 'skip') {
    const warehouseId = product?.warehouseId;
    if (!warehouseId) throw new BadRequestException('Warehouse required');
    await this.stockService.reservePhysicalAllocated({
      orderId, orderItemId: newItem.id,
      productId: dto.productId!, variantId: dto.variantId,
      warehouseId, quantity: dto.quantity,
      tx: undefined, // No outer tx; reservePhysicalAllocated handles its own now
    });
  }

  // ...rest (recalculate, update totals)...
}
```

- [ ] **Step 1:** Rewrite `addItem`
- [ ] **Step 2:** Build
- [ ] **Step 3:** Commit

#### Task 1.5: Fix removeItem — release PI

```typescript
async removeItem(orderId: string, itemId: string) {
  // ...existing validation...

  const product = removedItem.productId
    ? await this.prisma.product.findUnique({ where: { id: removedItem.productId }, select: { availabilityMode: true } })
    : null;

  const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
  const d = this.stockRouter.resolve(product?.availabilityMode, 'release', imEnabled);

  if (d.ms !== 'skip') {
    await this.stockService.release({
      productId: removedItem.productId || undefined,
      variantId: removedItem.variantId || undefined,
      quantity: removedItem.quantity,
      reference: order.displayId,
    });
  }

  if (d.pi !== 'skip') {
    await this.stockService.releasePhysicalAllocated({ orderId, orderItemId: itemId, tx: undefined });
  }

  await this.prisma.orderItem.delete({ where: { id: itemId } });
  // ...rest...
}
```

- [ ] **Step 1:** Rewrite `removeItem`
- [ ] **Step 2:** Build
- [ ] **Step 3:** Commit

#### Task 1.6: Fix trash + restore

```typescript
// In trash, after existing MS release loop + releaseStockForCancelledOrder:
const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
if (imEnabled) {
  for (const item of items) {
    const product = item.productId
      ? await tx.product.findUnique({ where: { id: item.productId }, select: { availabilityMode: true } })
      : null;
    const d = this.stockRouter.resolve(product?.availabilityMode, 'release', imEnabled);
    if (d.pi !== 'skip') {
      await this.stockService.releasePhysicalAllocated({ orderId, orderItemId: item.id, tx });
    }
  }
}
```

- [ ] **Step 1:** Add PI release to trash
- [ ] **Step 2:** Build
- [ ] **Step 3:** Commit

#### Task 1.7: Fix updateOrder items changed — release + reserve PI

- [ ] **Step 1:** In the items-changed block, add PI release for old items and PI reserve for new items using router
- [ ] **Step 2:** Build
- [ ] **Step 3:** Commit

#### Task 1.8: Fix handleReturnedSideEffects — use router + PI restore

```typescript
private async handleReturnedSideEffects(tx: Prisma.TransactionClient, orderId: string, performedBy?: string) {
  const alreadyRestocked = await this.managedStockLedgerService.hasExistingRestock(orderId);
  if (alreadyRestocked) return;

  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: { select: { id: true, availabilityMode: true, manageStock: true, type: true, warehouseId: true, syncManagedStock: true } } } } },
  });
  if (!order) return;

  const imEnabled = await this.stockRouter.isInventoryManagementEnabled();

  for (const item of order.items) {
    const product = item.product;
    if (!product) continue;

    const d = this.stockRouter.resolve(product.availabilityMode, 'add', imEnabled);

    // MS restore (conditional on syncManagedStock for MANAGED_STOCK)
    if (d.ms !== 'skip') {
      const skipMs = d.msConditionalOnSync && !product.syncManagedStock;
      if (!skipMs) {
        if (item.variantId) {
          await this.stockService.add({ productId: item.productId ?? undefined, variantId: item.variantId, quantity: item.quantity, reference: `return-${orderId}`, tx });
        }
        if (product.manageStock && item.productId && (!item.variantId || product.type === 'simple')) {
          await this.stockService.add({ productId: item.productId, quantity: item.quantity, reference: `return-${orderId}`, tx });
        }
      }
    }

    // PI restore (unconditional when IM ON)
    if (d.pi !== 'skip' && product.warehouseId) {
      await this.stockService.addPhysical({
        productId: item.productId!, variantId: item.variantId ?? undefined,
        quantity: item.quantity, warehouseId: product.warehouseId,
        reference: `return-${orderId}`, tx,
      });
    }
  }
}
```

- [ ] **Step 1:** Rewrite `handleReturnedSideEffects`
- [ ] **Step 2:** Build
- [ ] **Step 3:** Commit

#### Task 1.9: Fix transitionOrderStatus → Cancelled — already correct, align with updateStatus pattern

The `handleCancelledSideEffects` already has:
1. Idempotent MS release (via `hasExistingRestock`)
2. PI release for all items

No changes needed here — it's the REFERENCE pattern that `updateStatus` Cancelled should follow.

- [ ] **Step 1:** Verify `handleCancelledSideEffects` is correct (no changes needed)
- [ ] **Step 2:** Commit: `git commit -m "chore: verified handleCancelledSideEffects is correct reference pattern"`

#### Task 1.10: Fix handleConfirmedSideEffects — remove redundant reservePhysical

The `handleConfirmedSideEffects` method currently calls `verifyStockForOrder` (which allocates PI) AND then does a separate `reservePhysical` loop. Remove the separate loop since `verifyStockForOrder` handles allocation.

- [ ] **Step 1:** Remove the `reservePhysical` loop from `handleConfirmedSideEffects` (lines 1855-1876 in original)
- [ ] **Step 2:** Build
- [ ] **Step 3:** Commit

---

### Phase 2: Dispatch + POS

#### Task 2.1: Fix dispatch — HANDED_OVER uses router, RETURNED/DAMAGED skip stock

**File:** Modify `apps/backend/src/dispatch/dispatch.service.ts`

Replace the full stock block (lines 200-250):

```typescript
if (status === 'HANDED_OVER' || status === 'RETURNED' || status === 'DAMAGED') {
  if (status === 'RETURNED' || status === 'DAMAGED') {
    // Skip stock entirely — HANDED_OVER already consumed PI.
    // Order-level Returned handles restore via handleReturnedSideEffects.
    // DAMAGED is carrier claim; stock already consumed at HANDED_OVER.
    continue;
  }

  // HANDED_OVER: deduct stock
  const items = productMapping?.length ? productMapping : await this.getOrderItemsForStock(dispatch.orderId);
  const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
  const reference = `Dispatch DEDUCT: ${dispatch.consignmentId}`;

  for (const item of items) {
    const qty = item.quantity || 1;
    const productId = item.productId;
    const variantId = item.productVariantId || item.variantId;
    if (!productId) continue;

    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { availabilityMode: true, syncManagedStock: true, warehouseId: true },
    });
    if (!product) continue;

    const d = this.stockRouter.resolve(product.availabilityMode, 'deduct', imEnabled);

    // MS deduct (conditional)
    if (d.ms !== 'skip') {
      const skipMs = d.msConditionalOnSync && !product.syncManagedStock;
      if (!skipMs) {
        await this.stockService.operate('deduct', {
          productId, variantId, quantity: qty, reference,
          performedBy: performedBy || 'system', tx,
        });
      }
    }

    // PI fulfill (unconditional when IM ON)
    if (d.pi !== 'skip') {
      if (!product.warehouseId) continue;
      const orderItems = await tx.orderItem.findMany({
        where: { orderId: dispatch.orderId, productId },
        select: { id: true },
      });
      for (const oi of orderItems) {
        await this.stockService.fulfillPhysicalReservation({
          orderId: dispatch.orderId, orderItemId: oi.id,
          quantity: qty, reference, performedBy: performedBy || 'system', tx,
        });
      }
    }
  }
}
```

- [ ] **Step 1:** Rewrite dispatch stock block
- [ ] **Step 2:** Build
- [ ] **Step 3:** Commit

#### Task 2.2: Fix POS — IM ON uses PI only (session.showroom.id), IM OFF uses router

**File:** Modify `apps/backend/src/pos/pos-orders.service.ts`

```typescript
// Inside create() $transaction, replace the stock deduct block:

const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
const posWarehouseId = session.showroom?.id; // Warehouse from POS session

for (let i = 0; i < dto.items.length; i++) {
  const item = dto.items[i];
  const dbItem = createdItems[i];
  const product = item.productId
    ? await tx.product.findUnique({
        where: { id: item.productId },
        select: { availabilityMode: true, warehouseId: true, syncManagedStock: true, name: true },
      })
    : null;

  if (imEnabled) {
    // IM ON: POS always deducts from PI using session's showroom warehouse
    if (!posWarehouseId) {
      throw new BadRequestException('POS session has no showroom warehouse configured');
    }
    // Show physical stock availability
    const avail = await this.stockService.checkPhysicalAvailability(
      item.productId!, posWarehouseId, item.variantId,
    );
    if (!avail.available || avail.availableStock < item.quantity) {
      throw new BadRequestException(`Insufficient physical stock for "${product?.name || item.productId}"`);
    }
    // Deduct from PI only — MS never touched
    await this.stockService.deductPhysical({
      productId: item.productId!, variantId: item.variantId,
      quantity: item.quantity, warehouseId: posWarehouseId,
      reference: displayId, performedBy: cashierId, tx,
    });
  } else {
    // IM OFF: use availabilityMode routing
    if (product?.availabilityMode === 'INVENTORY_CONTROLLED') {
      throw new BadRequestException(`"${product.name}" is INVENTORY_CONTROLLED but IM is disabled`);
    }
    const d = this.stockRouter.resolve(product?.availabilityMode, 'deduct', imEnabled);
    if (d.ms !== 'skip') {
      await this.stockService.deduct({
        productId: item.productId, variantId: item.variantId,
        comboId: item.comboId, comboSelection: item.comboSelection,
        quantity: item.quantity, reference: displayId,
        performedBy: cashierId, tx,
      });
    }
  }
}
```

- [ ] **Step 1:** Inject `StockRouterService` into `PosOrdersService`
- [ ] **Step 2:** Rewrite the stock deduct block
- [ ] **Step 3:** Build
- [ ] **Step 4:** Commit

---

### Phase 3: Controllers + Services

#### Tasks 3.1-3.6: Same as original plan — add IM guards, fix stockOverview, fix adjust, fix products service

(No changes needed from original plan for these — they don't touch the routing logic.)

- [ ] **Task 3.1:** Add `InventoryEnabledGuard` to `PhysicalInventoryController`
- [ ] **Task 3.2:** Add `InventoryEnabledGuard` to physical endpoints in `InventoryController`
- [ ] **Task 3.3:** Fix `stockOverview` — hide PI stock when IM OFF
- [ ] **Task 3.4:** Fix `InventoryService.adjust` — add IM gate for IC
- [ ] **Task 3.5:** (Already done in 0.4 — `applyStockChange` blocks IC MS mutations)
- [ ] **Task 3.6:** Fix `ProductsService` — IC only when IM ON, validate BEFORE DB write

---

### Phase 4: UI Fixes

#### Task 4.1: Fix Inventory Overview (index.tsx) — H1, H2, H5, H6, M1, M2

- [ ] **Step 1:** Fix On Hand → `managedStockQuantity` for MANAGED_STOCK (H1)
- [ ] **Step 2:** Fix Reserved/Allocated → actual values from API response (H2)
- [ ] **Step 3:** Fix status badge → use `lowStockQty` as threshold (H5)
- [ ] **Step 4:** Fix variant row → consistent with parent row logic (H6)
- [ ] **Step 5:** Fix warehouse column → don't show "Main Warehouse" for managed (M2)
- [ ] **Step 6:** Fix physical view → read `availabilityMode` from real data (M1)
- [ ] **Step 7:** Build (`npx tsc --noEmit`) → no errors
- [ ] **Step 8:** Commit

#### Task 4.2: Fix Inventory Detail (detail.tsx) — H3

- [ ] **Step 1:** Fix stat cards: Available = `managedStockQuantity - reservedStock`, On Hand = `managedStockQuantity`, Reserved = `reservedStock`, Allocated = PI allocated or "—"
- [ ] **Step 2:** Fix Locations tab — hide for non-IC products
- [ ] **Step 3:** Build → no errors
- [ ] **Step 4:** Commit

#### Task 4.3: Fix Quick Adjustment Modal (M3)

- [ ] **Step 1:** Add proper warning for IC products ("Use physical inventory adjustment instead")
- [ ] **Step 2:** Improve disable reason tooltip
- [ ] **Step 3:** Build → no errors
- [ ] **Step 4:** Commit

#### Task 4.4: Fix Inventory Detail Drawer (M4)

- [ ] **Step 1:** Only fetch `/inventory/physical` when `availabilityMode === 'INVENTORY_CONTROLLED'`
- [ ] **Step 2:** Hide Locations tab for non-IC products
- [ ] **Step 3:** Build → no errors
- [ ] **Step 4:** Commit

#### Task 4.5: Fix Products Table Stock Column (H4, M7)

- [ ] **Step 1:** Stock cell shows "∞" for ALWAYS_IN_STOCK, "0" for ALWAYS_OUT_OF_STOCK, "Physical" badge for INVENTORY_CONTROLLED, numeric for MANAGED_STOCK
- [ ] **Step 2:** Use `availabilityMode` instead of legacy `manageStock`
- [ ] **Step 3:** Build → no errors
- [ ] **Step 4:** Commit

#### Task 4.6: Fix Product Form (M5, L3, M9) — clear stale data, hide bulk stock for non-MS, disable IC when IM OFF

- [ ] **Step 1:** Clear `managedStockQuantity` when mode changes away from MANAGED_STOCK
- [ ] **Step 2:** Hide bulk stock override for non-MANAGED_STOCK modes
- [ ] **Step 3:** Disable INVENTORY_CONTROLLED option when IM OFF
- [ ] **Step 4:** Build → no errors
- [ ] **Step 5:** Commit

#### Task 4.7: Fix Overview counts (M8)

- [ ] **Step 1:** Exclude ALWAYS_OUT_OF_STOCK from "In Stock" count
- [ ] **Step 2:** Build → no errors
- [ ] **Step 3:** Commit

#### Task 4.8: Fix Physical Stock Table (L2) — add mode badge

- [ ] **Step 1:** Add availability mode column showing IC/MS badge
- [ ] **Step 2:** Build → no errors
- [ ] **Step 3:** Commit

#### Task 4.9: Fix History page (L4)

- [ ] **Step 1:** Handle different response shapes between physical and managed ledger endpoints
- [ ] **Step 2:** Build → no errors
- [ ] **Step 3:** Commit
