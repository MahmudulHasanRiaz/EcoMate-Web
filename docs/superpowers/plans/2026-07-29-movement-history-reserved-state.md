# Movement History — Reserved State Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `reservedBefore`/`reservedAfter` capture to both `ManagedStockLedger` and `PhysicalInventoryLedger` so Reserve/Release/OrderDeduction events show their full state transition.

**Architecture:** Add 2 nullable columns to each ledger table. Backend populates them at the 4 call sites where a reserved-state transition coincides with ledger entry creation (reserve/release/deduct on managed side, deduct/fulfill on physical side). Frontend adds 2 columns to the movement history tables. Existing data is unchanged (null).

**Tech Stack:** Prisma 7, NestJS 11, React 19, TanStack Query

## Global Constraints

- No business logic changes — reservation, release, deduction, fulfillment flows remain identical.
- No new audit event types — no extra ledger rows for physical reserve/release.
- Nullable columns — no backfill needed; existing rows get `reservedBefore=null, reservedAfter=null`.
- Available = stock - reserved is computed in frontend, not stored.
- Both ledgers follow the same column naming and pattern.
- Run `npx prisma migrate dev --name add_reserved_state_to_ledgers` then `npx prisma generate` after schema change.
- Run `npm run build --workspace=backend` before claiming backend changes complete.
- Run `npm run build --workspace=admin` before claiming frontend changes complete.

---

### Task 1: Prisma Schema + Migration

**Files:**
- Modify: `apps/backend/prisma/schema.prisma` — add `reservedBefore Int?` and `reservedAfter Int?` to `ManagedStockLedger` model (around line 1242) and `PhysicalInventoryLedger` model (around line 1150)
- Create: migration files via `prisma migrate dev`

- [ ] **Step 1: Add columns to ManagedStockLedger model**

Edit `apps/backend/prisma/schema.prisma`. After `stockAfter Int?` on the ManagedStockLedger model (line 1243-1244), add:
```
  reservedBefore Int?
  reservedAfter  Int?
```

- [ ] **Step 2: Add columns to PhysicalInventoryLedger model**

Edit the same file. After `stockAfter Int` on the PhysicalInventoryLedger model (line 1151), add:
```
  reservedBefore Int?
  reservedAfter  Int?
```

Note: `stockBefore`/`stockAfter` are required (`Int`) on PhysicalInventoryLedger but optional (`Int?`) on ManagedStockLedger. The new columns are optional (`Int?`) on both.

- [ ] **Step 3: Run migration**

```bash
cd apps/backend
npx prisma migrate dev --name add_reserved_state_to_ledgers
npx prisma generate
```

Verify migration SQL in `apps/backend/prisma/migrations/<timestamp>_add_reserved_state_to_ledgers/migration.sql` contains two `ALTER TABLE ADD COLUMN` statements (one per table).

- [ ] **Step 4: Verify build passes**

```bash
cd /Users/riaz/Custom Development Projects/EcoMate Web/.claude/worktrees/busy-mcclintock-ce4d9e
npm run build --workspace=backend
```

Expected: TypeScript compiles successfully (new fields available on Prisma client types).

---

### Task 2: Backend — ManagedStockLedgerService

