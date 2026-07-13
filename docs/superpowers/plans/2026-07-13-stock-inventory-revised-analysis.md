# Revised Analysis: 9 Critical Points

## Point 1: `MANAGED_THEN_PHYSICAL` routing is ambiguous

### Code Evidence

**dispatch.service.ts:221-223** — HANDED_OVER deduct logic:
```typescript
const isManaged = product?.availabilityMode === 'MANAGED_STOCK' || product?.availabilityMode === 'ALWAYS_IN_STOCK';
const shouldManagedDeduct = operation === 'deduct'
  ? (isManaged && product?.syncManagedStock)    // ← conditional on syncManagedStock
  : isManaged;
```

So at HANDED_OVER for MANAGED_STOCK:
- `syncManagedStock=true` → MS deduct + PI fulfill (dual)
- `syncManagedStock=false` → PI fulfill only, MS NOT deducted

**pos-orders.service.ts:214-224** — POS immediate deduct (no IM check, no PI):
```typescript
await this.stock.deduct({...});  // Always MS deduct, no PI at all
```

**handleReturnedSideEffects:1944-1965** — Return restore:
- MANAGED_STOCK → `stockService.add()` (MS only, no PI)
- INVENTORY_CONTROLLED → `stockService.addPhysical()` (PI only)

### Problem

`MANAGED_THEN_PHYSICAL` engine implies "always do both." But for `deduct`, MS part is conditional on `syncManagedStock`. For `add` (return), if fulfillment was physical, PI restore is needed regardless of syncManagedStock. A single-engine enum can't express this.

### Resolution

Replace single `engine` with compound decision:

```typescript
interface RouterDecision {
  ms: 'reserve' | 'deduct' | 'add' | 'release' | 'scrap' | 'skip';
  pi: 'allocate' | 'fulfill' | 'add' | 'release' | 'skip';
  msConditional: boolean; // true = skip MS unless syncManagedStock=true (deduct only)
  piConditional: boolean; // true = skip PI unless IM stock was actually consumed
}
```

Full routing matrix (replacing the table in the original plan):

| IM | Mode | reserve | allocate (confirm) | deduct (HANDED_OVER) | add (return) | release (cancel) | scrap |
|----|------|---------|-------------------|---------------------|-------------|-----------------|-------|
| OFF | MS | ms=reserve, pi=skip | ms=skip, pi=skip | ms=deduct, pi=skip | ms=add, pi=skip | ms=release, pi=skip | ms=scrap, pi=skip |
| OFF | IC | **BLOCK** | **BLOCK** | **BLOCK** | **BLOCK** | **BLOCK** | **BLOCK** |
| ON | MS | ms=reserve, pi=skip | ms=skip, pi=allocate | ms=deduct, pi=fulfill, msCond=true | ms=add, pi=add, msCond=true | ms=release, pi=release | ms=scrap, pi=skip |
| ON | IC | ms=skip, pi=allocate | ms=skip, pi=check | ms=skip, pi=fulfill | ms=skip, pi=add | ms=skip, pi=release | ms=skip, pi=skip |

For POS (`deduct` at create — no reserve phase):

| IM | Mode | POS deduct |
|----|------|------------|
| OFF | MS | ms=deduct, pi=skip |
| OFF | IC | BLOCK |
| ON | MS | ms=deduct, pi=deduct, msCond=true |
| ON | IC | ms=skip, pi=deduct |

`msConditional=true` → caller checks `syncManagedStock`: if true, execute MS action; if false, skip MS action. Used only on `deduct` and `add` (return) operations.

---

## Point 2: IC reservation identity — synthetic vs real OrderItem.id

### Code Evidence

**orders.service.ts:706-716** — order CREATE uses synthetic lineId:
```typescript
const lineId = `${created.id}:${item.productId}:${item.variantId || 'default'}`;
await this.stockService.reservePhysicalAllocated({
  orderId: created.id,
  orderItemId: lineId,           // ← SYNTHETIC, not a real OrderItem.id
  ...
});
```

But created items don't exist yet at this point — they're created later in the same transaction. So synthetic ID is a workaround.

**orders.service.ts:2061-2069** — confirm uses real OrderItem.id:
```typescript
await this.stockService.reservePhysicalAllocated({
  orderItemId: item.id,           // ← REAL OrderItem.id
  ...
});
```

