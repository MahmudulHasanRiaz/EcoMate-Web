# Admin + Storefront UI Plan

> **Date:** 2026-07-09  
> **Status:** Draft  
> **Cross-reference:** `ARCHITECTURE_GAP_FIX_PLAN.md` (backend gaps), `ARCHITECTURE_INVARIANTS.md` (business rules)

---

## Overview

Frontend implementation for the 24 backend architecture gaps fixed in Phases A–E. Covers:

1. **Admin App:** Physical Inventory Management UI, Order Status State Machine, Stock Adjustment enhancements
2. **Storefront:** Out-of-Stock product display, ALWAYS_OUT_OF_STOCK awareness, cart stock validation

---

## Workstream 1: Admin — Physical Inventory Suite

### Routes

All under existing `/op/inventory/` section. Two new routes:

| Route | Component | Description |
|---|---|---|
| `/op/inventory/physical` | `PhysicalStockTable` | Product × Warehouse stock grid |
| `/op/inventory/reservations` | `ReservationDashboard` | Active reservation list |

Enhanced existing routes:

| Route | Enhancement |
|---|---|
| `/op/inventory/` | Toggle between "Managed Stock" and "Physical Inventory" views |
| `/op/inventory/warehouses` | Per-warehouse Physical Inventory tab |
| `/op/inventory/adjustments` | Mode selector (Managed / Physical) + Warehouse field |
| `/op/inventory/transfers` | Warehouse-to-warehouse Physical Quantity transfer |

### PhysicalStockTable (`/op/inventory/physical`)

**Purpose:** Display and manage PhysicalInventory records (productId × warehouseId).

**Columns:**
- Product Name, SKU, Warehouse, Quantity, Reserved Qty, Available Qty (quantity - reservedQuantity)
- Color-coded Available Qty: green (>0), yellow (=0), red (<0 — data integrity issue)

**Features:**
- Search by product name/SKU
- Filter by warehouse (dropdown)
- Pagination (server-side)
- Row click → opens `PhysicalStockDetailSheet` with:
  - Full record details
  - Recent movement history for this product+warehouse
  - "Quick Adjust" button

**Quick Adjust Dialog:**
- shadcn Sheet/Dialog
- Fields: Quantity (positive=add, negative=remove), Reason (required), Performed By (auto)
- Submit → `stockService.addPhysical()` via `PATCH /inventory/physical`
- Success toast with before/after values

**Bulk Adjust:**
- Checkbox selection → bulk action bar
- "Adjust Selected" → dialog with Quantity field applied to all selected
- Same backend route, called per-item in sequence

### Reservation Dashboard (`/op/inventory/reservations`)

**Purpose:** Show active reservations (reservedQuantity > 0 on PhysicalInventory).

**Columns:**
- Order ID (linked), Product, Warehouse, Reserved Qty, Reserved At, Order Status

**Features:**
- Filter by warehouse, product, date range
- "Release Reservation" button (admin override) → calls `stockService.releasePhysical()`
- Auto-refresh every 30 seconds for near-real-time view

### Stock Levels Page Toggle

On `/op/inventory/` page, add a segmented control (shadcn ToggleGroup):
- **"Managed Stock"** — existing columns (Product, Variant, Stock, Reserved, Available)
- **"Physical Inventory"** — shows PhysicalInventory data in same table format

### Warehouse Detail Enhancement

On `/op/inventory/warehouses/$id` (or detail drawer), add a "Stock" tab showing:
- All PhysicalInventory records for this warehouse
- Search/filter by product
- Same Quick Adjust functionality

---

## Workstream 2: Admin — Order Status State Machine

### Order Detail Page (`/op/orders/$id`)

**Component:** `OrderStatusMachine` — renders an interactive directed graph of the 14 statuses.

**Visual layout:**

