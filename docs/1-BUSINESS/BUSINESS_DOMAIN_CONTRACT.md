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

## Source of Truth Priority

1. **Business Requirements** — This document (highest authority)
2. **Architecture Decisions** — `docs/2-ARCHITECTURE/ADR/`
3. **Current Implementation** — Prisma schema, backend src, frontend components
4. **Documentation** — All other `docs/` files
5. **Historical Plans** — `docs/7-SUPERSEDED/`

**Rule:** If code contradicts this contract, code is wrong. If this contract contradicts business intent, update this contract.

---

## Domain Definitions

<!-- Each concept defined here is the single authoritative source.
     Terminology is normalized across backend, admin, storefront, and pos.
     Prisma model name noted where applicable. -->

### 1. Product
**Prisma:** `Product`  
**Definition:** A sellable item in the catalog. Has variants (SKU-level), attributes, categories, brands. Product owns Managed Stock — `managedStockQuantity` is the sum of variant stock, tracked via ManagedStockLedger.  
**Key constraints:** Has `availabilityMode` (enum: `ALWAYS_IN_STOCK`, `ALWAYS_OUT_OF_STOCK`, `MANAGED_STOCK`, `INVENTORY_CONTROLLED`).  
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
**Definition:** Countable physical items in a warehouse location. Distinct from Managed Stock. Handled via inventory adjustments, counts, transfers between bin locations. Uses Inventory Ledger (future) for tracking.  
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
**Definition:** Customer purchase transaction. Lifecycle: draft → confirmed → processing → packed → dispatched → delivered → completed. Can be cancelled/returned at various stages.  
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
**Definition:** Outbound shipment of packed items to customer. After dispatch, managed stock is deducted. Courier assignment belongs here.  
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
| **Available** | `managedStockQuantity` minus `reservedStock`. Quantity that can be sold. | Products | computed |
| **Reserved** | Stock held by pending but unconfirmed orders. Represented by `reservedStock` field. Released on cancellation, deducted on confirmation. | Products | `reservedStock` |
| **Allocated** | Stock physically picked and packed for dispatch. Follows Reservation. Tracked via PackingLock. | Inventory | `PackingLock` |
| **On Hand** | For Managed Stock: `managedStockQuantity`. For Physical Inventory: current physical count. | Products / Inventory | computed |
| **Warehouse** | Physical or logical storage location where physical inventory is stored. | Inventory | `Warehouse` |
| **Bin** | Specific position within a warehouse (e.g., "Aisle-1, Rack-3, Shelf-B"). | Inventory | `BinLocation` |
| **Lot** | Batch/costing lot for FIFO tracking of received inventory. Used for Actual COGS. | Inventory | `CostingLot` |
| **Batch** | Synonym for Lot. | Inventory | `CostingLot` |
| **Adjustment** | Manual correction to physical inventory count. Creates ledger entry. | Inventory | — |
| **Reservation** | Holding managed stock for an order via StockService.reserve(). Creates ManagedStockLedger entry. | Products | — |
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

### Managed Stock Operation Rule
All managed stock mutations (`reserve`, `deduct`, `release`, `add`) MUST go through `StockService`. No direct Prisma writes to `managedStockQuantity` or `reservedStock`. Violations create dual-tracking drift between actual state and ManagedStockLedger.

### Order Stock Deduction Rule
When an order is confirmed, `StockService.deduct()` SHOULD be called. **Current implementation violates this** — OrdersService.deductStockForOrder() uses direct Prisma writes (see `docs/1-BUSINESS/ARCHITECTURE_INVARIANTS.md` violation table). When cancelled/returned, StockService.release() or StockService.add() should be used, but OrdersService currently bypasses StockService for restore/return paths.

### License Enforcement Rule
Every licensed feature must have `@RequiresFeature()` on its controller. The feature must be registered in FEATURE_REGISTRY.md. The 68-feature system from `final-feature-plan.md` must be verified against actual `@RequiresFeature()` usage.

### Purchase-to-Stock Rule
Purchase owns GRN. Receiving goods triggers StockService.add() for managed stock and physical inventory receipt. Inventory never creates purchase orders.

### Inventory Control Rule
When a Product has `availabilityMode: INVENTORY_CONTROLLED`, its availability is determined by physical inventory levels (not managedStockQuantity). Implementation of this mode is pending.