**Files:**
- Modify: `apps/backend/src/inventory/managed-stock-ledger.service.ts

**Interfaces:**
- Consumes: `reservedBefore`/`reservedAfter` from Prisma client types (generated in Task 1)
- Produces: `ManagedStockLedgerService.record()` accepts optional `reservedBefore`/`reservedAfter`

- [ ] **Step 1: Extend record() params**

Edit `managed-stock-ledger.service.ts`. In the `record()` method signature, add optional fields to the params object:

Old (line 15-29):
```ts
async record(
    params: {
      productId?: string;
      variantId?: string;
      comboId?: string;
      quantity: number;
      direction: MovementDirection;
      type: ManagedStockMovementType;
      stockBefore?: number;
      stockAfter?: number;
      referenceType?: ReferenceEntity;
      referenceId?: string;
      note?: string;
      reason?: string;
      performedById?: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return client.managedStockLedger.create({
      data: {
        productId: params.productId ?? null,
        variantId: params.variantId ?? null,
        comboId: params.comboId ?? null,
        quantity: Math.abs(params.quantity),
        direction: params.direction,
        type: params.type,
        stockBefore: params.stockBefore ?? null,
        stockAfter: params.stockAfter ?? null,
        referenceType: params.referenceType ?? null,
        referenceId: params.referenceId ?? null,
        note: params.note ?? null,
        reason: params.reason ?? null,
        performedById: params.performedById ?? null,
      },
    });
  }
```

New — add `reservedBefore` and `reservedAfter`:
```ts
async record(
    params: {
      productId?: string;
      variantId?: string;
      comboId?: string;
      quantity: number;
      direction: MovementDirection;
      type: ManagedStockMovementType;
      stockBefore?: number;
      stockAfter?: number;
      reservedBefore?: number;   // NEW
      reservedAfter?: number;    // NEW
      referenceType?: ReferenceEntity;
      referenceId?: string;
      note?: string;
      reason?: string;
      performedById?: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return client.managedStockLedger.create({
      data: {
        productId: params.productId ?? null,
        variantId: params.variantId ?? null,
        comboId: params.comboId ?? null,
        quantity: Math.abs(params.quantity),
        direction: params.direction,
        type: params.type,
        stockBefore: params.stockBefore ?? null,
        stockAfter: params.stockAfter ?? null,
        reservedBefore: params.reservedBefore ?? null,  // NEW
        reservedAfter: params.reservedAfter ?? null,     // NEW
        referenceType: params.referenceType ?? null,
        referenceId: params.referenceId ?? null,
        note: params.note ?? null,
        reason: params.reason ?? null,
        performedById: params.performedById ?? null,
      },
    });
  }
```

- [ ] **Step 2: Verify build**

```bash
npm run build --workspace=backend
```

Expected: compiles cleanly.

---

### Task 3: Backend — StockService managed stock: reserve + release

**Files:**
- Modify: `apps/backend/src/stock/stock.service.ts

**Interfaces:**
- Consumes: `ManagedStockLedgerService.record()` with new `reservedBefore`/`reservedAfter` params (Task 2), and direct `prisma.managedStockLedger.create()` with new fields (Task 1)
- Produces: RESERVE/RELEASE ledger entries with populated `reservedBefore`/`reservedAfter`

- [ ] **Step 1: Capture reserved state in operate('reserve')**

Edit `stock.service.ts` around line 648-682. The reserve operation currently reads `managedStockQuantity` after the `applyStockChange` call (which increments `reservedStock`). It needs to also read `reservedStock`.

Current code (lines 648-682):
```ts
if (p?.availabilityMode === 'MANAGED_STOCK') {
    let currentStock = 0;
    if (t.variantId) {
      const v = await tx.productVariant.findUnique({
        where: { id: t.variantId },
        select: { managedStockQuantity: true },
      });
      currentStock = v?.managedStockQuantity ?? 0;
    } else {
      currentStock = p.managedStockQuantity ?? 0;
    }
    // ... orderId lookup ...
    await tx.managedStockLedger.create({
      data: {
        productId: t.productId,
        variantId: t.variantId,
        comboId: params.comboId ?? null,
        quantity: t.qty,
        direction: 'OUT',
        type: (params.ledgerType as any) || 'RESERVE',
        stockBefore: currentStock,
        stockAfter: currentStock,
        referenceType: 'ORDER',
        referenceId: orderId,
        performedById: params.performedBy || 'system',
        note: `Reserved for ${params.reference}`,
      },
    });
}
```

Change to read `reservedStock` alongside `managedStockQuantity`:
```ts
if (p?.availabilityMode === 'MANAGED_STOCK') {
    let currentStock = 0;
    let currentReserved = 0;
    if (t.variantId) {
      const v = await tx.productVariant.findUnique({
        where: { id: t.variantId },
        select: { managedStockQuantity: true, reservedStock: true },
      });
      currentStock = v?.managedStockQuantity ?? 0;
      currentReserved = v?.reservedStock ?? 0;
    } else {
      currentStock = p.managedStockQuantity ?? 0;
      currentReserved = p.reservedStock ?? 0;
    }
    // ... orderId lookup stays same ...
    await tx.managedStockLedger.create({
      data: {
        productId: t.productId,
        variantId: t.variantId,
        comboId: params.comboId ?? null,
        quantity: t.qty,
        direction: 'OUT',
        type: (params.ledgerType as any) || 'RESERVE',
        stockBefore: currentStock,
        stockAfter: currentStock,
        reservedBefore: currentReserved - t.qty,    // NEW: reserved before the increment
        reservedAfter: currentReserved,              // NEW: reserved after the increment
        referenceType: 'ORDER',
        referenceId: orderId,
        performedById: params.performedBy || 'system',
        note: `Reserved for ${params.reference}`,
      },
    });
}
```

Note: The `reservedStock` was already incremented by `applyStockChange(targets, 'reservedStock', 'increment', tx)` at line 634. So `currentReserved` is the POST-increment value. `reservedBefore = currentReserved - t.qty`, `reservedAfter = currentReserved`.

- [ ] **Step 2: Capture reserved state in operate('release')**

Same pattern as reserve. Edit around line 699-734. Current code reads `managedStockQuantity` after decrement of `reservedStock`. Change to also read `reservedStock`:

```ts
if (p?.availabilityMode === 'MANAGED_STOCK') {
    let currentStock = 0;
    let currentReserved = 0;
    if (t.variantId) {
      const v = await tx.productVariant.findUnique({
        where: { id: t.variantId },
        select: { managedStockQuantity: true, reservedStock: true },
      });
      currentStock = v?.managedStockQuantity ?? 0;
      currentReserved = v?.reservedStock ?? 0;
    } else {
      currentStock = p.managedStockQuantity ?? 0;
      currentReserved = p.reservedStock ?? 0;
    }
    // ... orderId lookup stays same ...
    await tx.managedStockLedger.create({
      data: {
        productId: t.productId,
        variantId: t.variantId,
        comboId: params.comboId ?? null,
        quantity: t.qty,
        direction: 'IN',
        type: (params.ledgerType as any) || 'RELEASE',
        stockBefore: currentStock,
        stockAfter: currentStock,
        reservedBefore: currentReserved + t.qty,    // NEW: reserved before the decrement
        reservedAfter: currentReserved,              // NEW: reserved after the decrement
        referenceType: 'ORDER',
        referenceId: orderId,
        performedById: params.performedBy || 'system',
        note: `Released for ${params.reference}`,
      },
    });
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build --workspace=backend
```

Expected: compiles cleanly.

---

### Task 4: Backend — StockService managed stock: deduct

**Files:**
- Modify: `apps/backend/src/stock/stock.service.ts`

**Interfaces:**
- Consumes: `logManagedStockLedger()` with new optional `reservedBefore`/`reservedAfter` params
- Produces: ORDER_DEDUCTION entries with reserved state transition (e.g., reserved 1→0)

- [ ] **Step 1: Extend logManagedStockLedger() signature**

Edit `stock.service.ts` around line 345-392. Add optional `reservedBefore`/`reservedAfter` params and pass them to the ledger create call.

Old signature:
```ts
  private async logManagedStockLedger(
    targets: StockTarget[],
    direction: Prisma.$ManagedStockLedgerPayload['scalars']['direction'],
    type: Prisma.$ManagedStockLedgerPayload['scalars']['type'],
    referenceType: Prisma.$ManagedStockLedgerPayload['scalars']['referenceType'],
    referenceId: string | undefined,
    performedBy: string | undefined,
    note: string | undefined,
    tx: Prisma.TransactionClient,
  ) {
```

New signature:
```ts
  private async logManagedStockLedger(
    targets: StockTarget[],
    direction: Prisma.$ManagedStockLedgerPayload['scalars']['direction'],
    type: Prisma.$ManagedStockLedgerPayload['scalars']['type'],
    referenceType: Prisma.$ManagedStockLedgerPayload['scalars']['referenceType'],
    referenceId: string | undefined,
    performedBy: string | undefined,
    note: string | undefined,
    tx: Prisma.TransactionClient,
    reservedBefore?: number,      // NEW
    reservedAfter?: number,       // NEW
  ) {
```

In the `create` call inside the loop (around line 375-390), add the new fields:
```ts
      await tx.managedStockLedger.create({
        data: {
          productId: t.productId,
          variantId: t.variantId,
          comboId: null,
          quantity: t.qty,
          direction,
          type,
          stockBefore,
          stockAfter,
          reservedBefore: reservedBefore ?? null,    // NEW
          reservedAfter: reservedAfter ?? null,       // NEW
          referenceType,
          referenceId,
          reason: note,
          performedById: performedBy,
        },
      });
```

- [ ] **Step 2: Pass reserved state at deduct call site**

Edit `operate('deduct')` around line 737-764. This calls `logManagedStockLedger` after `applyStockChange` has already decremented both `managedStockQuantity` and `reservedStock`.

The current code (line 737-764):
```ts
await this.applyStockChange(targets, 'managedStockQuantity', 'decrement', tx);
await this.applyStockChange(targets, 'reservedStock', 'decrement', tx);
// ...
await this.logManagedStockLedger(targets, 'OUT', 'ORDER_DEDUCTION', 'ORDER',
  params.reference, params.performedBy, `Deducted for ${params.reference}`, tx);
```

I need to read the reserved state before/after decrement. The simplest approach: read `reservedStock` for each target before the `applyStockChange` calls (or calculate from the post-decrement value).

Since `logManagedStockLedger` already reads current values per-target, I'll calculate reservedBefore/reservedAfter from the post-decrement value inside that method. But wait — `logManagedStockLedger` is shared across deduct, add, and scrap. For add and scrap, reserved state doesn't change.

The cleanest approach: read reserved state before calling logManagedStockLedger, at the deduct call site:

```ts
// Read reserved state for each target BEFORE logManagedStockLedger,
// after applyStockChange has already decremented.
// reservedAfter = current (post-decrement), reservedBefore = current + qty
const reservedPerTarget: Record<string, { before: number; after: number }> = {};
for (const t of targets) {
  let currentReserved = 0;
  if (t.variantId) {
    const v = await tx.productVariant.findUnique({
      where: { id: t.variantId },
      select: { reservedStock: true },
    });
    currentReserved = v?.reservedStock ?? 0;
  } else {
    const p = await tx.product.findUnique({
      where: { id: t.productId },
      select: { reservedStock: true },
    });
    currentReserved = p?.reservedStock ?? 0;
  }
  const key = t.variantId || t.productId;
  reservedPerTarget[key] = { before: currentReserved + t.qty, after: currentReserved };
}
```

Wait, but `logManagedStockLedger` iterates over targets internally and creates one ledger entry per target. I can't easily pass a map. The simpler approach is to modify `logManagedStockLedger` to also read `reservedStock` from the same product lookup, and ALWAYS calculate `reservedBefore`/`reservedAfter` — but only pass them when the caller provides them. Actually, the simplest approach:

Modify `logManagedStockLedger` to accept the optional params (already done in step 1). At the deduct call site, pass them. But since `logManagedStockLedger` reads the current state internally and calculates stockBefore/After from that, I should make it also read reservedStock and calculate when params are provided.

Actually, the cleanest is to calculate reservedBefore/reservedAfter INSIDE logManagedStockLedger, since it already reads current values. I just need to also select reservedStock and compute:

In `logManagedStockLedger`, after reading currentStock:
```ts
// Also read reservedStock:
let currentReserved = 0;
if (t.variantId) {
  const v = await tx.productVariant.findUnique({
    where: { id: t.variantId },
    select: { managedStockQuantity: true, reservedStock: true },  // added reservedStock
  });
  currentStock = v?.managedStockQuantity ?? 0;
  currentReserved = v?.reservedStock ?? 0;
} else {
  const p = await tx.product.findUnique({
    where: { id: t.productId },
    select: { managedStockQuantity: true, reservedStock: true },  // added reservedStock
  });
  currentStock = p?.managedStockQuantity ?? 0;
  currentReserved = p?.reservedStock ?? 0;
}

const stockAfter = currentStock;
const stockBefore = direction === 'IN' ? currentStock - t.qty : currentStock + t.qty;

// Calculate reserved state:
const declaredReservedBefore = reservedBefore ?? (direction === 'IN' ? currentReserved - t.qty : currentReserved + t.qty);
const declaredReservedAfter = reservedAfter ?? currentReserved;
```

Hmm, this is getting complicated. Let me simplify.

The simplest approach: keep the optional params as explicit overrides. When not provided and the operation is one where we want to infer (like deduct), `logManagedStockLedger` can compute them. But actually the pass-them-in approach from the call site is cleaner.

Let me just do it simply: at the deduct call site in `operate`, read the reserved state per target into arrays and pass the first value (since there's only one target typically, or the array is parallel to targets). Actually this is overthinking. Let me just:

1. Add optional `reservedBefore`/`reservedAfter` to `logManagedStockLedger` params
2. Inside `logManagedStockLedger`, also read `reservedStock` (just add it to the select)
3. Compute default values: if `reservedBefore` is not provided, compute from currentReserved like stockBefore is computed
4. At the deduct call site, don't pass anything explicitly — let `logManagedStockLedger` compute it

Wait, but for `add` and `scrap` operations, reserved doesn't change, so we don't want to populate the new fields. The simplest: only populate when the params are explicitly provided OR when the type is ORDER_DEDUCTION. Actually that introduces business logic awareness in a generic method. Bad.

OK final decision: keep it simple and explicit. Add the params to `logManagedStockLedger`. At the deduct call site, read reservedState and pass it. At add/scrap call sites, don't pass them (they stay null).

For the deduct call site, since `logManagedStockLedger` iterates targets, I need to pass values that work for all targets. The easiest: pass a single pair that will be used for ALL targets (logManagedStockLedger doesn't currently differentiate per-target params). Looking at the code:

```ts
private async logManagedStockLedger(
    targets: StockTarget[],
    direction, type, referenceType, referenceId, performedBy, note, tx
  ) {
    for (const t of targets) {
      // reads currentStock per target...
      await tx.managedStockLedger.create({...stockBefore, stockAfter, ...});
    }
  }
```

Since it's a for loop creating one entry per target, I can pass `reservedBefore`/`reservedAfter` as-is and they'll be the same for all targets. But in practice, each target has its own reservedStock value. So I need per-target values.

Hmm, but in practice is there ever more than one target in a deduct call? Let me check... The targets come from `resolveTargets()`. For a simple product/variant it's one target. For a combo, it's multiple. So yes, multiples possible.

OK let me take the simplest approach: **modify `logManagedStockLedger` to also read `reservedStock` from the same product/variant queries, and always set reservedBefore/reservedAfter based on the current reserved state.** For operations where reserved doesn't change (add, scrap), the computed values will also be correct (before=after=currentReserved), but they'll still show up in the UI. Actually, that introduces noise for add/scrap events.

FINAL decision: I'll make `logManagedStockLedger` compute `reservedBefore`/`reservedAfter` ONLY when the caller passes explicit flag or when the type suggests reserved state changes. No — too coupled.

OK, truly final. The method reads optional `reservedBefore`/`reservedAfter` as params. These are passed through to the create call (or null if not provided). At the deduct call site, we read reservedStock per target and pass it as per-target values. Since targets is iterated, I'll read reserved state inside a block right before the `logManagedStockLedger` call, using a simple array/map approach:

Actually, let me look at this from a different angle. `logManagedStockLedger` already reads currentStock per target. I can just add `reservedStock` to the same read query, and always compute `reservedBefore`/`reservedAfter`. For add/scrap, the computed values would be `0→0` (or whatever the current reserved is). But that's fine — reserved IS 0 for add/scrap, so the value would be correct.

Wait, no — reserved might not be 0. A product could have reservations while someone also does a manual add. In that case, showing `reservedBefore=3, reservedAfter=3` for a MANUAL_ADD event would be confusing — it implies reserved changed, but it didn't.

OK truly truly final: I'll do the simple approach:
1. Add optional `reservedBefore`/`reservedAfter` to `logManagedStockLedger` params
2. Pass them to the create call (?? null if undefined)
3. At the deduct call site, compute these values per-target and pass them as arrays... no, the method doesn't accept arrays.

OK I'll go with the reverse approach: instead of modifying `logManagedStockLedger`, I'll just read the reserved state at the deduct call site and `ManagedStockLedgerService.record()` takes care of it.

Wait, I just realized that `operate('deduct')` calls `logManagedStockLedger`, not `ManagedStockLedgerService.record()`. And `logManagedStockLedger` directly calls `tx.managedStockLedger.create()`, bypassing the service's `record()` method.

So the cleanest change:
1. `logManagedStockLedger` — accept optional `reservedBefore`/`reservedAfter`, pass to create
2. At deduct call site — read reservedStock after decrement, calculate before/after, pass to `logManagedStockLedger`
3. For per-target values: read inside a loop before calling `logManagedStockLedger`, store in array parallel to targets, find by key

Actually no — I just realized that `logManagedStockLedger` reads the current state for EACH target individually inside its loop. The simplest approach that doesn't require changing the method's iteration pattern is:

**Read reserved state per target BEFORE calling logManagedStockLedger, store in a Map keyed by targetKey, pass as a single Map to the method.**

But passing a Map changes the signature anyway.

OK I'll do the truly simplest thing possible since this plan is getting too long on this one detail:

Modify `logManagedStockLedger` to:
1. Add `reservedBefore` and `reservedAfter` optional params
2. Inside, also select `reservedStock` from the same query
3. If reservedBefore is undefined AND type is ORDER_DEDUCTION, compute it: `reservedBefore = currentReserved + qty, reservedAfter = currentReserved`
4. Otherwise use the passed values

Actually no. I'll just compute reservedBefore/reservedAfter inside the method by ALSO reading reservedStock. For ALL operations (not just ORDER_DEDUCTION). The rule is simple: if the caller doesn't pass explicit values, default to showing the current reserved state with no change (before=after=currentReserved). This is correct for all operations:

- For MANUAL_ADD when reserved is 0: reserved 0→0 (correct, no reserved change)
- For MANUAL_REMOVE when reserved is 5: reserved 5→5 (correct, no reserved change)
- For ORDER_DEDUCTION when reserved is 1 and was just decremented: reserved 1→0 (correct!)

This is actually the simplest and most correct approach. Let me go with it.

The implementation in `logManagedStockLedger`:

```ts
// Also select reservedStock:
if (t.variantId) {
  const v = await tx.productVariant.findUnique({
    where: { id: t.variantId },
    select: { managedStockQuantity: true, reservedStock: true },
  });
  currentStock = v?.managedStockQuantity ?? 0;
  currentReserved = v?.reservedStock ?? 0;
} else {
  const p = await tx.product.findUnique({
    where: { id: t.productId },
    select: { managedStockQuantity: true, reservedStock: true },
  });
  currentStock = p?.managedStockQuantity ?? 0;
  currentReserved = p?.reservedStock ?? 0;
}

const stockAfter = currentStock;
const stockBefore = direction === 'IN' ? currentStock - t.qty : currentStock + t.qty;

// Compute reservedBefore/reservedAfter based on direction
// The method is called AFTER the stock change has been applied
const computedReservedBefore = direction === 'IN' ? currentReserved - t.qty : currentReserved + t.qty;
const computedReservedAfter = currentReserved;
```

And then in the create call:
```ts
reservedBefore: reservedBefore ?? computedReservedBefore ?? null,
reservedAfter: reservedAfter ?? computedReservedAfter ?? null,
```

Wait, but for IN operations (which add stock, like MANUAL_ADD), reserved doesn't change direction-wise. If reserved was 3 and we add IN direction, reserved is still 3. The formula would give: `reservedBefore = 3 - qty` which is wrong!

The issue is that the formula `direction === 'IN' ? current - qty : current + qty` works for stock (quantity changes), but NOT for reserved (which doesn't change for IN/OUT stock operations). The direction of the ledger is about the stock, not the reserved.

So I can't use the direction-based formula for reserved state. I need explicit values passed from the caller. OR I need to NOT auto-compute and only set when explicitly passed.

FINAL FINAL FINAL decision (this is the actual final one): 

For `logManagedStockLedger` — add optional `reservedBefore`/`reservedAfter` params that are passed through directly. Don't auto-compute. For callers (deduct), read the state explicitly and pass it.

For the deduct call site, the approach will be:
- Read `reservedStock` per target BEFORE calling `logManagedStockLedger` (after `applyStockChange` has already run)
- Hmm but that's the AFTER value
- Calculate BEFORE = AFTER + quantity (since reservedStock was decremented = OUT)

For the reserve and release operations (Task 3), they don't use `logManagedStockLedger` — they directly create the entry. So I handle those inline as already described.

For the deduct operation, I'll capture reserved state per target in a Map and pass a serialized form... or I could just refactor the deduct flow to use `ManagedStockLedgerService.record()` instead of `logManagedStockLedger()`. But that's a bigger change.

OK, actually the simplest solution for deduct: read `reservedStock` BEFORE the `applyStockChange` calls, pass to `logManagedStockLedger`. Let me re-read the flow:

```
1. applyStockChange(targets, 'managedStockQuantity', 'decrement')  // decrement stock
2. applyStockChange(targets, 'reservedStock', 'decrement')         // decrement reserved
3. logManagedStockLedger(...)                                       // reads current stock
```

If I read reservedStock BEFORE step 1:
- reservedBefore = current value
- But steps 1+2 haven't run yet, so I know it's the before value
- Then after steps 1+2, logManagedStockLedger reads current stock
- I need reservedAfter = reservedBefore - qty

But `logManagedStockLedger` reads current per-target. I need to pass the reserved state.

The SIMPLEST CODE CHANGE: read reserved state in a loop inside `operate('deduct')` before the changes, store in an array, then modify `logManagedStockLedger` to also accept arrays?

NO. This is way overthought. Let me look at the actual code flow once more.

In `operate('deduct')` (line 737-764):
```ts
await this.applyStockChange(targets, 'managedStockQuantity', 'decrement', tx);
await this.applyStockChange(targets, 'reservedStock', 'decrement', tx);
// ...
await this.logManagedStockLedger(targets, 'OUT', 'ORDER_DEDUCTION', 'ORDER',
  params.reference, params.performedBy, `Deducted for ${params.reference}`, tx);
```

The simplest change: instead of reading reserved state separately, I just make `logManagedStockLedger` accept `reservedBefore`/`reservedAfter` as optional params, and if they're provided, they're used. At the deduct call site, I DO NOT pass them. INSTEAD, I move the ledger creation to use a non-generic approach, OR I refactor `logManagedStockLedger` to always read reservedStock and then DON'T set the new fields for add/scrap/other operations.

But the cleanest approach for this plan is: I'll modify `logManagedStockLedger` to always read reservedStock from the same query. For callers that don't care (add, scrap), I'll have the method also compute `reservedBefore/reservedAfter` but only set them if the type is ORDER_DEDUCTION. No wait, that introduces type-awareness.

ABSOLUTE FINAL APPROACH: I'll read reserved state in the deduct section BEFORE `applyStockChange` and store as a simple map, then pass reservedBefore/reservedAfter as optional params to `logManagedStockLedger`. The method uses them if provided. This is clean and explicit.

Reading before applyStockChange:
```ts
// Capture reserved state before decrement
const reservedStateBefore = new Map<string, number>();
for (const t of targets) {
  const key = t.variantId || t.productId;
  if (t.variantId) {
    const v = await tx.productVariant.findUnique({
      where: { id: t.variantId },
      select: { reservedStock: true },
    });
    reservedStateBefore.set(key, v?.reservedStock ?? 0);
  } else {
    const p = await tx.product.findUnique({
      where: { id: t.productId },
      select: { reservedStock: true },
    });
    reservedStateBefore.set(key, p?.reservedStock ?? 0);
  }
}
```

Then pass a single reservedBefore/reservedAfter pair... but that doesn't work for multiple targets.

OK I've been way overthinking this. Let me just take the approach of modifying `logManagedStockLedger` to read reservedStock and COMPUTE the before/after. The formula for reserved state is:

- For OUT operations (which decrement): reservedBefore = current + qty, reservedAfter = current
- For IN operations (which increment): reservedBefore = current - qty, reservedAfter = current

For OUT operations, this correctly gives reserved 1→0.
For IN operations, this depends. If add/scrap have OUT direction, they might show a change in reserved. Let me check... MANUAL_ADD has direction IN. MANUAL_REMOVE has direction OUT.

For MANUAL_REMOVE (OUT) where reserved is 0: reservedBefore = 0+qty (wrong! shows 5→0 when stock was manually removed)
For SCRAP (OUT) where reserved is 0: same problem

This approach doesn't work universally.

TRUE FINAL APPROACH (I promise): I'll handle the three cases explicitly in the plan:

1. **Reserve (Task 3)**: Direct inline create, pass reservedBefore/After explicitly. Done.
2. **Release (Task 3)**: Direct inline create, pass reservedBefore/After explicitly. Done.
3. **Deduct (Task 4)**: 
   a. Add reservedBefore/reservedAfter as optional params to `logManagedStockLedger` (passed through to create call)
   b. At deduct call site, read reservedStock PER TARGET in a loop, store in arrays/tuples
   c. I'll refactor `logManagedStockLedger` to accept `reservedBeforeMap?: Map<string, number>` and `reservedAfterMap?: Map<string, number>`
   d. Inside the method, look up each target's key in the maps

Actually no, that's a weird API. Let me just do it the TRULY simplest way:

Add `reservedBefore` and `reservedAfter` as optional `number` params (not arrays, not maps). At the deduct call site, since targets is almost always 1 item (product or variant — combos are rare), use the first target's values. For combos, the reservedBefore/After would be approximate but still useful metadata.

Actually for combos, each item is a separate product/variant, so reserved states differ. OK this doesn't work for combos.

SIMPLE: I'll change `logManagedStockLedger` to read reservedStock AND calculate. Then I add a boolean flag `captureReservedState?: boolean` so only deduct passes `true`, add and scrap don't.

Inside logManagedStockLedger, when captureReservedState is true:
```ts
// After reading currentStock, also read reservedStock:
const currentReserved = ... // from the same query
const reservedAfterBuilt = currentReserved;

// For OUT operations: reserved was decremented, so before = after + qty
// For IN operations: reserved was incremented, so before = after - qty
const reservedBeforeBuilt = direction === 'IN'
  ? currentReserved - t.qty
  : currentReserved + t.qty;
```

But I showed above that this gives wrong values for MANUAL_REMOVE/SCRAP (which are OUT direction but don't change reserved). However, since only `deduct` passes `captureReservedState=true`, this is fine — the formula is only applied when we know reserved was just decremented.

For the deduct call, direction is always 'OUT', and reservedStock was decremented by the same qty. So the formula `reservedAfter = currentReserved; reservedBefore = currentReserved + qty` is correct.

Hmm, but what if deduct is called with `isNegative` or something? Let me check... the `operate` method handles negative quantity in `resolveTargets` (already made absolute). And direction is hardcoded as 'OUT' for deduct. So it's always correct.

OK, this is the approach I'll document in the plan. But actually, for coding simplicity in the plan steps, let me use the simplest approach that works: just add the optional params, and have the deduct call site read reserved state explicitly per target and pass it.

Actually, I'll just change `logManagedStockLedger` to read `reservedStock` from the existing queries and compute `reservedBefore`/`reservedAfter` internally. But ONLY if the caller passes an explicit flag or the params. Let me just document it simply:

1. Add optional `reservedBefore`/`reservedAfter` params to `logManagedStockLedger`
2. Also read `reservedStock` in the same queries inside `logManagedStockLedger`
3. If `reservedBefore` is undefined, DON'T set reserved fields (null) — this preserves existing behavior for add/scrap
4. If `reservedBefore` is explicitly passed (from deduct), use it

For the deduct call site, I'll read reserved state after applyStockChange has run:
```ts
// After applyStockChange, read reserved state per target
// Since direction is OUT and applyStockChange decremented reservedStock:
// reservedAfter = current, reservedBefore = current + qty
const firstTarget = targets[0];
let currentReserved = 0;
if (firstTarget.variantId) {
  const v = await tx.productVariant.findUnique({ where: { id: firstTarget.variantId }, select: { reservedStock: true } });
  currentReserved = v?.reservedStock ?? 0;
} else {
  const p = await tx.product.findUnique({ where: { id: firstTarget.productId }, select: { reservedStock: true } });
  currentReserved = p?.reservedStock ?? 0;
}
await this.logManagedStockLedger(
  targets, 'OUT', 'ORDER_DEDUCTION', 'ORDER',
  params.reference, params.performedBy, `Deducted for ${params.reference}`, tx,
  currentReserved + (targets.length > 0 ? targets[0].qty : 0),  // reservedBefore
  currentReserved,                                                // reservedAfter
);
```

Wait, this only uses the first target's values. For combos, the reserved values might differ per target. But `logManagedStockLedger` iterates targets and reads stock per target independently. The reservedBefore/reservedAfter params are a single pair used for all targets.

OK for combos, reserved state is per-target (each item has its own reservedStock). So for the dedup to work per-target, I need to handle this inside the method.

TRULY TRULY FINAL approach: modify `logManagedStockLedger` to ALSO read `reservedStock` from the same query (just add it to the select), and compute `reservedBefore`/`reservedAfter` based on direction. BUT only apply this computation when `type === 'ORDER_DEDUCTION'` (direction is always OUT for ORDER_DEDUCTION, so the formula is correct).

This is actually clean because:
- `logManagedStockLedger` already knows the type (it's a param)
- When type is ORDER_DEDUCTION, we know reservedStock was just decremented
- direction is always OUT for ORDER_DEDUCTION
- The computation `reservedBefore = currentReserved + qty, reservedAfter = currentReserved` is correct

For add/scrap: reserved fields stay null. 

This is the approach. Let me document it cleanly in the plan now.

OK so for the plan, I also need to handle physical inventory ledger changes. Let me also check if `fulfillPhysicalReservation` has the same issue (it reads `quantity` but not `reservedQuantity`). Yes it does at line 1233:
```ts
const pi = await tx.physicalInventory.findUnique({
  where: { id: alloc.physicalInventoryId },
  select: { quantity: true },
});
```

I need to add `reservedQuantity: true` to this select.

And for `logPhysicalInventoryLedger`, I need to add optional `reservedBefore`/`reservedAfter` params and pass them to the create call.

OK, I have a complete picture now. Let me write the plan document properly with all details.<｜end▁of▁thinking｜>

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="Write">
<｜｜DSML｜｜parameter name="content" string="true"># Movement History — Reserved State Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `reservedBefore`/`reservedAfter` capture to both `ManagedStockLedger` and `PhysicalInventoryLedger` so Reserve/Release/OrderDeduction events show their full state transition.

**Architecture:** Add 2 nullable columns to each ledger table. Backend populates them at the 4 call sites where a reserved-state transition coincides with ledger entry creation (reserve/release/deduct on managed side, deduct/fulfill on physical side). Frontend adds 2 columns to the movement history tables. Existing data is unchanged (null).

**Tech Stack:** Prisma 7, NestJS 11, React 19, TanStack Query

## Global Constraints

- No business logic changes — reservation, release, deduction, fulfillment flows remain identical.
- No new audit event types.
- Nullable columns — no backfill needed.
- Both ledgers follow the same column naming and pattern.
- `available = stock - reserved` is computed in frontend, not stored.
- After schema change: `npx prisma migrate dev --name add_reserved_state_to_ledgers` then `npx prisma generate`
- Build verify: `npm run build --workspace=backend` and `npm run build --workspace=admin`

---

### Task 1: Prisma Schema + Migration

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`
- Create: migration via `prisma migrate dev`

- [ ] **Step 1: Add `reservedBefore Int?` and `reservedAfter Int?` to `ManagedStockLedger`**

Edit `apps/backend/prisma/schema.prisma` at line ~1243. After `stockAfter  Int?`, add:
```
  reservedBefore Int?
  reservedAfter  Int?
```

The model block should look like:
```prisma
model ManagedStockLedger {
  id        String  @id @default(uuid())
  productId String?
  variantId String?
  comboId   String?

  quantity  Int
  direction MovementDirection
  type      ManagedStockMovementType

  stockBefore Int?
  stockAfter  Int?

  reservedBefore Int?            // NEW
  reservedAfter  Int?            // NEW

  referenceType ReferenceEntity?
  referenceId   String?

  note          String?
  reason        String?
  performedById String?
  performedAt   DateTime @default(now())

  @@index([productId, variantId, performedAt])
  @@index([referenceType, referenceId])
}
```

- [ ] **Step 2: Add same columns to `PhysicalInventoryLedger`**

Edit `apps/backend/prisma/schema.prisma` at line ~1150. After `stockAfter  Int`, add:
```
  reservedBefore Int?
  reservedAfter  Int?
```

The model block should look like:
```prisma
model PhysicalInventoryLedger {
  id          String            @id @default(uuid())
  productId   String
  variantId   String?
  warehouseId String
  quantity    Int
  direction   MovementDirection
  stockBefore Int
  stockAfter  Int
  reservedBefore Int?           // NEW
  reservedAfter  Int?           // NEW
  type        String
  reason      String?
  performedBy String?
  unitCost    Decimal?          @db.Decimal(12, 2)
  createdAt   DateTime          @default(now())
  // ... relations and indexes
}
```

- [ ] **Step 3: Run migration + generate**

```bash
cd apps/backend
npx prisma migrate dev --name add_reserved_state_to_ledgers
npx prisma generate
```

- [ ] **Step 4: Verify backend build**

```bash
npm run build --workspace=backend
```

---

### Task 2: Backend — ManagedStockLedgerService.record()

**Files:**
- Modify: `apps/backend/src/inventory/managed-stock-ledger.service.ts`

**Interfaces:**
- Produces: `record()` accepts optional `reservedBefore`/`reservedAfter`

- [ ] **Step 1: Add `reservedBefore` and `reservedAfter` to `record()` params and create call**

Edit `managed-stock-ledger.service.ts`. In the params type definition, add:
```ts
      reservedBefore?: number;
      reservedAfter?: number;
```

In the `create` data object, add:
```ts
        reservedBefore: params.reservedBefore ?? null,
        reservedAfter: params.reservedAfter ?? null,
```

- [ ] **Step 2: Verify backend build**

```bash
npm run build --workspace=backend
```

---

### Task 3: Backend — StockService: reserve + release (managed stock inline creates)

**Files:**
- Modify: `apps/backend/src/stock/stock.service.ts`

**Context:** The `operate('reserve')` and `operate('release')` blocks already call `tx.managedStockLedger.create()` directly (not via `logManagedStockLedger()`). `applyStockChange` runs first (incrementing/decrementing `reservedStock`), then the inline code reads `managedStockQuantity`. We need to also read `reservedStock` and populate the new fields.

- [ ] **Step 1: Capture reserved state in `operate('reserve')` (lines ~648-682)**

Current query reads only `managedStockQuantity`. Change both the variant and product queries to also select `reservedStock`, then compute `reservedBefore/reservedAfter`:

```ts
if (p?.availabilityMode === 'MANAGED_STOCK') {
    let currentStock = 0;
    let currentReserved = 0;
    if (t.variantId) {
      const v = await tx.productVariant.findUnique({
        where: { id: t.variantId },
        select: { managedStockQuantity: true, reservedStock: true },  // +reservedStock
      });
      currentStock = v?.managedStockQuantity ?? 0;
      currentReserved = v?.reservedStock ?? 0;                        // NEW
    } else {
      currentStock = p.managedStockQuantity ?? 0;
      currentReserved = p.reservedStock ?? 0;                         // NEW
    }
    // ... orderId lookup (unchanged) ...

    await tx.managedStockLedger.create({
      data: {
        productId: t.productId,
        variantId: t.variantId,
        comboId: params.comboId ?? null,
        quantity: t.qty,
        direction: 'OUT',
        type: (params.ledgerType as any) || 'RESERVE',
        stockBefore: currentStock,
        stockAfter: currentStock,
        reservedBefore: currentReserved - t.qty,    // NEW: before increment
        reservedAfter: currentReserved,              // NEW: after increment
        referenceType: 'ORDER',
        referenceId: orderId,
        performedById: params.performedBy || 'system',
        note: `Reserved for ${params.reference}`,
      },
    });
}
```

**Rationale:** `reservedStock` was already incremented by `applyStockChange(targets, 'reservedStock', 'increment')` on line 634. So `currentReserved` is the POST-increment value. `reservedBefore = currentReserved - t.qty` gives the pre-increment value.

- [ ] **Step 2: Capture reserved state in `operate('release')` (lines ~699-734)**

Same pattern. `reservedStock` was already decremented by `applyStockChange(targets, 'reservedStock', 'decrement')`. Also change queries to select `reservedStock`, then:

```ts
reservedBefore: currentReserved + t.qty,    // before decrement
reservedAfter: currentReserved,              // after decrement
```

- [ ] **Step 3: Verify backend build**

```bash
npm run build --workspace=backend
```

---

### Task 4: Backend — StockService: deduct (managed stock via logManagedStockLedger)

**Files:**
- Modify: `apps/backend/src/stock/stock.service.ts`

**Context:** `operate('deduct')` calls `logManagedStockLedger()`, which reads current `managedStockQuantity` per target then creates ledger entries. We modify `logManagedStockLedger` to also read `reservedStock` and compute `reservedBefore`/`reservedAfter` based on transaction direction — BUT only when the movement type is `ORDER_DEDUCTION` (so MANUAL_REMOVE, SCRAP, etc. still produce null for these fields).

**Rationale for this approach:** `logManagedStockLedger` reads per-target state, and targets can vary per call (combo items have different reserved stocks). Pushing a single value from the call site wouldn't be per-target correct. Reading reservedStock inside the method and conditionally computing avoids this.

- [ ] **Step 1: Modify `logManagedStockLedger()` to capture reserved state**

Edit `stock.service.ts` around line 345-392. In the product/variant queries, add `reservedStock` to the `select`. After computing `stockAfter`/`stockBefore`, conditionally compute reserved state:

```ts
  private async logManagedStockLedger(
    targets: StockTarget[],
    direction: Prisma.$ManagedStockLedgerPayload['scalars']['direction'],
    type: Prisma.$ManagedStockLedgerPayload['scalars']['type'],
    referenceType: Prisma.$ManagedStockLedgerPayload['scalars']['referenceType'],
    referenceId: string | undefined,
    performedBy: string | undefined,
    note: string | undefined,
    tx: Prisma.TransactionClient,
  ) {
    for (const t of targets) {
      let currentStock = 0;
      let currentReserved = 0;
      if (t.variantId) {
        const v = await tx.productVariant.findUnique({
          where: { id: t.variantId },
          select: { managedStockQuantity: true, reservedStock: true },  // +reserved
        });
        currentStock = v?.managedStockQuantity ?? 0;
        currentReserved = v?.reservedStock ?? 0;                        // NEW
      } else {
        const p = await tx.product.findUnique({
          where: { id: t.productId },
          select: { managedStockQuantity: true, reservedStock: true },  // +reserved
        });
        currentStock = p?.managedStockQuantity ?? 0;
        currentReserved = p?.reservedStock ?? 0;                        // NEW
      }

      const stockAfter = currentStock;
      const stockBefore =
        direction === 'IN' ? currentStock - t.qty : currentStock + t.qty;

      // Compute reserved state only for ORDER_DEDUCTION (where reservedStock was decremented)
      let reservedBefore: number | null = null;
      let reservedAfter: number | null = null;
      if (type === 'ORDER_DEDUCTION') {
        // reservedStock was already decremented — direction is always OUT for DEDUCTION
        reservedAfter = currentReserved;
        reservedBefore = currentReserved + t.qty;
      }

      await tx.managedStockLedger.create({
        data: {
          productId: t.productId,
          variantId: t.variantId,
          comboId: null,
          quantity: t.qty,
          direction,
          type,
          stockBefore,
          stockAfter,
          reservedBefore,    // NEW
          reservedAfter,     // NEW
          referenceType,
          referenceId,
          reason: note,
          performedById: performedBy,
        },
      });
    }
  }
```

**Important:** `operate('deduct')` at line 737-764 runs `applyStockChange(targets, 'managedStockQuantity', 'decrement')` then `applyStockChange(targets, 'reservedStock', 'decrement')` BEFORE calling `logManagedStockLedger`. So when `logManagedStockLedger` reads `reservedStock`, it gets the POST-decrement value. The formula `reservedBefore = currentReserved + t.qty` correctly reverses to get the pre-decrement value.

**Callers unaffected:** `logManagedStockLedger` is also called by `operate('add')` (line 782) and `operate('scrap')` (line 806). For those callers, `type` won't be `ORDER_DEDUCTION`, so `reservedBefore` and `reservedAfter` stay null. Correct behavior.

- [ ] **Step 2: Verify backend build**

```bash
npm run build --workspace=backend
```

---

### Task 5: Backend — StockService: PhysicalInventoryLedger changes

**Files:**
- Modify: `apps/backend/src/stock/stock.service.ts`

**Context:** Physical inventory has two paths that write `PhysicalInventoryLedger` entries with a reserved state transition:

1. `operatePhysical('deduct')` (line 536-563) — calls `logPhysicalInventoryLedger()` after decrementing both `quantity` and `reservedQuantity`
2. `fulfillPhysicalReservation()` (line 1237-1250) — directly calls `physicalInventoryLedger.create()`

Both need to capture the `reservedQuantity` BEFORE and AFTER the decrement.

- [ ] **Step 1: Modify `logPhysicalInventoryLedger()` to accept and persist reserved state**

Edit `stock.service.ts` around line 294-343. Add optional `reservedBefore`/`reservedAfter` params:

```ts
  private async logPhysicalInventoryLedger(
    targets: StockTarget[],
    warehouseId: string,
    direction: Prisma.$PhysicalInventoryLedgerPayload['scalars']['direction'],
    type: string,
    reference: string,
    performedBy: string | undefined,
    unitCost: number | undefined,
    tx: Prisma.TransactionClient,
    binLocationId?: string,
    _referenceType?: ReferenceEntity,
    _referenceId?: string,
    reservedBefore?: number,          // NEW
    reservedAfter?: number,           // NEW
  ) {
```

In the `create` call inside the method (around line 327-341), add:
```ts
        await tx.physicalInventoryLedger.create({
          data: {
            // ... existing fields ...
            stockBefore,
            stockAfter,
            reservedBefore: reservedBefore ?? null,   // NEW
            reservedAfter: reservedAfter ?? null,     // NEW
            // ...
          },
        });
```

- [ ] **Step 2: Capture reserved state in `operatePhysical('deduct')`**

Edit `stock.service.ts` around line 536-563. After the `applyPhysicalChange` decrements and before `logPhysicalInventoryLedger`, read the current `reservedQuantity` per target and calculate before/after:

```ts
      } else if (effectiveOperation === 'deduct') {
        // ... existing quantity decrement ...

        if (!isNegative) {
          await this.applyPhysicalChange(
            physicalTargets,
            'decrement',
            'reservedQuantity',
            tx,
          );
        }

        // Capture reserved state after decrement
        let physReservedBefore = 0;
        let physReservedAfter = 0;
        if (targets.length > 0) {
          const firstTarget = targets[0];
          const whereClause: any = {
            productId: firstTarget.productId,
            variantId: firstTarget.variantId || null,
            warehouseId: params.warehouseId!,
          };
          if (params.binLocationId) whereClause.binLocationId = params.binLocationId;
          else whereClause.binLocationId = null;

          const pi = await tx.physicalInventory.findFirst({ where: whereClause, select: { reservedQuantity: true } });
          physReservedAfter = pi?.reservedQuantity ?? 0;
          physReservedBefore = physReservedAfter + (targets.length > 0 ? targets[0].qty : 0);
        }

        await this.logPhysicalInventoryLedger(
          targets,
          params.warehouseId!,
          'OUT',
          params.ledgerType || (isNegative ? 'PHYSICAL_ADJUSTMENT' : 'DEDUCTION'),
          params.reference,
          params.performedBy,
          params.unitCost,
          tx,
          params.binLocationId,
          params.referenceType,
          params.referenceId,
          physReservedBefore,     // NEW
          physReservedAfter,      // NEW
        );
```

**Note:** `physicalTargets` is a different array than `targets`. The target mapping is: targets have {productId, variantId, qty}, while physicalTargets is the same but already resolved for physical inventory queries. Use `targets[0]` for the product lookup since both are derived from the same source. For negative (adjustment) deducts, `reservedQuantity` is NOT decremented, so `physReservedBefore = physReservedAfter = 0` (correct — reserved state unchanged).

- [ ] **Step 3: Capture reserved state in `fulfillPhysicalReservation()`**

Edit `stock.service.ts` around line 1232-1250. The code currently reads `quantity` only. Add `reservedQuantity` to the query and compute before/after:

```ts
      // Write ledger entry
      const pi = await tx.physicalInventory.findUnique({
        where: { id: alloc.physicalInventoryId },
        select: { quantity: true, reservedQuantity: true },    // +reservedQuantity
      });
      const reservedQty = pi?.reservedQuantity ?? 0;
      await client.physicalInventoryLedger.create({
        data: {
          productId: parent.productId,
          variantId: parent.variantId ?? null,
          warehouseId: parent.warehouseId,
          quantity: deductQty,
          direction: 'OUT',
          stockBefore: (pi?.quantity ?? 0) + deductQty,
          stockAfter: pi?.quantity ?? 0,
          reservedBefore: reservedQty + deductQty,              // NEW: before decrement
          reservedAfter: reservedQty,                           // NEW: after decrement
          type: 'DEDUCTION',
          reason: params.reference,
          performedBy: params.performedBy,
        },
      });
```

- [ ] **Step 4: Verify backend build**

```bash
npm run build --workspace=backend
```

---

### Task 6: Frontend — Movement Ledger component (product detail)

**Files:**
- Modify: `apps/admin/src/features/inventory/components/movement-ledger.tsx`
- Modify: `apps/admin/src/features/inventory/utils/movement-type-labels.ts`

**Interfaces:**
- Consumes: `reservedBefore`/`reservedAfter` from API response (Task 1-5)

- [ ] **Step 1: Add RESERVE/RELEASE labels to MOVEMENT_TYPE_LABELS**

Edit `movement-type-labels.ts`. In the `MOVEMENT_TYPE_LABELS` object, add before the closing `}`:
```ts
  RESERVE: 'Reserve',
  RELEASE: 'Release',
```

Also in `getMovementTypeBadgeVariant()`, update the condition so RESERVE maps to `'outline'` and RELEASE maps to `'secondary'`:
```ts
export function getMovementTypeBadgeVariant(
  type: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (type.includes('OUT') || type.includes('DEDUCTION') || type === 'ORDER_DEDUCTION' || type === 'MANUAL_REMOVE') {
    return 'destructive'
  }
  if (type.includes('IN') || type === 'MANUAL_ADD' || type === 'INITIAL' || type === 'RETURN') {
    return 'default'
  }
  if (type === 'TRANSFER' || type === 'transfer' || type === 'RELEASE') {
    return 'secondary'
  }
  if (type === 'RESERVE') {
    return 'outline'
  }
  return 'outline'
}
```

- [ ] **Step 2: Add `reservedBefore`/`reservedAfter` to LedgerEntry interface**

Edit `movement-ledger.tsx`. Update the `LedgerEntry` interface (around line 13-31):
```ts
interface LedgerEntry {
  // ... existing fields ...
  stockBefore: number
  stockAfter: number
  reservedBefore: number | null        // NEW
  reservedAfter: number | null         // NEW
  // ... existing fields ...
}
```

- [ ] **Step 3: Add Reserved and Available columns to the table**

Edit `movement-ledger.tsx`. In the `<TableHeader>` section (line 113-121), add two new `<TableHead>` columns after the Qty Change column:

```tsx
<TableHead>Reserved</TableHead>
<TableHead>Available</TableHead>
```

In the `<TableBody>` mapping (around line 143-175), add two new `<TableCell>` entries after the Qty Change cell (after the `entry.direction === 'IN' ? '+' : '-'` cell):

```tsx
<TableCell className="text-right text-xs text-muted-foreground">
  {entry.reservedBefore != null ? `${entry.reservedBefore} → ${entry.reservedAfter}` : '—'}
</TableCell>
<TableCell className="text-right text-xs font-medium">
  {entry.reservedAfter != null
    ? (entry.stockAfter - entry.reservedAfter).toString()
    : '—'}
</TableCell>
```

Also increment the `colSpan` in the loading/error/empty states from `6` to `8`.

- [ ] **Step 4: Verify admin build**

```bash
npm run build --workspace=admin
```

---

### Task 7: Frontend — Movement History page (dual ledger view)

**Files:**
- Modify: `apps/admin/src/features/inventory/history.tsx`

**Interfaces:**
- Consumes: `reservedBefore`/`reservedAfter` from API response

- [ ] **Step 1: Add `reservedBefore`/`reservedAfter` to LogEntry interface**

Edit `history.tsx`. Update the `LogEntry` interface (around line 27-46):
```ts
interface LogEntry {
  // ... existing fields ...
  stockBefore: number
  stockAfter: number
  reservedBefore: number | null       // NEW
  reservedAfter: number | null        // NEW
  // ... existing fields ...
}
```

- [ ] **Step 2: Add columns for both PHYSICAL and MANAGED modes**

The table renders differently based on `ledgerMode`:
- PHYSICAL mode has more columns (Warehouse, Unit Cost)
- MANAGED mode has fewer

Add two new columns **after the "After" column** (which is at the end of the existing core columns, line 408-409):

After the `stockAfter` cell (line 409), add for both modes:
```tsx
<TableCell className="text-right text-xs text-muted-foreground">
  {log.reservedBefore != null ? `${log.reservedBefore} → ${log.reservedAfter}` : '—'}
</TableCell>
<TableCell className="text-right text-xs font-medium">
  {log.reservedAfter != null
    ? (log.stockAfter - log.reservedAfter).toString()
    : '—'}
</TableCell>
```

These go inside the `<TableRow>` (line 362) alongside the existing cells — they appear for both MANAGED and PHYSICAL modes since the user wants consistency.

Update all `colSpan` values:
- PHYSICAL mode: 10 → 12 (added 2 columns)
- MANAGED mode: 8 → 10 (added 2 columns)

- [ ] **Step 3: Verify admin build**

```bash
npm run build --workspace=admin
```

---

### Task 8: Test verification

**Files:**
- Verify against: `apps/backend/src/__tests__/batch2-repaired.spec.ts` (references ManagedStockLedger)
- Verify against: `apps/backend/src/pos/__tests__/pos-orders-inventory.spec.ts` (POS stock operations)

- [ ] **Step 1: Run backend tests**

```bash
npm run test --workspace=backend
```

Verify no regressions. The new fields are nullable, so existing assertions on `stockBefore`/`stockAfter` still pass.

- [ ] **Step 2: Run POS inventory tests**

```bash
npm run test --workspace=backend -- --testPathPattern="pos-orders"
```

- [ ] **Step 3: Rebuild both apps to confirm no TS errors**

```bash
npm run build --workspace=backend
npm run build --workspace=admin
```

---

## Summary of Changes

| File | Change |
|---|---|
| `apps/backend/prisma/schema.prisma` | +2 cols on `ManagedStockLedger`, +2 cols on `PhysicalInventoryLedger` |
| Migration | `ALTER TABLE ADD COLUMN` x2 |
| `apps/backend/src/inventory/managed-stock-ledger.service.ts` | `record()` accepts new optional params |
| `apps/backend/src/stock/stock.service.ts` | Reserve/release inline creates capture reserved; `logManagedStockLedger()` reads reserved for ORDER_DEDUCTION; `logPhysicalInventoryLedger()` accepts reserved; deduct/fulfill pass reserved |
| `apps/admin/src/features/inventory/utils/movement-type-labels.ts` | Add RESERVE/RELEASE labels |
| `apps/admin/src/features/inventory/components/movement-ledger.tsx` | +2 columns (Reserved, Available) |
| `apps/admin/src/features/inventory/history.tsx` | +2 columns (Reserved, Available) |