```
                    ┌─────────┐
                    │ Pending │ (gray — already passed)
                    └────┬────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
        ┌──────────┐ ┌──────┐ ┌──────────┐
        │ Payment  │ │ Hold │ │Confirmed │ ← green glow = current
        │ Pending  │ └──────┘ └────┬──────┘
        └────┬─────┘               │
             ▼                     ▼
       ┌───────────┐        ┌──────────┐
       │ Payment   │        │  Packed  │ ← blue outline = allowed next
       │ Verifying │        └────┬─────┘
       └─────┬─────┘             │
             ▼                   ▼
        ┌──────────┐       ┌───────────┐
        │ Confirmed│       │ Packing   │
        └──────────┘       │   Hold    │
                           └───────────┘
```

**Rules:**
- **Gray nodes:** statuses already passed (in timeline)
- **Green node + pulse animation:** current status
- **Blue outlined nodes:** allowed next transitions (from ORDER_TRANSITIONS constant)
- **Clickable blue nodes:** clicking opens confirmation dialog → calls `ordersService.updateStatus()`
- **Red nodes:** Cancelled, Damaged — shown but not clickable unless allowed transition
- **SVG arrows:** connecting lines between connected statuses, gray for passed, blue for available

**Technical approach:** Pure React component using CSS Grid + inline SVG for arrows. No external graph library — the graph is small (14 nodes) and the layout is deterministic.

**Edge cases:**
- Current status = Cancelled/Damaged → no blue nodes, message "Order is final"
- Bulk status change page → compact version (list of checkboxes with allowed transitions displayed as badges)

### Transition Confirmation Dialog

When user clicks an allowed next status:
1. shadcn AlertDialog opens
2. Text: "Move order #{displayId} from {current} to {next}?"
3. Optional note field
4. Confirm → `POST /orders/{id}/status` → success toast → diagram re-renders

### Bulk Status Change Page (`/op/orders/`)

Existing bulk status change already works. Enhancement:
- Before confirming, show a summary: "X orders will transition from [status] to [status]"
- Show warning if any selected orders cannot transition (skipped list)

---

## Workstream 3: Admin — Stock Adjustment Enhancements

### Adjustment Form (`/op/inventory/adjustments`)

**Mode Selector:** Segmented control
- **Managed Stock** — existing fields (Product/Variant search, Quantity, Reason)
- **Physical Inventory** — same + Warehouse search (required)

**Fields:**
- Product search (searchable-select, fetches `/products`)
- Variant (optional, shown when product.type === 'variable')
- Warehouse (only shown in Physical mode)
- Quantity (number input, positive = add, negative = remove)
- Reason (text, required)
- Performed By (auto from auth)

**Submission:**
- Managed mode → `POST /inventory/adjust` → routes through `stockService.add()`/`stockService.scrap()`
- Physical mode → `POST /inventory/physical/adjust` → routes through `stockService.addPhysical()`
- Success toast with before/after stock values
- Error handling: insufficient stock, product not found, warehouse mismatch

### Adjustment History (`/op/inventory/adjustments?tab=history`)

New tab showing all stock movements from ManagedStockLedger + InventoryLog.

**Columns:**
- Date, Product, Variant, Type (MANUAL_ADD/MANUAL_REMOVE/ORDER_DEDUCTION/RETURN/etc.), Qty, Reason, Performed By
- Reference link (clickable: links to order, return, etc.)
- Filter by type, date range, product

---

## Workstream 4: Storefront — Stock Availability & OOS

### 4a. ProductCard Enhancement

**File:** `apps/storefront/components/ProductCard.tsx`

**Changes:**
- Import `availabilityMode` from product API response
- Add badge logic above product image:

```tsx
{product.availabilityMode === 'ALWAYS_OUT_OF_STOCK' && (
  <span className="absolute top-2 left-2 bg-red-500 text-white text-xs px-2 py-0.5 rounded-full font-medium">
    Out of Stock
  </span>
)}
{product.manageStock && product.stock === 0 && product.stock !== undefined && (
  <span className="absolute top-2 left-2 bg-red-500 text-white text-xs px-2 py-0.5 rounded-full font-medium">
    Out of Stock
  </span>
)}
```

