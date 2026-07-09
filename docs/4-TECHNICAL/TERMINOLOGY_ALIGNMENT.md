# Terminology Alignment

> **Status:** Draft — Phase 4  
> **Authority:** Maps canonical terms (from Business Domain Contract) to actual codebase usage. Violations deferred to Phase 10.

## Source of Truth Priority

Business Domain Contract > This document > Implementation

## Canonical Terms

| Canonical | Also Known As | Used In | Status |
|-----------|---------------|---------|--------|
| `managedStockQuantity` | `stock` (alias/raw SQL) | backend API resp, storefront types | 🔴 Non-canonical alias active |
| `reservedStock` | `allocated` (UI label) | admin UI inventory pages | 🔴 Hardcoded to 0 (no data) |
| `availabilityMode` | none | everywhere | ✅ Consistent |
| `ManagedStockLedger` | none | inventory.service.ts, orders.service.ts | ✅ Canonical |
| `InventoryLog` | none | stock.service.ts (new writes) | 🔴 Should be deprecated |
| `costSnapshot` | none | orders.service.ts | ✅ Canonical |
| `costType` | `'estimated'` / `'actual'` (String) | orders.service.ts | 🟡 Should be enum |

## Violations (Deferred to Phase 10)

| # | Severity | Violation | Location | Fix |
|---|----------|-----------|----------|-----|
| 1 | HIGH | OrdersService bypasses StockService — direct Prisma stock updates | `orders.service.ts:1639-1810` | Route all stock ops through StockService |
| 2 | HIGH | InventoryService.adjust() bypasses StockService — direct Prisma stock updates | `inventory.service.ts:249-411` | Route through StockService.adjust() |
| 3 | HIGH | StockService.operate() writes to InventoryLog, not ManagedStockLedger | `stock.service.ts:258` | Add ManagedStockLedger write |
| 4 | MEDIUM | API responses use `stock` alias | `stock.service.ts:370,381,424,439` | Use `managedStockQuantity` or expose both |
| 5 | MEDIUM | Storefront types use `stock: number` | `storefront/lib/types.ts:16,43,83,181` | Rename to `managedStockQuantity` |
| 6 | MEDIUM | Admin "Allocated" hardcoded to 0 | `admin/features/inventory/index.tsx:95` | Map to `reservedStock` |
| 7 | LOW | Admin "On Hand" and "Available" labels | 12+ locations admin inventory | Align to canonical terminology |

## Deferred Actions

All fixes in Phase 10 after Phase 9 (Claim Verification) completes. No code changes before Phase 10.