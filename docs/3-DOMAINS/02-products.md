# Products Domain

> **Status:** Draft  
> **Supersedes:** Product sections in historical plans  
> **Source of Truth Priority:** Business Domain Contract > Prisma schema > Implementation > Historical plans

## Models

- `Product` — Catalog item with `managedStockQuantity` (computed), `availabilityMode`
- `ProductVariant` — SKU-level item with `managedStockQuantity`, `reservedStock`
- `Category` — Hierarchical grouping
- `Brand` — Manufacturer
- `Attribute` / `AttributeValue` — Variant dimensions
- `ComboProduct` / related — Bundled product

## Key Rules

- `managedStockQuantity` on Product is READ-ONLY — sum of variant stock
- Direct stock editing on ProductForm (admin) is DISABLED
- Stock mutations happen via StockService only