# Orders Domain

> **Status:** Draft  

## Models

- `Order` — Purchase transaction
- `OrderItem` — Line item with `costSnapshot`, `costType`

## Key Rules

- Order confirmation triggers `StockService.deduct()`
- Order cancellation triggers `StockService.release()`
- Return triggers `StockService.add()`
- OrdersService must NOT bypass StockService for stock operations