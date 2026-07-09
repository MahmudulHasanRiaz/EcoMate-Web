# Business Domain Contract

> **Status:** Draft  
> **Authority:** Source of Truth for all business concept definitions  
> **Applies To:** All apps (admin, backend, storefront, pos)  
> **Supersedes:** Any conflicting definitions in historical plans under `docs/7-SUPERSEDED/`

## Core Principles

- **Availability ≠ Physical Inventory.** Product availability (managed stock) and physical warehouse inventory are separate concerns. Managed by different domains (Product vs Inventory).
- **Product Catalog is independent from Inventory.** Products exist without inventory tracking. Inventory requires products.
- **Managed Stock is a lightweight availability system.** A simple count on Product/Variant for sellable quantity. It is NOT warehouse inventory.
- **Inventory is the enterprise physical stock system.** Tracks physical items in specific warehouse locations with bins, lots, and valuation.
- **Business Requirements override Implementation.** What the business needs is higher authority than what code currently does.
- **Architecture Decisions must be documented as ADRs.** Every significant architectural choice has a written record.
- **Every feature has exactly one business owner.** No two domains may claim the same responsibility.
- **Every data mutation has exactly one authoritative service.** No Prisma model may be written by more than one service.
- **Only StockService may mutate managedStockQuantity or reservedStock.** Violations create dual-tracking drift.
- **Ledger records are append-only.** Once written, stock ledger entries are never modified or deleted.
- **Dual-mode Stock Architecture.** Inventory Management can be enabled or disabled per deployment. When disabled, Managed Stock is the primary system. When enabled, Physical Inventory is primary and Managed Stock is secondary (per-product sync).
- **Only StockService may mutate stock state.** Whether Inventory Management is enabled or disabled, all stock mutations (Managed Stock + Physical Inventory) route through StockService.

## Source of Truth Priority

1. **Business Requirements** — This document (highest authority)
2. **Architecture Decisions** — `docs/2-ARCHITECTURE/ADR/`
3. **Current Implementation** — Prisma schema, backend src, frontend components
4. **Documentation** — All other `docs/` files
5. **Historical Plans** — `docs/7-SUPERSEDED/`

**Rule:** If code contradicts this contract, code is wrong. If this contract contradicts business intent, update this contract.

---

## Source of Truth for Stock

Sales Availability and Physical Quantity are different concepts and may have different sources of truth.

### Sales Availability

Determines whether a product is shown as "in stock" on storefront/POS and whether an order can be created.

| availabilityMode | Inventory Management DISABLED | Inventory Management ENABLED |
|----------------|------------------------------|------------------------------|
| `ALWAYS_IN_STOCK` | Product Availability (always show) | Product Availability (always show) |
| `ALWAYS_OUT_OF_STOCK` | Product Availability (never show) | Product Availability (never show) |
| `MANAGED_STOCK` | Managed Stock (`managedStockQuantity - reservedStock > 0`) | Managed Stock (`managedStockQuantity - reservedStock > 0`) |
| `INVENTORY_CONTROLLED` | Falls back to MANAGED_STOCK behavior | Physical Inventory (`PhysicalInventory.quantity - PhysicalInventory.reservedQuantity > 0`) |

### Physical Quantity

The actual count of physical items in the warehouse. Only relevant when Inventory Management is enabled.

| Context | Source of Truth |
|---------|----------------|
| Inventory Management DISABLED | No Physical Quantity tracking |
| Inventory Management ENABLED | Physical Inventory (`PhysicalInventory.quantity`) |

---

## Canonical Domain Boundary

Products and Inventory are separate domains. Neither owns the other.

### Products own:
- Product Catalog (Product, ProductVariant, Category, Brand, Attribute)
- Availability Mode (ALWAYS_IN_STOCK, ALWAYS_OUT_OF_STOCK, MANAGED_STOCK, INVENTORY_CONTROLLED)
- Managed Stock (managedStockQuantity, reservedStock on ProductVariant)
- ManagedStockLedger (double-entry audit log for Managed Stock changes)
- Per-product syncManagedStock toggle

### Inventory owns:
- Warehouses (Warehouse, BinLocation)
- Physical Inventory (PhysicalInventory — quantity, reservedQuantity)
- Costing Lots (CostingLot — FIFO actual cost tracking)
- Physical Reservation (reservedQuantity on PhysicalInventory)
- Physical Ledger (future — double-entry log for physical movements)
- Allocation via PackingLock (Dispatch & Packing domain)