- Disable "ADD TO CART" button when OOS:

```tsx
<button disabled={isOOS} className={cn(isOOS && 'opacity-50 cursor-not-allowed')}>
  {isOOS ? 'OUT OF STOCK' : 'ADD TO CART'}
</button>
```

- Settings gated: only show if `hideOosFromArchive === false`

### 4b. ProductDetailClient — ALWAYS_OUT_OF_STOCK Awareness

**File:** `apps/storefront/components/ProductDetailClient.tsx`

**Changes:**
- Backend now returns `availabilityMode` on product detail endpoint
- Update `effectiveStock` computation:
  - If `product.availabilityMode === 'ALWAYS_OUT_OF_STOCK'` → `displayStock = 0` regardless of variant stock
- Update StockBadge component:
  - `ALWAYS_OUT_OF_STOCK` → "Permanently Unavailable" (红色, different text from regular OOS)
  - Regular `stock === 0` → "Out of Stock" (existing)
- Update CTA: OOS button shows "PERMANENTLY UNAVAILABLE" for ALWAYS_OUT_OF_STOCK vs "OUT OF STOCK" for regular

### 4c. VariantSelector — ALWAYS_OUT_OF_STOCK Guard

**File:** `apps/storefront/components/VariantSelector.tsx` (or inline in ProductDetailClient)

**Changes:**
- When parent product `availabilityMode === 'ALWAYS_OUT_OF_STOCK'`:
  - ALL variants disabled regardless of individual stock level
  - Hover tooltip: "This product is permanently unavailable"
- Existing per-variant `stock <= 0` check still applies for regular OOS

### 4d. Cart — OOS Prevention

**File:** `apps/storefront/context/CartContext.tsx`

**Changes:**
- In `addItem` method: before adding, check if product/variant is OOS:
  - `product.availabilityMode === 'ALWAYS_OUT_OF_STOCK'` → reject with toast "This product is permanently unavailable"
  - `stock === 0` and `manageStock === true` → reject with toast "This item is out of stock"
- Backend already guards order creation (Phase E P1-B3) — this is client-side UX improvement only

---

## Dependencies: Backend Work Needed

Before starting frontend, these backend additions are required:

### New controller: PhysicalInventoryController

File: `apps/backend/src/inventory/physical-inventory.controller.ts`

```typescript
@Controller('inventory/physical')
export class PhysicalInventoryController {
  constructor(private readonly stockService: StockService) {}

  @Get()
  async list(@Query() query: { productId?: string; warehouseId?: string; page?: number; perPage?: number }) {
    // Returns paginated PhysicalInventory records with product + warehouse info
  }

  @Patch('adjust')
  async adjust(@Body() dto: { productId: string; warehouseId: string; quantity: number; reason: string }) {
    // Routes to stockService.addPhysical()
  }

  @Get('reservations')
  async reservations(@Query() query: { warehouseId?: string; productId?: string }) {
    // Returns PhysicalInventory records where reservedQuantity > 0
  }

  @Delete('reservations/:id')
  async releaseReservation(@Param('id') id: string) {
    // Routes to stockService.releasePhysical()
  }
}
```

### Storefront type updates

`apps/storefront/lib/types.ts` — Add `availabilityMode` field:

```typescript
interface Product {
  // ... existing fields
  availabilityMode?: 'MANAGED_STOCK' | 'ALWAYS_IN_STOCK' | 'ALWAYS_OUT_OF_STOCK' | 'INVENTORY_CONTROLLED';
}

interface Variant {
  // ... existing fields
  stock: number;
}
```

(Note: `Variant.stock` already exists, `Product.availabilityMode` is already returned by API but not typed in storefront.)

