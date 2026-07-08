# Inventory Phase 1 — Complete Remaining Work

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire ManagedStockLedger, respect availabilityMode in inventory service, update admin UI to reflect new data model.

**Architecture:** 
- Backend: inventory.service already uses `managedStockQuantity` field; need to add ManagedStockLedger writes + availabilityMode guards + query endpoint
- Admin UI: Update adjust dialog, stock overview, and product detail to show new fields
- Low-stock raw SQL already uses `"stock"` column which maps to `managedStockQuantity` via Prisma @map — no change needed there

**Tech Stack:** NestJS, Prisma, React, TanStack Query

---

### Task 1: Backend — Write to ManagedStockLedger + AvailabilityMode guards

**Files:**
- Modify: `apps/backend/src/inventory/inventory.service.ts`
- Modify: `apps/backend/src/inventory/dto/adjust-inventory.dto.ts`

**Changes:**

1. **adjust() method** — after updating `managedStockQuantity` (via Prisma increments), write a `ManagedStockLedger` entry with:
   - `productId`, `variantId` (as appropriate)
   - `quantity` = absolute quantity changed
   - `direction` = `IN` if quantity > 0, `OUT` if quantity < 0
   - `type` = `MANUAL_ADD` if q > 0, `MANUAL_REMOVE` if q < 0
   - `stockBefore` = old stock, `stockAfter` = new stock
   - `referenceType` = `ADJUSTMENT`
   - `referenceId` = null (or a generated ref)
   - `note` = reason
   - `performedBy` = performedBy

   Before the update, need to read the current `managedStockQuantity` to compute `stockBefore`.

2. **restockOrderItems() method** — after incrementing stock, write a `ManagedStockLedger` entry with:
   - `direction` = `IN`
   - `type` = `CANCEL_RELEASE` or `RETURN` (based on logType param)
   - `referenceType` = `ORDER`
   - `referenceId` = orderId

3. **adjust() method** — add availabilityMode guard at top:
   - Fetch product with `availabilityMode` and `type`
   - If `availabilityMode === 'ALWAYS_IN_STOCK'` or `ALWAYS_OUT_OF_STOCK`, throw `BadRequestException`
   - If `availabilityMode === 'INVENTORY_CONTROLLED'`, throw `BadRequestException('Use Purchase Orders for inventory-controlled products')`
   - If `manageStock` is false and `availabilityMode === 'MANAGED_STOCK'`, throw `BadRequestException('Stock tracking is disabled for this product')`

4. **Update AdjustInventoryDto** — add optional `availabilityMode` to response type (not needed in DTO, but service should return it in response)

5. **transfer() method** — write ManagedStockLedger entry for transfers too

- [ ] **Step 1: Add ManagedStockLedger writes to adjust()**

Read current stock before update, write ledger after. For the adjust method (lines 170-365), after each Prisma update that changes stock:

```typescript
// Before the update, read current stock
const before = existingProduct?.managedStockQuantity ?? existingVariant?.managedStockQuantity ?? 0;

// After the update, compute after
const after = before + quantity;

// Write ledger
await this.prisma.managedStockLedger.create({
  data: {
    productId: productId || undefined,
    variantId: variantId || undefined,
    quantity: Math.abs(quantity),
    direction: quantity > 0 ? 'IN' : 'OUT',
    type: quantity > 0 ? 'MANUAL_ADD' : 'MANUAL_REMOVE',
    stockBefore: before,
    stockAfter: after,
    referenceType: 'ADJUSTMENT',
    note: reason,
    performedBy,
  },
});
```

- [ ] **Step 2: Add ManagedStockLedger writes to restockOrderItems()**

Similar pattern — for each stock increment in the restock loop, write ledger entry.

- [ ] **Step 3: Add availabilityMode guard to adjust()**

At top of adjust(), if productId or variantId is provided, fetch product and check:

```typescript
if (productId || variantId) {
  let product: any;
  if (variantId) {
    const variant = await this.prisma.productVariant.findUnique({ where: { id: variantId }, include: { product: true } });
    product = variant?.product;
  } else if (productId) {
    product = await this.prisma.product.findUnique({ where: { id: productId } });
  }
  if (product) {
    if (product.availabilityMode === 'ALWAYS_IN_STOCK') {
      throw new BadRequestException('Product is always in stock — no adjustments allowed');
    }
    if (product.availabilityMode === 'ALWAYS_OUT_OF_STOCK') {
      throw new BadRequestException('Product is always out of stock — no adjustments allowed');
    }
    if (product.availabilityMode === 'INVENTORY_CONTROLLED') {
      throw new BadRequestException('Use Purchase Orders for inventory-controlled products');
    }
    if (!product.manageStock) {
      throw new BadRequestException('Stock tracking is disabled for this product');
    }
  }
}
```

- [ ] **Step 4: Write ManagedStockLedger for transfers**

In transfer() method, after creating inventoryLog, also create ManagedStockLedger entry.

- [ ] **Step 5: Run backend typecheck + tests**

```bash
cd apps/backend && npx tsc --noEmit && npx jest --passWithNoTests
```

---

### Task 2: Backend — ManagedStockLedger query endpoint

