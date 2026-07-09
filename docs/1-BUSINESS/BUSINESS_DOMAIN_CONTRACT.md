# Business Domain Contract

> **Status:** Draft  
> **Authority:** Source of Truth for all business concept definitions  
> **Applies To:** All apps (admin, backend, storefront, pos)  
> **Supersedes:** Any conflicting definitions in historical plans under `docs/7-SUPERSEDED/`

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
**Definition:** A sellable item in the catalog. Has variants (SKU-level), attributes, categories, brands.  
**Managed Stock:** `managedStockQuantity` on Product represents sum of all variant stock. Direct editing on Product is DISABLED — use StockService.  
**Key constraints:** Has `availabilityMode` (enum: `ALWAYS_IN_STOCK`, `ALWAYS_OUT_OF_STOCK`, `MANAGED_STOCK`, `INVENTORY_CONTROLLED`).  
**Domain:** Products

### 2. ProductVariant
**Prisma:** `ProductVariant`  
**Definition:** SKU-level variation of a Product (size, color, etc.). Carries `managedStockQuantity` and `reservedStock`.  
**Stock tracking:** Every stock operation goes through StockService which updates variant stock + writes ManagedStockLedger.  
**Domain:** Products

### 3. InventoryLog
**Prisma:** `InventoryLog`  
**Definition:** Simple timestamped record of a stock change. No direction field, no before/after snapshots.  
**Status:** Legacy system — superseded by ManagedStockLedger for new writes. Existing records retained for history.  
**Domain:** Inventory

### 4. ManagedStockLedger
**Prisma:** `ManagedStockLedger`  
**Definition:** Full double-entry stock ledger. Every entry has `direction` (IN/OUT), `stockBefore`, `stockAfter`, `referenceType`, `referenceId`.  
**Authority:** Single source of truth for all stock movement history going forward.  
**Domain:** Inventory

### 6. StockService
**Location:** `apps/backend/src/stock/stock.service.ts`  
**Definition:** Single gateway for all stock mutations. Provides: `reserve()`, `deduct()`, `release()`, `add()`, `operate()`.  
**Rule:** All stock operations across the system MUST route through StockService. Direct Prisma writes to `managedStockQuantity` or `reservedStock` are forbidden.  
**Domain:** Stock

### 7. Physical Inventory
**Definition:** Countable physical items in a warehouse location. Distinct from Managed Product Stock. Handled via inventory adjustments, counts, transfers between bin locations.  
**Domain:** Inventory

### 8. Warehouse
**Prisma:** `Warehouse`  
**Definition:** Physical or virtual location where inventory is stored. Contains `BinLocation` records.  
**Domain:** Inventory

### 9. BinLocation
**Prisma:** `BinLocation`  
**Definition:** A specific storage position within a warehouse (e.g., "Aisle-1, Rack-3, Shelf-B").  
**Domain:** Inventory

### 10. Order
**Prisma:** `Order`  
**Definition:** Customer purchase transaction. Lifecycle: draft → confirmed → processing → packed → dispatched → delivered → completed. Can be cancelled/returned at various stages.  
**Domain:** Orders

### 11. OrderItem
**Prisma:** `OrderItem`  
**Definition:** Line item on an order. Links to ProductVariant. Contains `costSnapshot` (cost at time of order, with `costType: estimated|actual`).  
**Domain:** Orders

### 12. Purchase
**Prisma:** `Purchase`  
**Definition:** Stock procurement from a supplier. Creates GoodsReceiptNote on receipt, which triggers StockService.add().  
**Domain:** Purchases

### 13. GoodsReceiptNote (GRN)
**Prisma:** `GoodsReceiptNote`  
**Definition:** Document confirming receipt of purchased goods. Triggers stock addition via StockService.  
**Domain:** Purchases

### 14. Dispatch
**Prisma:** `Dispatch`  
**Definition:** Outbound shipment of packed items to customer. After dispatch, stock is marked as deducted.  
**Domain:** Dispatch & Packing