---

## API Endpoints Required

### New endpoints:

| Method | Route | Purpose | Backend Handler |
|---|---|---|---|
| `GET` | `/inventory/physical` | List PhysicalInventory records | `PhysicalInventoryController.list()` |
| `PATCH` | `/inventory/physical/adjust` | Adjust PhysicalInventory quantity | `PhysicalInventoryController.adjust()` → `stockService.addPhysical()` |
| `GET` | `/inventory/physical/reservations` | List active reservations | `PhysicalInventoryController.reservations()` |
| `DELETE` | `/inventory/physical/reservations/:id` | Release a reservation | `PhysicalInventoryController.releaseReservation()` → `stockService.releasePhysical()` |
| `GET` | `/inventory/physical/ledger` | Physical inventory movement history | New controller method |

### Modified endpoints:

| Method | Route | Change |
|---|---|---|
| `GET` | `/products/:id` | Already returns `availabilityMode` (Prisma includes all fields) — no change |
| `GET` | `/products` | Already returns `availabilityMode` — no change |
| `POST` | `/inventory/adjust` | Already routes through StockService (Phase C) — no change |
| `GET` | `/inventory/adjustments` | Add `type` filter, include ManagedStockLedger entries |

---

## Data Flow Diagrams

### Physical Inventory Adjustment Flow

```
User (Admin UI)
  │
  ▼
PhysicalStockTable → "Quick Adjust" button
  │
  ▼
AdjustDialog (quantity, reason, warehouse)
  │
  ▼
PATCH /inventory/physical/adjust
  │
  ▼
Backend Controller
  │
  ▼
stockService.addPhysical({ productId, warehouseId, quantity, reference, performedBy })
  │
  ├── applyPhysicalChange (upsert PhysicalInventory)
  ├── (if syncManagedStock) applyStockChange → update managedStockQuantity
  │
  ▼
Response: { before: N, after: N + qty }
  │
  ▼
Toast: "Stock adjusted: {before} → {after}"
```

### Order Status Transition Flow

```
User (Order Detail Page)
  │
  ▼
OrderStatusMachine diagram → click "Shipping" node
  │
  ▼
ConfirmDialog: "Move to Shipping?"
  │
  ▼
POST /orders/{id}/status { status: "Shipping" }
  │
  ▼
ordersService.updateStatus()
  │
  ├── Validate against ORDER_TRANSITIONS (P1-V4)
  ├── Begin transaction
  │   ├── Update order.statusId
  │   ├── Append to timeline
  │   └── Execute side effects (stock release, etc.)
  ├── Commit
  │
  ▼
Response: { success: true, from: "Packed", to: "Shipping" }
  │
  ▼
Diagram re-renders: "Shipping" becomes green, allowed next: "Delivered", "Partial"
```

---

## Migration / Rollout

No data migration needed. All backend changes are already deployed (Phases A–E).

**Order of implementation:**

1. Admin Physical Inventory endpoints (new backend controller methods)
2. Admin PhysicalStockTable + ReservationDashboard
3. Admin OrderStatusMachine component
4. Admin Stock Adjustment enhancements
5. Storefront ProductCard + StockBadge updates
6. Storefront Cart OOS prevention

---

## Design Principles

1. **Business-friendly:** No technical jargon in UI. "Available Stock" not "managedStockQuantity - reservedStock"
2. **Modern 2026:** Clean whitespace, subtle shadows (not flat, not skeuomorphic), micro-animations on state changes, shadcn/ui New York style
3. **Consistent:** Follows existing admin patterns — DataTable for lists, Sheet/Dialog for forms, react-query for data
4. **Mobile-aware:** Admin already responsive — new components tested at 320px–1920px
5. **Fast:** All list pages use server-side pagination, no client-side sorting of large datasets
6. **Accessible:** Keyboard-navigable state machine, aria-labels on diagram nodes, focus management in dialogs