**Files:**
- Create: `apps/backend/src/inventory/dto/ledger-query.dto.ts`
- Modify: `apps/backend/src/inventory/inventory.service.ts`
- Modify: `apps/backend/src/inventory/inventory.controller.ts`

- [ ] **Step 1: Create LedgerQueryDto**

```typescript
// apps/backend/src/inventory/dto/ledger-query.dto.ts
import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class LedgerQueryDto {
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsInt() @Min(1) @Type(() => Number) page?: number;
  @IsOptional() @IsInt() @Min(1) @Type(() => Number) perPage?: number;
}
```

- [ ] **Step 2: Add getLedger() method to inventory.service.ts**

```typescript
async getLedger(query: LedgerQueryDto) {
  const page = query.page || 1;
  const perPage = query.perPage || 50;
  const where: any = {};
  if (query.productId) where.productId = query.productId;
  if (query.variantId) where.variantId = query.variantId;

  const [data, total] = await Promise.all([
    this.prisma.managedStockLedger.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    this.prisma.managedStockLedger.count({ where }),
  ]);

  return {
    data,
    meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
  };
}
```

- [ ] **Step 3: Add endpoint to inventory.controller.ts**

```typescript
@Get('ledger')
@Roles('superadmin', 'admin', 'manager')
async getLedger(@Query() query: LedgerQueryDto) {
  return this.inventoryService.getLedger(query);
}
```

- [ ] **Step 4: Run backend typecheck**

---

### Task 3: Admin UI — Update inventory adjust dialog for availabilityMode

**Files:**
- Modify: `apps/admin/src/features/inventory/index.tsx`

- [ ] **Step 1: Show availabilityMode when product selected**

In the adjust dialog, after user selects a product (when `productId` is set and product details are fetched), show a badge/indicator for the product's availability mode:

Add state:
```typescript
const [selectedProductAvailability, setSelectedProductAvailability] = useState<string | null>(null)
```

When fetching product details (after productId is set), also store availabilityMode:
```typescript
// In the useEffect that fetches /products/${productId} (line ~96)
const p = r.data as any
setVariants(p?.variants || [])
setSelectedProductAvailability(p?.availabilityMode || null)
```

- [ ] **Step 2: Block adjust for non-MANAGED_STOCK products**

In the submit handler, if `selectedProductAvailability` is not `MANAGED_STOCK`, show toast error and return.

Also show a warning banner in the dialog when `selectedProductAvailability` is not `MANAGED_STOCK`:
```tsx
{selectedProductAvailability && selectedProductAvailability !== 'MANAGED_STOCK' && (
  <div className='bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2'>
    <p className='text-xs text-amber-700 dark:text-amber-300'>
      Availability mode: <strong>{selectedProductAvailability}</strong>. Stock adjustments are not allowed for this product.
    </p>
  </div>
)}
```

- [ ] **Step 3: Run admin typecheck**

---

### Task 4: Admin UI — Update stock overview for availabilityMode

**Files:**
- Modify: `apps/admin/src/features/inventory/overview.tsx`

- [ ] **Step 1: Add availabilityMode to Product interface**

```typescript
interface Product {
  // ... existing fields
  availabilityMode?: string;
  // ...
}
```

(Also in the variants array type — and in the backend stockOverview select, add `availabilityMode: true`)

- [ ] **Step 2: Add availabilityMode column to table**

After the type badge column or after the stock column, add:
```tsx
<TableCell className='text-right'>
  <Badge variant='outline' className='text-xs font-mono'>
    {p.availabilityMode === 'MANAGED_STOCK' ? 'Managed' :
     p.availabilityMode === 'INVENTORY_CONTROLLED' ? 'Inventory' :
     p.availabilityMode === 'ALWAYS_IN_STOCK' ? 'Always In' :
     p.availabilityMode === 'ALWAYS_OUT_OF_STOCK' ? 'Always Out' :
     p.availabilityMode || '—'}
  </Badge>
</TableCell>
```

- [ ] **Step 3: Add availabilityMode to backend stockOverview select**

In `apps/backend/src/inventory/inventory.service.ts` line ~519 (stockOverview select), add:
```typescript
availabilityMode: true,
```

- [ ] **Step 4: Run admin + backend typecheck**

---

### Task 5: Admin UI — Add ledger history to product detail page

**Files:**
- Modify: `apps/admin/src/features/products/components/product-detail.tsx`

This is optional but provides visibility into stock movements.

- [ ] **Step 1: Add ledger query to product detail**

After the existing stock badge on the product detail page, add a "Stock History" button or expandable section that fetches from `/inventory/ledger?productId={id}` and shows a table of movements.

- [ ] **Step 2: Run admin typecheck**

---

### Task 6: Verify everything

- [ ] **Step 1: Run backend typecheck**

```bash
cd apps/backend && npx tsc --noEmit
```

- [ ] **Step 2: Run backend tests**

```bash
cd apps/backend && npx jest --passWithNoTests
```

- [ ] **Step 3: Run admin typecheck**

```bash
cd apps/admin && npx tsc --noEmit
```

- [ ] **Step 4: Run shared tests**

```bash
cd packages/shared-types && npx vitest run
cd packages/feature-flags && npx vitest run
```
