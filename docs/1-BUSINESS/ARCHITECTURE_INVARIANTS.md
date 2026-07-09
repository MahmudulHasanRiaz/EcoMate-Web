# Architecture Invariants

> **Status:** Final  
> **Authority:** Mandatory rules. Every developer and AI agent MUST follow these.  
> **Cross-reference:** `docs/1-BUSINESS/BUSINESS_DOMAIN_CONTRACT.md` — Core Principles  
> **Cross-reference:** `AGENT.md` — refers to this document

These invariants are **not optional**. If code violates an invariant, the code is wrong — fix the code, not the invariant.

---

## Data Mutation Invariants

### INV-001: Only StockService may mutate Managed Stock
No module — including OrdersService, InventoryService, ProductsService — may directly update `managedStockQuantity` or `reservedStock` on Product or ProductVariant. All managed stock mutations MUST route through StockService.

### INV-002: Only StockService may create stock ledger entries
ManagedStockLedger records are created exclusively by StockService. No other service writes to ManagedStockLedger.

### INV-003: Ledger records are append-only
Once written, ManagedStockLedger entries are never modified or deleted. Corrections require a new offsetting entry.

---

## Domain Boundary Invariants

### INV-004: Purchase owns receiving (GRN)
Goods Receipt Note (GRN) is owned by Purchases. Inventory never creates purchase orders or GRNs. Receiving triggers StockService.add() for Managed Stock and updates Physical Inventory.

### INV-005: Inventory never owns purchasing
Inventory may suggest reorder points but never creates purchase orders. Purchasing is a separate domain.

### INV-006: Product owns Managed Stock
Managed Stock (`managedStockQuantity`) is a Product domain concept. Inventory never writes to `managedStockQuantity` directly.

### INV-007: Inventory owns Physical Inventory
Physical inventory (warehouse, bins, lots, counts) is owned by Inventory. Product never controls physical locations.

### INV-008: Orders never directly modify Inventory
Orders communicate stock changes through StockService only. OrdersService never writes directly to `managedStockQuantity` or `reservedStock`.

### INV-009: Inventory never controls Product availability
Except for `INVENTORY_CONTROLLED` availability mode (future), Inventory does not determine whether a product is available for sale.

---

## Service Invariants

### INV-010: Feature modules communicate through services, never through direct data manipulation
If Orders needs stock, it calls StockService. If Purchases needs stock, it calls StockService. No cross-module Prisma writes.

### INV-011: Every data mutation has exactly one authoritative service
Each Prisma model has exactly one service responsible for writes. If two services write to the same model, reconcile.

---

## Documentation Invariants

### INV-012: Business Requirements are more authoritative than Implementation
If code contradicts the Business Domain Contract, fix the code. If the contract contradicts business intent, update the contract.

### INV-013: Documentation must never contradict the Business Domain Contract
All documentation files in `docs/` must be consistent with `docs/1-BUSINESS/BUSINESS_DOMAIN_CONTRACT.md`. If a contradiction is found, update the doc (not the contract).

### INV-014: Architecture Decisions must be documented as ADRs
Every significant architecture choice requires a written ADR in `docs/2-ARCHITECTURE/ADR/`.

### INV-015: StockService centralizes ALL stock operations
StockService owns both Managed Stock AND Physical Inventory mutations. No service may directly mutate `PhysicalInventory.quantity` or `PhysicalInventory.reservedQuantity`.

### INV-016: Physical Inventory must support reservation
`PhysicalInventory` must have `reservedQuantity` field. Physical stock reservation follows the same pattern as Managed Stock: reserve at Create/Confirm (per availabilityMode), release on cancel, deduct at HANDED_OVER.

### INV-017: ALWAYS_OUT_OF_STOCK blocks order creation
Products with `availabilityMode: ALWAYS_OUT_OF_STOCK` MUST be rejected at ALL order creation paths (admin, storefront, POS).

### INV-018: Cost deduction is mode-aware
CostingLot deduction at HANDED_OVER must respect the active mode: Managed Stock costing when Inventory Management is disabled, Physical Inventory costing when enabled.

---

## Current Violations

| Invariant | Violation | Location | Severity |
|-----------|-----------|----------|----------|
| INV-001 | OrdersService.deductStockForOrder() directly decrements managedStockQuantity | `orders.service.ts:1639-1810` | CRITICAL |
| INV-001 | OrdersService.restoreStockForCancelledOrder() directly increments managedStockQuantity | `orders.service.ts:1812-1845` | CRITICAL |
| INV-001 | OrdersService.handleReturnedSideEffects() directly increments managedStockQuantity | `orders.service.ts:1847-1890` | CRITICAL |
| INV-001 | InventoryService.adjust() directly updates managedStockQuantity | `inventory.service.ts:249-411` | CRITICAL |
| INV-001 | InventoryService.restockOrderItems() directly increments managedStockQuantity | `inventory.service.ts:413-460` | HIGH |
| INV-001 | reservedStock never decremented at Order Confirmed (deductStockForOrder only decrements managedStockQuantity) | `orders.service.ts:1700-1710` | CRITICAL |
| INV-002 | StockService.operate() writes to InventoryLog instead of ManagedStockLedger | `stock.service.ts:258` | HIGH |
| INV-002 | InventoryService.adjust() writes ManagedStockLedger bypassing StockService | `inventory.service.ts:337-348` | HIGH |
| INV-002 | OrdersService writes ManagedStockLedger directly (deductStockForOrder, restoreStockForCancelledOrder, handleReturnedSideEffects) | `orders.service.ts` | CRITICAL |
| INV-002 | InventoryService.restockOrderItems() writes ManagedStockLedger directly | `inventory.service.ts:413-460` | HIGH |
| INV-008 | OrdersService directly mutates managedStockQuantity (violates "Orders never directly modify Inventory") | `orders.service.ts` | CRITICAL |
| INV-010 | OrdersService bypasses StockService for managed stock mutations | `orders.service.ts:1639-1890` | CRITICAL |
| INV-010 | InventoryService bypasses StockService for managed stock mutations | `inventory.service.ts:249-460` | HIGH |
| INV-011 | OrdersService, InventoryService, ProductsService all write to ProductVariant.managedStockQuantity concurrently | `orders.service.ts`, `inventory.service.ts`, `products.service.ts` | CRITICAL |
| INV-015 | PhysicalInventory.reservedQuantity does not exist — no physical reservation system | Prisma schema / `PhysicalInventory` model | HIGH |
| INV-015 | StockService lacks reservePhysical/deductPhysical/releasePhysical/addPhysical methods | `stock.service.ts` | HIGH |
| INV-016 | PhysicalInventory cannot track reserved stock — reservedQuantity field missing | Prisma schema | HIGH |
| INV-017 | No ALWAYS_OUT_OF_STOCK guard at order creation | `orders.service.ts` create/addItem/updateOrder | HIGH |
| INV-018 | DeductCostingLots runs for all availability modes regardless of Inventory Management setting | `stock.service.ts:301-303` | MEDIUM |

All violations tracked in `docs/2-ARCHITECTURE/VERIFICATION_REPORT.md` and `docs/4-TECHNICAL/TERMINOLOGY_ALIGNMENT.md`.