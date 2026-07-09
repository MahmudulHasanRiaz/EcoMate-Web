# Orders Domain

> **Status:** Draft  

## Models

- `Order` — Purchase transaction
- `OrderItem` — Line item with `costSnapshot`, `costType`

## Key Rules

- Order confirmation MUST call `StockService.deduct()` — not direct Prisma writes
- Order cancellation MUST call `StockService.release()`
- Return MUST call `StockService.add()`
- OrdersService must NEVER bypass StockService for stock operations
- Order owns the order lifecycle: draft → confirmed → processing → packed → dispatched → delivered → completed

## Owns

- Order lifecycle and state machine
- Order items with cost snapshots
- Customer checkout flow
- Order cancellation and return processing

## Depends On

- **Products** — Orders reference variants and products
- **StockService** — For Managed Stock mutations (reserve, deduct, release, add)
- **Dispatch & Packing** — Fulfillment of packed/dispatched orders
- **Finance & HR** — Payment processing and refunds

## Does NOT Own

- Product catalog or pricing
- Managed Stock (`managedStockQuantity`)
- Physical inventory or warehouse
- Dispatch, courier, or packing
- Payment gateways or financial accounts