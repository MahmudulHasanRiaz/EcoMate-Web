# Purchases Domain

> **Status:** Draft  

## Models

- `Purchase` — Supplier procurement order
- `GoodsReceiptNote (GRN)` — Receipt confirmation document

## Key Rules

- Purchase owns GRN — receiving goods is a purchase function
- GRN triggers `StockService.add()` for Managed Stock updates
- GRN updates Physical Inventory (Inventory domain) on receipt

## Owns

- Supplier management
- Purchase orders
- Goods Receipt Notes
- Supplier return/debit note flow

## Depends On

- **Products** — Purchases reference products/variants
- **StockService** — For Managed Stock addition on receipt
- **Inventory** — For physical inventory receipt and costing lots

## Does NOT Own

- Product catalog or pricing
- Managed Stock (`managedStockQuantity`)
- Inventory adjustments or transfers
- Sales or order lifecycle
- Financial accounting (though purchases feed into accounting)