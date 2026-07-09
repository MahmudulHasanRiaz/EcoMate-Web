# POS Domain

> **Status:** Draft  

## App

- `apps/pos/` — Point of Service terminal

## Backend

- POS module in backend — creates orders via POS-specific API

## Owns

- POS terminal application
- POS-specific order creation (offline-capable)
- POS session management

## Depends On

- **Orders** — POS creates orders following order lifecycle
- **Products** — POS scans/sells product variants
- **StockService** — POS orders consume Managed Stock

## Does NOT Own

- Product catalog
- Order lifecycle (beyond creation)
- Physical inventory
- Payment gateways (though POS initiates payments)