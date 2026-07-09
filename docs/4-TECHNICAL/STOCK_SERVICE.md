# StockService — Backend Architecture

> **Status:** Draft  
> **Location:** `apps/backend/src/stock/stock.service.ts`  
> **Authority:** Technical reference for the StockService implementation. Not a business domain — StockService is a backend architecture component shared between Product and Inventory domains.

## Purpose

Single gateway for all Managed Stock mutations. Business domains (Product, Inventory, Orders, Purchases) communicate stock changes through StockService — never through direct Prisma writes.

## API

| Method | Action | ManagedStockLedger | Called By |
|--------|--------|-------------------|-----------|
| `reserve(variantId, qty)` | Hold managed stock for pending order | ✅ writes | Orders (on confirmation) |
| `deduct(variantId, qty)` | Confirm stock removal for dispatched order | ✅ writes | Orders, Dispatch |
| `release(variantId, qty)` | Release reserved stock (cancellation) | ✅ writes | Orders |
| `add(variantId, qty)` | Add inbound managed stock | ✅ writes | Purchases (GRN), Returns |
| `operate()` | General operation (legacy path) | 🔴 writes to InventoryLog | (to be migrated) |

## Current Issues

1. **`operate()` writes to InventoryLog** instead of ManagedStockLedger. Legacy behavior — needs migration.
2. **OrdersService bypasses StockService** with direct Prisma updates in 3 code paths (deduct, return, cancel).
3. **InventoryService.adjust() bypasses StockService** with direct Prisma updates in 4 code paths.

## Invariant

**Only StockService may mutate `managedStockQuantity` or `reservedStock`.** This is enforced by Architecture Invariants (see `docs/1-BUSINESS/ARCHITECTURE_INVARIANTS.md`).

## Ledger Strategy

- **ManagedStockLedger** — authoritative log for all Managed Stock changes (Product domain)
- **InventoryLog** — legacy log, retained for history only (Inventory domain)
- **Inventory Ledger** — (future) dedicated log for Physical Inventory movements