### StockService coordinates both:
- All stock mutations (Managed + Physical) route through StockService
- StockService calls are the only way to mutate managedStockQuantity, reservedStock, PhysicalInventory.quantity, or PhysicalInventory.reservedQuantity
- StockService does NOT own either domain — it is a coordination layer

---

## Domain Definitions

<!-- Each concept defined here is the single authoritative source.
     Terminology is normalized across backend, admin, storefront, and pos.
     Prisma model name noted where applicable. -->

### 1. Product
**Prisma:** `Product`  
**Definition:** A sellable item in the catalog. Has variants (SKU-level), attributes, categories, brands. Product owns Managed Stock — `managedStockQuantity` is the sum of variant stock, tracked via ManagedStockLedger.  
**Key constraints:** Has `availabilityMode` (enum: `ALWAYS_IN_STOCK`, `ALWAYS_OUT_OF_STOCK`, `MANAGED_STOCK`, `INVENTORY_CONTROLLED`). Has per-product setting `syncManagedStock` (when Inventory Management is enabled, controls whether Managed Stock is tracked alongside Physical Inventory).  
**Domain:** Products

### 2. ProductVariant
**Prisma:** `ProductVariant`  
**Definition:** SKU-level variation of a Product (size, color, etc.). Carries `managedStockQuantity` and `reservedStock`.  
**Stock tracking:** Should route through StockService but currently has bypasses — see `docs/2-ARCHITECTURE/STATE_MACHINES.md§6` for current violations.  
**Domain:** Products

### 3. ManagedStockLedger
**Prisma:** `ManagedStockLedger`  
**Definition:** Full double-entry stock ledger for Managed Stock. Every entry has `direction` (IN/OUT), `stockBefore`, `stockAfter`, `referenceType`, `referenceId`.  
**Authority:** Single source of truth for all Managed Stock movement history.  
**Domain:** Products

### 4. InventoryLog
**Prisma:** `InventoryLog`  
**Definition:** Simple timestamped record of a stock change. No direction field, no before/after snapshots.  
**Status:** Legacy system — superseded by ManagedStockLedger for new writes. Existing records retained for history.  
**Domain:** Inventory

### 5. Physical Inventory
**Prisma:** `PhysicalInventory`  
**Definition:** Countable physical items in a warehouse location. Distinct from Managed Stock. Has `quantity` (on-hand) and `reservedQuantity` (held by confirmed/pending orders). Handled via inventory adjustments, counts, transfers between bin locations. Uses Inventory Ledger (future) for tracking.  
**Domain:** Inventory

### 6. Warehouse
**Prisma:** `Warehouse`  
**Definition:** Physical or virtual location where physical inventory is stored. Contains `BinLocation` records.  
**Domain:** Inventory

### 7. BinLocation
**Prisma:** `BinLocation`  
**Definition:** A specific storage position within a warehouse (e.g., "Aisle-1, Rack-3, Shelf-B").  
**Domain:** Inventory

### 8. CostingLot
**Prisma:** `CostingLot`  
**Definition:** FIFO costing lot for tracking actual cost of received inventory. Used for Actual COGS calculation.  
**Domain:** Inventory

### 9. Order
**Prisma:** `Order`  
**Definition:** Customer purchase transaction. Lifecycle: Pending → Payment Verifying → Confirmed → Packing Hold → Packed → Shipping → Delivered. Can be Cancelled (pre-dispatch) or Returned (post-dispatch). Order status is distinct from Dispatch status (Shipping is the parallel order status during dispatch).  
**Domain:** Orders

### 10. OrderItem
**Prisma:** `OrderItem`  
**Definition:** Line item on an order. Links to ProductVariant. Contains `costSnapshot` (cost at time of order, with `costType: estimated|actual`).  
**Domain:** Orders

### 11. Purchase
**Prisma:** `Purchase`  
**Definition:** Stock procurement from a supplier. Purchase owns GRN — on receipt, GoodsReceiptNote is created which triggers StockService.add() for managed stock and physical inventory receipt.  
**Domain:** Purchases

### 12. GoodsReceiptNote (GRN)
**Prisma:** `GoodsReceiptNote`  
**Definition:** Document confirming receipt of purchased goods. Triggers managed stock addition via StockService and updates physical inventory.  
**Domain:** Purchases

