# Movement History — Reserved State Capture

## Problem

Reserve and Release events in Movement History show identical `stockBefore`/`stockAfter` values because the `ManagedStockLedger` only captures `managedStockQuantity`, which does not change during reservation — only `reservedStock` changes. The event's actual impact (reserve 0→1, available 100→99) is invisible in the audit trail.

## Scope

- **No business logic changes** — reservation, release, deduction flows remain untouched.
- **No new audit event types** — no new ledger entries for physical reserve/release.
- **Data completeness only** — add the missing dimension to existing ledger entries.

## Solution

Add `reservedBefore` and `reservedAfter` columns to both `ManagedStockLedger` and `PhysicalInventoryLedger`. Populate them where the ledger entry is created and a reserved-state transition occurs.

### Why This Approach

- Backward compatible: nullable columns, no backfill needed.
- Generic naming: "reserved" is universal across Managed Stock and Inventory Management models.
- Derived `available = stock - reserved` is computed in the frontend, not stored.
- Both ledgers get the same treatment — consistent design pattern.

## Changes

### 1. Database Schema

**ManagedStockLedger** — add:
```prisma
reservedBefore  Int?
reservedAfter   Int?
```

**PhysicalInventoryLedger** — add:
```prisma
reservedBefore  Int?
reservedAfter   Int?
```

Migration SQL:
```sql
ALTER TABLE "ManagedStockLedger"
  ADD COLUMN "reservedBefore" Int,
  ADD COLUMN "reservedAfter" Int;

ALTER TABLE "PhysicalInventoryLedger"
  ADD COLUMN "reservedBefore" Int,
  ADD COLUMN "reservedAfter" Int;
```

### 2. Backend — ManagedStockLedger

Affected call sites in `stock.service.ts`:

| Operation | Method | Ledger Fields |
|---|---|---|
| `reserve` | `operate()` line 667 | `stockBefore=currentStock, stockAfter=currentStock` → also pass `reservedBefore=currentReserved, reservedAfter=currentReserved+qty` |
| `release` | `operate()` line 719 | Same pattern: capture `reservedStock` before/after |
| `deduct` | `logManagedStockLedger()` line 345 | Read `reservedStock` alongside `managedStockQuantity` |

`logManagedStockLedger()` and `ManagedStockLedgerService.record()` accept new optional `reservedBefore`/`reservedAfter` params.

### 3. Backend — PhysicalInventoryLedger

Affected call sites in `stock.service.ts`:

| Location | Description |
|---|---|
| `logPhysicalInventoryLedger()` line 294 | Accept optional `reservedBefore`/`reservedAfter`, persist them |
| `operatePhysical('deduct')` line 551 | Read `reservedQuantity` from PhysicalInventory before/after deduct, pass to ledger |
| `fulfillPhysicalReservation()` line 1237 | Capture `reservedQuantity` before/after fulfill |

Reserve and release operations in physical flow do NOT write PhysicalInventoryLedger entries (by design) — no change needed there.

### 4. Frontend

Both `MovementHistory` (history.tsx) and `MovementLedger` (movement-ledger.tsx) get two new columns:

- **Reserved** — shows `reservedBefore → reservedAfter`
- **Available** — computed as `(stockAfter - reservedAfter)`, shown alongside or instead of raw stock

When `reservedBefore` is null (existing records), render "—".

Add RESERVE/RELEASE labels to `MOVEMENT_TYPE_LABELS`.

### 5. Existing Records

Zero migration burden. Old rows keep `reservedBefore=null, reservedAfter=null`. Frontend displays "—" gracefully. No backfill needed.

## Compatibility

- All existing API responses include new nullable fields (Prisma returns them automatically).
- All existing frontend code ignores unfamiliar fields.
- All existing tests pass unchanged (null doesn't break assertions on existing fields).
- All business logic pathways remain identical.

## Non-Goals

- No new PhysicalInventoryLedger entries for reserve/release.
- No `available` field in database (derived in presentation).
- No changes to stock-router, order service, POS service, reservation logic, or deduction logic.
- No re-architecture of the movement history URL or data flow.