**dispatch.service.ts:240-245** — HANDED_OVER uses real OrderItem.id:
```typescript
const orderItems = await tx.orderItem.findMany({...});
for (const oi of orderItems) {
  await this.stockService.fulfillPhysicalReservation({
    orderItemId: oi.id,           // ← REAL OrderItem.id
    ...
  });
}
```

**orders.service.ts:1899-1904** — Cancel via `transitionOrderStatus` uses real OrderItem.id:
```typescript
for (const item of order.items) {
  await this.stockService.releasePhysicalAllocated({
    orderItemId: item.id,         // ← REAL OrderItem.id
    ...
  });
}
```

### Impact

For IC products:
1. **Create**: reservation created with `orderItemId = "orderId:productId:variantId"` (synthetic)
2. **Confirm**: `verifyStockForOrder` for IC only checks availability (line 2074-2084), does NOT create new reservation → correct
3. **Cancel**: tries `releasePhysicalAllocated({orderItemId: item.id})` → `findUnique` by real OrderItem.id → NOT FOUND → NO-OP → **synthetic reservation stays orphaned in ALLOCATING state**
4. **HANDED_OVER**: tries `fulfillPhysicalReservation({orderItemId: oi.id})` → real OrderItem.id → NOT FOUND → NO-OP → **synthetic reservation never consumed**