### 13. Dispatch
**Prisma:** `Dispatch`  
**Definition:** Outbound shipment of packed items to customer. State machine: PENDING → DISPATCHED → HANDED_OVER → PICKED_UP → IN_TRANSIT → ASSIGNED_TO_RIDER → DELIVERED. Can enter RETURN_PENDING → Returned from DELIVERED. Dispatch HANDED_OVER triggers Physical Inventory deduction via StockService.  
**Domain:** Dispatch & Packing

### 14. PackingLock
**Prisma:** `PackingLock`  
**Definition:** Temporary hold on inventory items being packed for an order. Prevents double-allocation during packing process.  
**Domain:** Dispatch & Packing

### 15. Campaign
**Prisma:** `Campaign`  
**Definition:** Marketing campaign for promotions, discounts, or targeted offers.  
**Domain:** Sales & Marketing

### 16. Referral
**Prisma:** `Referral`  
**Definition:** Customer referral tracking for referral-based marketing.  
**Domain:** Sales & Marketing

### 17. Coupon
**Prisma:** `Coupon`  
**Definition:** Discount code applicable to orders. Has usage limits, expiry, and scope.  
**Domain:** Sales & Marketing

### 18. Employee
**Prisma:** `Employee`  
**Definition:** Staff member with system access. Linked to a User account. Has roles and permissions.  
**Domain:** Finance & HR

### 19. Payroll
**Prisma:** `Payroll`  
**Definition:** Employee salary and payment records.  
**Domain:** Finance & HR

### 20. Accounting
**Prisma:** `Accounting` (or related models)  
**Definition:** Financial transaction records for double-entry bookkeeping.  
**Domain:** Finance & HR

### 21. Account (Chart of Accounts)
**Prisma:** `Account`  
**Definition:** Named financial account in the chart of accounts (e.g., "Cash", "Inventory Asset", "Accounts Receivable").  
**Domain:** Finance & HR

### 22. License
**Definition:** Per-client license managed via KeyMate/Keygen integration. Each deployment has a unique license key that gates feature availability. 7-day local cache.  
**Domain:** System

### 23. Feature Flag
**Definition:** Runtime toggle for a licensed feature. Checked via `@RequiresFeature()` decorator on controllers. Guarded by `FeatureGuard`.  
**Prisma Model:** FeatureFlag  
**Domain:** System

### 24. User
**Prisma:** `User` (Better Auth schema)  
**Definition:** System user. Authenticated via either legacy JWT or Better Auth (dual mode). Linked to optional Employee record.  
**Domain:** Auth

### 25. Analytics (Page View)
**Prisma:** `PageView`  
**Definition:** Tracked page view event in the storefront. Used for reporting and dashboard widgets.  
**Domain:** Analytics

### 26. Category
**Prisma:** `Category`  
**Definition:** Hierarchical product categorization. Products can belong to multiple categories.  
**Domain:** Products

### 27. Brand
**Prisma:** `Brand`  
**Definition:** Product brand/manufacturer.  
**Domain:** Products

### 28. Attribute
**Prisma:** `Attribute` / `AttributeValue`  
**Definition:** Product variant dimension (e.g., "Size", "Color"). Attributes combine via cartesian product to generate variant SKUs.  
**Domain:** Products

### 29. Combo
**Prisma:** `ComboProduct` or similar  
**Definition:** Bundled product offering — multiple products sold as a single unit.  
**Domain:** Products

### 30. Media Gallery
**Definition:** Centralized image/video management for products, categories, and brand assets. Supports bulk selection.  
**Domain:** Products

### 31. POS (Point of Sale)
**Location:** `apps/pos/`  
**Definition:** In-store sales terminal application. Creates orders in the backend via POS-specific API. Respects all order lifecycle rules.  
**Domain:** POS

### 32. Inventory Management Feature
**Definition:** Licensed feature toggle. When **enabled** → Physical Inventory is the primary stock system, Managed Stock is secondary (per-product `syncManagedStock`). When **disabled** → Managed Stock is the sole stock system. Controlled via license + system settings.
**Domain:** System

### 33. ManagedStockSync (Per-Product Setting)
**Definition:** When Inventory Management is enabled, each product has a `syncManagedStock` boolean. When ON → Managed Stock mutations (deduct/restore) happen in parallel with Physical Inventory. When OFF → Only Physical Inventory is tracked; Managed Stock is static.
**Domain:** Products

