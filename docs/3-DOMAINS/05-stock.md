# Stock Domain

> **Status:** Draft  
> **Source of Truth Priority:** Implementation (Prisma schema + StockService) > Documentation > Historical plans

## Definition

Stock = `managedStockQuantity - reservedStock` (available to sell).

## StockService

**Location:** `apps/backend/src/stock/stock.service.ts`

Single gateway for ALL stock operations:

| Method | Action | Ledger Write |
|--------|--------|-------------|
| `reserve()` | Hold stock for order | ManagedStockLedger |
| `deduct()` | Confirm stock removal | ManagedStockLedger |
| `release()` | Release held stock | ManagedStockLedger |
| `add()` | Add inbound stock | ManagedStockLedger |
| `operate()` | General operation | InventoryLog (legacy — to be migrated) |

## Known Issue

StockService.operate() currently writes to InventoryLog instead of ManagedStockLedger. This is a migration gap.