### 15. PackingLock
**Prisma:** `PackingLock`  
**Definition:** Temporary hold on inventory items being packed for an order. Prevents double-allocation during packing process.  
**Domain:** Dispatch & Packing

### 16. Campaign
**Prisma:** `Campaign`  
**Definition:** Marketing campaign for promotions, discounts, or targeted offers.  
**Domain:** Sales & Marketing

### 17. Referral
**Prisma:** `Referral`  
**Definition:** Customer referral tracking for referral-based marketing.  
**Domain:** Sales & Marketing

### 18. Coupon
**Prisma:** `Coupon`  
**Definition:** Discount code applicable to orders. Has usage limits, expiry, and scope.  
**Domain:** Sales & Marketing

### 19. Employee
**Prisma:** `Employee`  
**Definition:** Staff member with system access. Linked to a User account. Has roles and permissions.  
**Domain:** Finance & HR

### 20. Payroll
**Prisma:** `Payroll`  
**Definition:** Employee salary and payment records.  
**Domain:** Finance & HR

### 21. Accounting
**Prisma:** `Accounting` (or related models)  
**Definition:** Financial transaction records for double-entry bookkeeping.  
**Domain:** Finance & HR

### 22. Account (Chart of Accounts)
**Prisma:** `Account`  
**Definition:** Named financial account in the chart of accounts (e.g., "Cash", "Inventory Asset", "Accounts Receivable").  
**Domain:** Finance & HR

### 23. License
**Definition:** Per-client license managed via KeyMate/Keygen integration. Each deployment has a unique license key that gates feature availability. 7-day local cache.  
**Domain:** System

### 24. Feature Flag
**Definition:** Runtime toggle for a licensed feature. Checked via `@RequiresFeature()` decorator on controllers. Guarded by `FeatureGuard`.  
**Prisma Model:** FeatureFlag  
**Domain:** System

### 25. User
**Prisma:** `User` (Better Auth schema)  
**Definition:** System user. Authenticated via either legacy JWT or Better Auth (dual mode). Linked to optional Employee record.  
**Domain:** Auth

### 26. Analytics (Page View)
**Prisma:** `PageView`  
**Definition:** Tracked page view event in the storefront. Used for reporting and dashboard widgets.  
**Domain:** Analytics

### 27. Category
**Prisma:** `Category`  
**Definition:** Hierarchical product categorization. Products can belong to multiple categories.  
**Domain:** Products

### 28. Brand
**Prisma:** `Brand`  
**Definition:** Product brand/manufacturer.  
**Domain:** Products

### 29. Attribute
**Prisma:** `Attribute` / `AttributeValue`  
**Definition:** Product variant dimension (e.g., "Size", "Color"). Attributes combine via cartesian product to generate variant SKUs.  
**Domain:** Products

### 30. Combo
**Prisma:** `ComboProduct` or similar  
**Definition:** Bundled product offering — multiple products sold as a single unit.  
**Domain:** Products

### 31. Media Gallery
**Definition:** Centralized image/video management for products, categories, and brand assets. Supports bulk selection.  
**Domain:** Products

### 32. POS (Point of Sale)
**Location:** `apps/pos/`  
**Definition:** In-store sales terminal application. Creates orders in the backend via POS-specific API.  
**Domain:** POS

---

## Cross-Cutting Rules

### Stock Operation Rule
All stock mutations (`reserve`, `deduct`, `release`, `add`) MUST go through `StockService`. No direct Prisma writes to `managedStockQuantity` or `reservedStock`. Violations create dual-tracking drift between InventoryLog and ManagedStockLedger.

### Order Stock Deduction Rule
When an order is confirmed, `StockService.deduct()` is called. When cancelled/returned, `StockService.release()` or `StockService.add()` is called. OrdersService must NOT bypass StockService.

### License Enforcement Rule
Every licensed feature must have `@RequiresFeature()` on its controller. The feature must be registered in FEATURE_REGISTRY.md. The 68-feature system from `final-feature-plan.md` must be verified against actual `@RequiresFeature()` usage.