---

## Business Glossary

Every term has exactly one definition. This is the only authoritative terminology source.

| Term | Definition | Domain | Prisma Model |
|------|-----------|--------|-------------|
| **Product** | A sellable item in the catalog. Has SKU-level variants. | Products | `Product` |
| **Variant** | SKU-level variation of a Product (size, color, etc.). Carries managed stock and reservation. | Products | `ProductVariant` |
| **Managed Stock** | Lightweight quantity tracking on Product/Variant. Represented by `managedStockQuantity`. NOT physical inventory. | Products | `managedStockQuantity` field |
| **Physical Inventory** | Countable physical items in a warehouse location. Distinct from Managed Stock. | Inventory | — |
| **Inventory Controlled** | `availabilityMode` value where Product availability is determined by physical inventory levels, not managed stock count. | Products | `availabilityMode` enum |
| **Available** | For Managed Stock: `managedStockQuantity` minus `reservedStock`. For Physical Inventory: `quantity` minus `reservedQuantity`. Quantity that can be sold/allocated. | Products / Inventory | computed |
| **Reserved** | Stock held by pending or confirmed orders. Managed Stock: `reservedStock` on ProductVariant. Physical Inventory: `reservedQuantity` on PhysicalInventory. Released on cancellation, deducted on HANDED_OVER. | Products / Inventory | `reservedStock` / `reservedQuantity` |
| **Allocated** | Stock physically picked and packed for dispatch. Follows Reservation. Tracked via PackingLock. | Inventory | `PackingLock` |
| **On Hand** | For Managed Stock: `managedStockQuantity`. For Physical Inventory: PhysicalInventory.`quantity`. Fully independent values. | Products / Inventory | computed |
| **Warehouse** | Physical or logical storage location where physical inventory is stored. | Inventory | `Warehouse` |
| **Bin** | Specific position within a warehouse (e.g., "Aisle-1, Rack-3, Shelf-B"). | Inventory | `BinLocation` |
| **Lot** | Batch/costing lot for FIFO tracking of received inventory. Used for Actual COGS. | Inventory | `CostingLot` |
| **Batch** | Synonym for Lot. | Inventory | `CostingLot` |
| **Adjustment** | Manual correction to physical inventory count. Creates ledger entry. | Inventory | — |
| **Reservation** | Holding stock (Managed + Physical) for an order. Managed: via StockService.reserve() → reservedStock++. Physical: via StockService.reservePhysical() → reservedQuantity++. Timing depends on availabilityMode (CONFIRM for MANAGED_STOCK, CREATE for INVENTORY_CONTROLLED). | Products / Inventory | — |
| **Allocation** | Physical assignment of inventory items to a specific dispatch. Uses PackingLock. | Inventory | `PackingLock` |
| **Transfer** | Moving physical inventory between warehouses or bins. Creates Inventory Ledger entries. | Inventory | — |
| **Dispatch** | Outbound shipment of packed items to customer. Courier assignment and tracking belong here. | Dispatch & Packing | `Dispatch` |
| **Return** | Customer returning previously purchased items. May trigger managed stock addition and/or physical inventory receipt. | Orders | — |
| **Refund** | Money returned to customer for a return or cancellation. Financial transaction. | Finance & HR | — |
| **Estimated Cost** | Cost of goods at time of order entry. Captured as `costSnapshot` with `costType: 'estimated'`. | Products | `costSnapshot` |
| **Actual Cost** | True cost of goods determined by FIFO lot tracking. Captured as `costSnapshot` with `costType: 'actual'`. | Inventory | `CostingLot` |
| **Estimated COGS** | Cost of Goods Sold based on estimated cost snapshot. | Finance & HR | computed |
| **Actual COGS** | Cost of Goods Sold based on actual cost from FIFO costing lots. | Finance & HR | computed |
| **Managed Stock Ledger** | Double-entry audit log for all Managed Stock changes. Direction, before/after snapshots. | Products | `ManagedStockLedger` |
| **Inventory Ledger** | (Future) Double-entry log for physical inventory movements. Separate from ManagedStockLedger. | Inventory | (future) |
| **GRN** | Goods Receipt Note. Document confirming receipt of purchased goods. | Purchases | `GoodsReceiptNote` |
| **Courier** | Third-party shipping provider for dispatching orders. | Dispatch & Packing | — |
| **Payment Gateway** | Third-party payment processor (bKash, Nagad, SSLCommerz, etc.). | Finance & HR | — |

