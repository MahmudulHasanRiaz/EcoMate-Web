# Inventory Domain

> **Status:** Draft  
> **Supersedes:** Inventory sections in `docs/7-SUPERSEDED/plans/*.md`  
> **Source of Truth Priority:** Business Domain Contract > Prisma schema > Implementation > Historical plans

## Models

- `InventoryLog` — Legacy log (simple, no direction)
- `ManagedStockLedger` — Double-entry ledger (authoritative)
- `Warehouse` — Physical/logical storage location
- `BinLocation` — Specific position within warehouse

## Rules

- All stock operations route through StockService
- ManagedStockLedger is the only authoritative history log
- InventoryLog retained for historical data only — no new writes

## Current Gaps

See `docs/7-SUPERSEDED/plans/2026-07-08-inventory-phase1-complete.md`
and `docs/7-SUPERSEDED/plans/2026-07-08-remaining-gaps.md` (Active)