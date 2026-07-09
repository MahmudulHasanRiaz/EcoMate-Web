# ADR 003: Dual Stock Tracking (InventoryLog + ManagedStockLedger)

**Status:** Technical Debt — Migration Incomplete  
**Date:** 2026-06 (original) 
**Decider:** Lead Architect  

## Context

EcoMate originally tracked stock changes with **InventoryLog** — a simple table: `id`, `productVariantId`, `quantity`, `type`, `createdAt`. No direction field, no before/after snapshots. Insufficient for auditing, returns, and COGS calculation.

Phase 4 (Core Extension) introduced **ManagedStockLedger** — a proper double-entry ledger with `direction` (IN/OUT), `stockBefore`, `stockAfter`, `referenceType`, `referenceId`.

## Decision

**Introduced ManagedStockLedger alongside InventoryLog.** New code writes to ManagedStockLedger. Old code (StockService, orders path) was not fully migrated.

## Current State (as of Phase 4 audit)

- **ManagedStockLedger writes:** inventory.service.ts `adjust()`, orders.service.ts `deductStockForOrder()`, orders.service.ts `handleReturnedSideEffects()`
- **InventoryLog writes (new):** stock.service.ts `operate()` (all paths), inventory.service.ts `restockOrderItems()`, inventory.service.ts `transferStock()`
- **Direct stock mutations bypassing both logs:** orders.service.ts (`tx.productVariant.update()` on `managedStockQuantity`)

## Status

🔴 **Migration incomplete.** StockService still writes to InventoryLog. Direct Prisma updates in orders.service.ts bypass the ledger entirely.

## Required Fix

1. StockService.operate() must write to ManagedStockLedger (dual-write or replace)
2. OrdersService must route all stock mutation through StockService
3. InventoryService.adjust() already writes ManagedStockLedger — but still bypasses StockService

## References

- `docs/3-DOMAINS/05-stock.md` — StockService spec  
- `docs/3-DOMAINS/01-inventory.md` — Inventory domain  
- `docs/4-TECHNICAL/TERMINOLOGY_ALIGNMENT.md` — violation list