---

## Cross-Cutting Rules

### Stock Service Centralization Rule
All stock mutations — Managed Stock AND Physical Inventory — MUST route through `StockService`. StockService is the single gateway for: `reserve`, `reservePhysical`, `deduct`, `deductPhysical`, `release`, `releasePhysical`, `add`, `addPhysical`. No module may directly mutate `managedStockQuantity`, `reservedStock`, `PhysicalInventory.quantity`, or `PhysicalInventory.reservedQuantity`.

### Managed Stock Operation Rule
All managed stock mutations (`reserve`, `deduct`, `release`, `add`) MUST go through `StockService`. No direct Prisma writes to `managedStockQuantity` or `reservedStock`. Violations create dual-tracking drift between actual state and ManagedStockLedger.

### Physical Inventory Operation Rule
All physical inventory mutations (`reservePhysical`, `deductPhysical`, `releasePhysical`, `addPhysical`) MUST go through `StockService`. PhysicalInventory fields (`quantity`, `reservedQuantity`) are never directly mutated by any other service.

### Order Stock Deduction Rule
- **Inventory Management DISABLED:** Order Confirm triggers `StockService.deduct()` for Managed Stock. HANDED_OVER has no stock impact.
- **Inventory Management ENABLED:** Order Confirm triggers Physical Inventory check + reserve via `StockService`. Dispatch HANDED_OVER triggers `StockService.deductPhysical()`. Managed Stock is optionally synced per-product (`syncManagedStock`).
- **Current implementation violates this** — see `docs/1-BUSINESS/ARCHITECTURE_INVARIANTS.md` violation table.

### Stock Reservation Timing Rule
Physical Inventory reservation timing depends on product `availabilityMode`:
- `MANAGED_STOCK` → reserve at Order **Confirm** (storefront shows managed stock; physical stock checked at confirm)
- `INVENTORY_CONTROLLED` → reserve at Order **Create** (storefront shows physical stock; already know it exists)
- `ALWAYS_IN_STOCK` → reserve at Order **Confirm**
- `ALWAYS_OUT_OF_STOCK` → Order creation **blocked** entirely (no reservation needed)

### Out-of-Stock Guard Rule
If `availabilityMode` is `ALWAYS_OUT_OF_STOCK`, ALL order creation paths MUST reject the order. No exceptions. This applies to admin, storefront, and POS.

### Physical Inventory Deduction Timing Rule
Physical Inventory `quantity` is decremented ONLY at Dispatch HANDED_OVER (not at Order Confirm). Between Confirm and HANDED_OVER, stock is held in `reservedQuantity`.

### Costing Rule (HANDED_OVER)
- **Inventory Management DISABLED:** Cost deducted from Managed Stock costing (standard cost / average cost).
- **Inventory Management ENABLED:** Cost deducted from Physical Inventory CostingLot (FIFO actual cost).

### Per-Product Managed Stock Sync Rule
When Inventory Management is ENABLED, each Product has a `syncManagedStock` toggle:
- `ON`: StockService updates BOTH Managed Stock (managedStockQuantity) and Physical Inventory in parallel on all operations.
- `OFF`: StockService updates ONLY Physical Inventory. Managed Stock is static and used only for storefront display (availabilityMode = MANAGED_STOCK).

### Inventory Control Rule
When a Product has `availabilityMode: INVENTORY_CONTROLLED`, its storefront availability is determined by physical inventory levels (PhysicalInventory.quantity - PhysicalInventory.reservedQuantity > 0). If Inventory Management is DISABLED, this mode falls back to MANAGED_STOCK behavior.

### License Enforcement Rule
Every licensed feature must have `@RequiresFeature()` on its controller. The feature must be registered in FEATURE_REGISTRY.md. The 68-feature system from `final-feature-plan.md` must be verified against actual `@RequiresFeature()` usage.

### Purchase-to-Stock Rule
Purchase owns GRN. Receiving goods triggers StockService.add() (+ addPhysical() if Inventory Management enabled) for managed stock and physical inventory receipt. Inventory never creates purchase orders.

### Always-Open Rule
No rule in this document may be considered "final." All rules are subject to revision as business requirements evolve. Update this document when business intent changes.