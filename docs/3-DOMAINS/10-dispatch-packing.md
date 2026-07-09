# Dispatch & Packing Domain

> **Status:** Draft  

## Models

- `PackingLock` — Temporary hold on inventory during packing
- `Dispatch` — Outbound shipment record

## Operations

- **Packing** — Physical preparation of items for shipment
- **Courier assignment** — Choosing and handing off to shipping provider
- **Tracking** — Shipment tracking number and status
- **Dispatch confirmation** — Triggers Managed Stock deduction

## Owns

- Packing workflow and PackingLock management
- Courier integration and provider management
- Shipment tracking
- Dispatch confirmation

## Depends On

- **Orders** — Dispatches fulfill orders
- **Inventory** — Packing involves physical inventory allocation
- **StockService** — Dispatch confirmation triggers Managed Stock deduction
- **Products** — Items being packed are product variants

## Does NOT Own

- Order lifecycle (beyond dispatch status)
- Managed Stock (`managedStockQuantity`)
- Physical inventory or warehouse locations
- Payment processing
- Product catalog