For MANAGED_STOCK at confirm:
1. **Confirm**: calls `reservePhysicalAllocated({orderItemId: item.id})` — real ID → creates NEW reservation (separate from create's MS reservation which was MS-only)
2. **Cancel**: releases by real OrderItem.id → correctly finds the confirm reservation
3. **HANDED_OVER**: fulfills by real OrderItem.id → correctly finds the confirm reservation

So: **MANAGED_STOCK works correctly** (confirm creates the reservation, cancel/fulfill find it). **IC creates an orphaned synthetic reservation** that is never canceled or fulfilled.

### Resolution

For IC products: **remove synthetic ID approach**. Create order items BEFORE creating the reservation, then use the real OrderItem.id:

```typescript
// 1. First create all order items
for (const item of dto.items) {
  await tx.orderItem.create({...});
}

// 2. Then fetch the created items
const createdItems = await tx.orderItem.findMany({ where: { orderId: created.id } });

// 3. Create reservations using real IDs
for (const item of dto.items) {
  const dbItem = createdItems.find(i => i.productId === item.productId && i.variantId === item.variantId);
  if (isIC && product?.warehouseId) {
    await this.stockService.reservePhysicalAllocated({
      orderId: created.id,
      orderItemId: dbItem!.id,    // ← REAL ID
      ...
    });
  } else {
    await this.stockService.reserve({...});
  }
}
```

---

## Point 3: `reservePhysicalAllocated` ignores outer transaction

### Code Evidence

**stock.service.ts:854-867** — Phase 1 uses `this.prisma` directly:
```typescript
async reservePhysicalAllocated(params: {
  orderId: string; orderItemId: string; productId: string;
  variantId?: string; warehouseId: string; quantity: number;
  tx?: Prisma.TransactionClient;      // ← PARAM EXISTS
}) {
  const parent = await this.prisma.physicalReservation.upsert({...});  // ← IGNORES params.tx
```

**stock.service.ts:906-977** — Phase 3 opens its OWN transaction:
```typescript
return await this.prisma.$transaction(async (tx) => {   // ← NESTED TX, ignores outer tx
  ...
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
```

Also, `fulfillPhysicalReservation` has the same issue (line 1038):
```typescript
const client = params.tx || this.prisma;   // ← Uses tx for reads/writes
// Then:
const [claimed] = await client.$transaction([...]);  // ← BUG: TransactionClient has no $transaction
```

`Prisma.TransactionClient` does NOT have a `$transaction` method. If `params.tx` is provided, `client.$transaction(...)` would throw at runtime.

### Impact

- Caller's outer transaction cannot atomically include PI reservation
- If outer transaction rolls back, Phase 1 upsert persists in DB
- If `fulfillPhysicalReservation` called with outer tx, it crashes

### Resolution

Split `reservePhysicalAllocated` into two phases the caller can coordinate:

```typescript
async reservePhysicalAllocated(params: {
  orderId: string; orderItemId: string; productId: string;
  variantId?: string; warehouseId: string; quantity: number;
  tx: Prisma.TransactionClient;    // ← MANDATORY
}) {
  // Phase 1: upsert
  const parent = await params.tx.physicalReservation.upsert({
    where: { orderItemId: params.orderItemId },
    create: { ... },
    update: {},
  });

  // Phase 2: check existing + allocate (same transaction via params.tx)
  const allocs = await params.tx.physicalReservationAllocation.findMany({
    where: { reservationId: parent.id },
  });
  if (allocs.length > 0) return allocs;

  // Phase 3: allocate bins
  // Use SELECT ... FOR UPDATE inside the existing transaction
  // No separate $transaction needed
  const eligible = await params.tx.physicalInventory.findMany({
    where: { productId: params.productId, warehouseId: params.warehouseId },
    orderBy: { updatedAt: 'asc' },
  });
  // ... allocate loop ...
}
```

And fix `fulfillPhysicalReservation` to NOT call `client.$transaction()`:

```typescript
async fulfillPhysicalReservation(params: {
  orderId: string; orderItemId: string; quantity: number;
  reference: string; performedBy?: string;
  tx: Prisma.TransactionClient;    // ← MANDATORY
}) {
  // Remove the inner $transaction call entirely
  // The caller's outer transaction provides atomicity
  const [claimed] = await params.tx.physicalReservation.updateMany({
    where: { id: parent.id, status: 'ACTIVE' },
    data: { status: 'CONSUMED' },
  });
  // ... rest of fulfillment ...
}
```

Transaction boundary rule: **ALL callers must already be inside `$transaction` when calling these methods.** Remove the internal transaction creation. The SERIALIZABLE isolation and retry logic moves to the caller level.

---

## Point 4: Confirm managed availability check — double-count analysis

### Code Evidence

**verifyStockForOrder:2045-2056**:
```typescript
if (product.availabilityMode === 'MANAGED_STOCK') {
  if (!product.manageStock) continue;
  const avail = await this.stockService.getAvailableStock(item.productId!, item.variantId ?? undefined);
  // avail.available = managedStockQuantity - reservedStock
  if (avail.available < item.quantity) {
    throw new BadRequestException(...);
  }
```

By the time Confirm fires, `reservedStock` already includes this order's reservation (created at Create time). So `available = managedStockQuantity - (thisOrder + otherOrders).reservedStock`.

### Verdict: CORRECT

The check `available < item.quantity` correctly accounts for ALL reservations including this order's own. Between Create and Confirm, if another order's HANDED_OVER consumed stock → `managedStockQuantity` is lower → `available` correctly reflects the reduction. If another order's reservation was added → `reservedStock` is higher → `available` correctly reflects it.

**No double-count issue.** The original plan is correct here.

---

## Point 5: Cancel — double MS release in `updateStatus`

### Code Evidence

**updateStatus:1067-1085**:
```typescript
if (newStatus.name === 'Cancelled') {
  // Step A: per-item MS release (reservedStock decrement)
  for (const item of cancelItems) {
    await this.stockService.release({
      productId: item.productId || undefined,
      variantId: item.variantId || undefined,
      quantity: item.quantity,
      reference: order.displayId,    // ← reference = "ORD-1234"
      tx,
    });
  }

  // Step B: releaseStockForCancelledOrder — ANOTHER MS release
  await this.releaseStockForCancelledOrder(id, tx);
}
```

Step A: calls `stockService.release()` → writes `ManagedStockLedger` with `type=CANCEL_RELEASE`, `referenceId=order.displayId` (e.g., "ORD-1234")

Step B: `releaseStockForCancelledOrder` → checks `hasExistingRestock(orderId)` where `orderId` is UUID → looks for `referenceId=UUID` in ledger → doesn't find Step A's entry (which has `referenceId="ORD-1234"`) → **proceeds to release again**.

### Impact

For a MANAGED_STOCK product with qty=5, reservedStock goes from 5 to -5:
- Step A: `reservedStock -= 5` → 0
- Step B: `reservedStock -= 5` → -5

This inflates `availableStock = managedStockQuantity - reservedStock` = managedStockQuantity - (-5) = managedStockQuantity + 5 → shows more available stock than actually exists.

### Resolution

**Option A (recommended):** Merge the two paths. Remove Step A's per-item release entirely. Let `releaseStockForCancelledOrder` be the single MS release path (it has idempotency check).

```typescript
if (newStatus.name === 'Cancelled') {
  // Single MS release path (idempotent via ledger)
  await this.releaseStockForCancelledOrder(id, tx);

  // Release PI reservation (for IM ON products)
  const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
  if (imEnabled) {
    const cancelItems = await tx.orderItem.findMany({ where: { orderId: id } });
    for (const item of cancelItems) {
      await this.stockService.releasePhysicalAllocated({
        orderId: id,
        orderItemId: item.id,
        tx,
      });
    }
  }
}
```

**Option B:** Fix `hasExistingRestock` to search by both `referenceId=order.id` AND `referenceId=order.displayId`.

Recommend Option A — it's cleaner and matches `transitionOrderStatus` → `handleCancelledSideEffects` which already does this correctly.

---

## Point 6: Return routing — missing PI restore for MANAGED_STOCK

### Code Evidence

**handleReturnedSideEffects:1944-1965**:
```typescript
// MANAGED_STOCK: MS restore only
if (product.availabilityMode === 'MANAGED_STOCK' && product.manageStock) {
  await this.stockService.add({...});  // MS increment only
}

// INVENTORY_CONTROLLED: PI restore only
if (product.availabilityMode === 'INVENTORY_CONTROLLED' && product.warehouseId) {
  await this.stockService.addPhysical({...});  // PI increment only
}
```

When IM ON + MANAGED_STOCK product's order was fulfilled:
- HANDED_OVER deducted PI (+ optionally MS if `syncManagedStock=true`)
- Return restores MS only — PI stays deducted

### Resolution

Return routing must mirror the HANDED_OVER deduction. If PI was deducted (always, since IM ON), PI must be restored. MS restore is conditional on whether MS was also deducted (syncManagedStock):

```typescript
if (product.availabilityMode === 'MANAGED_STOCK') {
  const route = this.stockRouter.resolve('MANAGED_STOCK', 'add', imEnabled);
  // route.ms = 'add', route.pi = 'add', route.msConditional = true

  // Restore MS only if syncManagedStock (MS was deducted at HANDED_OVER)
  if (route.msConditional) {
    // Check syncManagedStock — only restore MS if it was originally deducted
    if (product.syncManagedStock) {
      await this.stockService.add({...});
    }
  } else {
    await this.stockService.add({...});
  }

  // Restore PI unconditionally (PI was always deducted at HANDED_OVER when IM ON)
  if (route.pi !== 'skip' && product.warehouseId) {
    await this.stockService.addPhysical({...});
  }
}
```

For INVENTORY_CONTROLLED: PI restore only (MS was never involved). Current code is correct.

---

## Point 7: Dispatch RETURNED/DAMAGED — full audit

### Code Evidence

**dispatch.service.ts:200-250**:
```typescript
if (status === 'HANDED_OVER' || status === 'RETURNED' || status === 'DAMAGED') {
  const operation = status === 'HANDED_OVER' ? 'deduct' : status === 'RETURNED' ? 'add' : 'scrap';

  // Managed stock (lines 214-232)
  const shouldManagedDeduct = operation === 'deduct'
    ? (isManaged && product?.syncManagedStock)
    : isManaged;
  if (shouldManagedDeduct) {
    await this.stockService.operate(operation, {...});
  }

  // Physical reservation (lines 234-248) — HANDED_OVER ONLY
  if (status === 'HANDED_OVER' && productId) {
    // PI fulfillment
  }
}
```

### Current behavior matrix for dispatch:

| Status | MS action | PI action |
|--------|-----------|-----------|
| HANDED_OVER | deduct (if syncManagedStock) | fulfillPhysicalReservation (if IM ON) |
| RETURNED | add (unconditional) | NONE |
| DAMAGED | scrap (unconditional) | NONE |

### Issues

1. **RETURNED in dispatch doesn't restore PI.** When the courier returns a product, the PI was already consumed at HANDED_OVER. The dispatch RETURNED should restore PI inventory. Currently it only restores MS.

2. **DAMAGED in dispatch doesn't scrap PI.** When a product is damaged in transit, PI was already consumed at HANDED_OVER. So PI is already deducted. But what about the costing lot/Cost of Goods? The physical inventory should NOT be restored because the product is gone — but the costing lot consumption is already done at HANDED_OVER. This is actually correct as-is: HANDED_OVER consumes PI + costing lots, DAMAGED only adjusts MS for financial tracking. PI doesn't need to move because it was already consumed.

3. **Order-level Returned vs dispatch RETURNED**: These are separate statuses on different entities. The order's `handleReturnedSideEffects` restores stock when the ORDER status changes. The dispatch RETURNED restores stock when the DISPATCH status changes. If both fire, stock gets double-restored. Need idempotency guard.

### Resolution

| Dispatch Status | MS action | PI action |
|----------------|-----------|-----------|
| HANDED_OVER | deduct (if syncManagedStock) | fulfillPhysicalReservation (if IM ON) |
| RETURNED | add (if syncManagedStock) | addPhysical (if IM ON + was fulfilled via PI) |
| DAMAGED | scrap (unconditional) | NONE (PI already consumed at HANDED_OVER) |

Add idempotency check: before dispatch RETURNED restores stock, check if order's own `handleReturnedSideEffects` already ran (via `hasExistingRestock`). If yes, skip both MS and PI restore in dispatch.

---

## Point 8: ProductsService — INVENTORY_CONTROLLED validation timing

### Code Evidence

**products.service.ts:542-546** — create():
```typescript
const avMode: string =
  dto.type === 'variable' ? 'MANAGED_STOCK'
  : dto.availabilityMode ||
    (dto.manageStock ? 'MANAGED_STOCK' : 'INVENTORY_CONTROLLED');
  // ← DEFAULT IS INVENTORY_CONTROLLED WHEN manageStock=false

const product = await this.prisma.product.create({
  data: {
    ...
    availabilityMode: avMode as any,    // ← WRITTEN TO DB
    ...
  },
});
// ← NO IM CHECK AFTER WRITE — mode is already persisted
```

**products.service.ts:748-753** — update():
```typescript
const newMode: string | undefined =
  dto.availabilityMode ??
  (dto.manageStock !== undefined
    ? dto.manageStock ? 'MANAGED_STOCK' : 'INVENTORY_CONTROLLED'
    : undefined);
```

Then:
```typescript
if (newMode && newMode !== p.availabilityMode) {
  // ... proceed with update — NO IM CHECK
}
```

### Verdict

The IM state check (from plan Task 3.6) adds `if (newMode === 'INVENTORY_CONTROLLED' && !imEnabled) { throw ... }` BEFORE the DB write. This is correct — the validation must be BETWEEN computing `newMode` and writing to DB.

However, the default fallback to `INVENTORY_CONTROLLED` when `manageStock=false` is also problematic: if a product already existed with `manageStock=false` and gets updated with `dto.manageStock !== undefined` but `dto.availabilityMode` not set, the transition to IC happens implicitly. This is a data integrity issue.

### Resolution

**Validation must be BEFORE `prisma.product.create/update`**, not after. Check IM state right after computing `avMode`/`newMode`:

```typescript
const imEnabled = await this.stockRouter.isInventoryManagementEnabled();

// In create:
const avMode: string =
  dto.type === 'variable' ? 'MANAGED_STOCK'
  : dto.availabilityMode ||
    (dto.manageStock ? 'MANAGED_STOCK' : (imEnabled ? 'INVENTORY_CONTROLLED' : 'MANAGED_STOCK'));

if (avMode === 'INVENTORY_CONTROLLED' && !imEnabled) {
  throw new BadRequestException('...');
}
// THEN: await prisma.product.create(...)

// In update:
const newMode = dto.availabilityMode ??
  (dto.manageStock !== undefined
    ? dto.manageStock ? 'MANAGED_STOCK' : (imEnabled ? 'INVENTORY_CONTROLLED' : 'MANAGED_STOCK')
    : undefined);

if (newMode === 'INVENTORY_CONTROLLED' && !imEnabled) {
  throw new BadRequestException('...');
}
```

Also: when IM is OFF, the default should be `MANAGED_STOCK`, not `INVENTORY_CONTROLLED`.

---

## Point 9: Router architecture — compound decision needed

### Code Evidence

Looking at all the routing decisions required (gathered from Points 1-8):

For MANAGED_STOCK + deduct (HANDED_OVER):
- What MS should do: deduct (conditional on syncManagedStock)
- What PI should do: fulfill (unconditional when IM ON)

For MANAGED_STOCK + add (return):
- What MS should do: add (conditional on syncManagedStock)
- What PI should do: add (unconditional when IM ON)

For MANAGED_STOCK + release (cancel):
- What MS should do: release (unconditional — always release MS reservation)
- What PI should do: release (unconditional when IM ON)

For MANAGED_STOCK + scrap (damaged):
- What MS should do: scrap (unconditional)
- What PI should do: skip (already consumed at HANDED_OVER)

### Resolution: `StockEngineDecision` with compound actions

Replace the single `engine` enum with:

```typescript
export type StockAction = 'reserve' | 'release' | 'deduct' | 'add' | 'scrap' | 'fulfill' | 'allocate' | 'check' | 'skip';

export interface StockEngineDecision {
  ms: StockAction;
  pi: StockAction;
  msConditionalOnSync: boolean;
  // msConditionalOnSync=true means:
  //   - For deduct/fulfill: only execute ms if syncManagedStock=true
  //   - For add (return): only restore ms if syncManagedStock=true
  //   - For release: always execute (reservation always released)
}

// Full routing matrix in code:
resolve(
  availabilityMode: string | null | undefined,
  opType: string,
  imEnabled: boolean,
): StockEngineDecision {
  const DECISIONS = {
    // [IM_STATE][MODE][OPTYPE]: { ms, pi, msConditionalOnSync }
  };
}
```

The caller pattern becomes:

```typescript
const d = this.stockRouter.resolve(product.availabilityMode, 'deduct', imEnabled);

// Execute MS action (with conditional check)
if (d.ms !== 'skip') {
  if (!d.msConditionalOnSync || product.syncManagedStock) {
    await this.stockService.operate(d.ms, {...});
  }
}

// Execute PI action
if (d.pi !== 'skip' && product.warehouseId) {
  if (d.pi === 'fulfill') {
    await this.stockService.fulfillPhysicalReservation({...});
  } else {
    await this.stockService.operatePhysical(d.pi as any, {...});
  }
}
```

This pattern is used consistently across ALL callers: orders (create/confirm/cancel/return/addItem/removeItem/trash/updateOrder), dispatch (HANDED_OVER/RETURNED/DAMAGED), POS.

---

## Revised Architecture — Consolidated

```
┌────────────────────────────────────────────────────────┐
│                    StockRouter                          │
│  resolve(mode, opType, imEnabled) → EngineDecision     │
│    { ms, pi, msConditionalOnSync }                     │
│                                                        │
│  isInventoryManagementEnabled() → bool                 │
└────────────────────────────────────────────────────────┘
         │                    ▲
         ▼                    │
┌────────────────────────────────────────────────────────┐
│              Caller Pattern (in every service):         │
│                                                        │
│  const d = router.resolve(mode, type, imEnabled);      │
│  if (d.ms !== 'skip') {                                │
│    exec MS action (skip if msConditionalOnSync=false)    │
│  }                                                      │
│  if (d.pi !== 'skip') {                                 │
│    exec PI action                                       │
│  }                                                      │
└────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ StockService                    │
│  operate() → MS engine          │
│  operatePhysical() → PI engine  │
│  reservePhysicalAllocated(tx)   │ ← tx REQUIRED now
│  fulfillPhysicalReservation(tx) │ ← tx REQUIRED now
│  releasePhysicalAllocated(tx)   │ ← tx REQUIRED now
└─────────────────────────────────┘
```

### Transaction boundary rule (NEW)

All `reservePhysicalAllocated`, `fulfillPhysicalReservation`, `releasePhysicalAllocated` now require a `tx: Prisma.TransactionClient` parameter. They do NOT create their own inner transactions. The caller is responsible for providing the outer transaction:

```typescript
// CORRECT:
return this.prisma.$transaction(async (tx) => {
  const d = router.resolve(mode, 'deduct', imEnabled);
  if (d.pi === 'fulfill') {
    await stockService.fulfillPhysicalReservation({
      ..., tx,      // ← passed from outer transaction
    });
  }
});

// NOT ALLOWED:
await stockService.fulfillPhysicalReservation({...}); // no tx → compile error
```

---

## Summary: What changes from the original plan

| Point | Original plan | Revised |
|-------|--------------|---------|
| 1 | `MANAGED_THEN_PHYSICAL` | Compound `{ ms, pi, msConditionalOnSync }` — no ambiguous engine enum |
| 2 | Overlooked synthetic ID bug | Create order items first, use real OrderItem.id for reservation |
| 3 | Overlooked tx boundary bug | `tx` becomes REQUIRED; remove inner `$transaction` calls |
| 4 | Incorrectly flagged as double-count | VERIFIED CORRECT — no change needed |
| 5 | Overlooked double release | Remove Step A per-item release; single `releaseStockForCancelledOrder` path |
| 6 | Return routing wrong | Add PI restore for MANAGED_STOCK when IM ON; conditional on msAction |
| 7 | Only HANDED_OVER audited | Fixed RETURNED/DAMAGED PI routing + idempotency guard |
| 8 | OK conceptually | Exact validation placement confirmed — before DB write |
| 9 | Single `engine` enum | Compound `{ ms, pi, msConditionalOnSync }` — cleaner caller pattern |
