# Products Domain

> **Status:** Draft  
> **Supersedes:** Product sections in historical plans  
> **Source of Truth Priority:** Business Domain Contract > Prisma schema > Implementation > Historical plans

## Overview

Products owns the **catalog** and **Managed Stock** — the lightweight availability system for sellable items. Products define what can be sold; Inventory (separate domain) tracks where physical items are stored.

## Models

- `Product` — Catalog item with `managedStockQuantity` (computed), `availabilityMode`
- `ProductVariant` — SKU-level item with `managedStockQuantity`, `reservedStock`
- `Category` — Hierarchical grouping
- `Brand` — Manufacturer
- `Attribute` / `AttributeValue` — Variant dimensions
- `ComboProduct` / related — Bundled product
- `ManagedStockLedger` — Double-entry ledger for Managed Stock changes
- `Media` — Images, videos for product/category/brand assets

## Availability Modes

| Mode | Meaning |
|------|---------|
| `ALWAYS_IN_STOCK` | Product is always available regardless of quantity |
| `ALWAYS_OUT_OF_STOCK` | Product is never available (discontinued) |
| `MANAGED_STOCK` | Availability determined by `managedStockQuantity` |
| `INVENTORY_CONTROLLED` | Availability determined by physical inventory (future — see Inventory domain) |

## Key Rules

- `managedStockQuantity` on Product is READ-ONLY — sum of variant stock
- Direct stock editing on ProductForm (admin) is DISABLED
- All managed stock mutations go through StockService

## Owns

- Product catalog and categories
- Product variants (SKUs)
- Brand registry
- Attributes and attribute values
- Combo (bundled) products
- **Managed Stock** (`managedStockQuantity` on Product/Variant)
- **Managed Stock Ledger** (`ManagedStockLedger`)
- Availability modes and control
- Estimated cost of goods
- Media gallery (product images/videos)

## Depends On

- **StockService** (backend architecture) — for all Managed Stock mutations
- **Inventory** — for `INVENTORY_CONTROLLED` availability mode (future)

## Does NOT Own

- Physical inventory or warehouse locations
- Inventory valuation (beyond estimated cost)
- Orders or order lifecycle
- Purchase orders or GRN
- Dispatch, packing, or courier
- Accounting or financial entries
- License or feature flags