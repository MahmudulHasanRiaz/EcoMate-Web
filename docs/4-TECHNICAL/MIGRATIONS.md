# Migration Strategy

> **Status:** Draft  

## Prisma

- Schema changes via `prisma migrate dev`
- Production via `prisma migrate deploy`
- Current schema: 1886 lines, 90+ models

## Active Migrations

- Better Auth (legacy JWT → Better Auth) — dual mode in progress
- Stock logging (InventoryLog → ManagedStockLedger) — not yet started