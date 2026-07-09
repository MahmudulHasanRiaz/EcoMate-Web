# Inventory Domain

> **Status:** Draft  
> **Supersedes:** Warehouse and Physical Inventory sections in historical plans  
> **Source of Truth Priority:** Business Domain Contract > Prisma schema > Implementation > Historical plans

## Overview

Inventory manages **Physical Inventory** — countable items in warehouse locations. This is distinct from **Managed Stock** (Product domain). Inventory deals with real physical items: where they are, how many, their condition, and their movement between locations.

## Models

- `Warehouse` — Physical/logical storage location
- `BinLocation` — Specific position within warehouse
- `CostingLot` — FIFO costing lot for actual cost tracking
- `InventoryLog` — Legacy log (simple, retained for history only)
- `PackingLock` — Temporary hold during packing (shared with Dispatch)

## Operations

- **Adjustments** — Manual correction to physical inventory counts
- **Transfers** — Movement between warehouses or bin locations
- **Reservation** — Physical allocation of items for dispatch
- **Valuation** — Financial value of physical inventory (FIFO)

## Owns

- Physical inventory quantity tracking
- Warehouse and bin location management
- Costing lots (FIFO)
- Physical inventory valuation
- Inventory adjustments and counts
- Inventory transfers between locations

## Depends On

- **Products** — Products and variants are the catalog items being tracked
- **Purchases** — Purchased goods arrive as physical inventory (GRN)
- **Orders** — Orders consume inventory through dispatch

## Does NOT Own

- Product catalog or availability
- Managed Stock (`managedStockQuantity`)
- Managed Stock availability modes
- Pricing or estimated cost
- Sales or order lifecycle
- Payment processing
- License or feature flags