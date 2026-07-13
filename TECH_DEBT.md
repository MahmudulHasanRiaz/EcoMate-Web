# Technical Debt — Inventory Module

## PhysicalInventoryLedger — Missing binLocationId

**Why it matters:**

PhysicalInventoryLedger is the audit trail for all physical stock movements (adjustments, transfers, fulfillments, returns). Without binLocationId, the ledger records stock changes at warehouse level only. If a warehouse has bins, there is no way to trace which bin the stock moved from/to.

**Affected use cases:**

1. **Bin-level movement history** — "Show me all stock movements in/out of Bin A1" is impossible
2. **Audit reconciliation by bin** — Physical count variance reports cannot be validated per bin
3. **Bin-level traceability** — "Where did this specific lot go?" is only traceable to warehouse level
4. **Stock aging per bin** — Inventory aging reports per-bin require ledger history per-bin

**Current workaround:**

PhysicalReservationAllocation records which bin was consumed during fulfillment (line 909 stock.service.ts). This provides partial traceability for fulfillments only. Adjustments, transfers, and returns are not traced at bin level.

**Migration impact:**

Adding binLocationId to PhysicalInventoryLedger requires:
1. `schema.prisma` — Add `binLocationId String?` field + relation to BinLocation + index
2. `npx prisma migrate dev --name add_bin_location_id_to_ledger`
3. `stock.service.ts` — Pass `binLocationId` to `logPhysicalInventoryLedger` calls (already has the param at line 298, but value is passed separately at each call site)
4. All existing rows will have `binLocationId = NULL` (backward compatible)

**Recommended implementation:**

```prisma
model PhysicalInventoryLedger {
  // existing fields...
  binLocationId String?
  binLocation   BinLocation? @relation(fields: [binLocationId], references: [id])

  @@index([binLocationId])
}
```

The `logPhysicalInventoryLedger` function already accepts `binLocationId?: string` (line 298 stock.service.ts). Each call site already passes `params.binLocationId`. So the runtime wiring is already in place — only schema + migration is needed.

**Priority:** Medium — no data loss risk, all existing queries work correctly without it.

---

## Inventory Valuation — Empty Category Filter SQL

**Why it matters:**

The `valuation()` method's raw SQL query produces invalid syntax when called without search/category filters. Already fixed in current code.

**Status:** Fixed in current branch.

---

## Transfers Table — "Route" Column Label

**Why it matters:**

The transfers table column header says "Route" but displays product name and direction badge, not the source/destination warehouse names.

**Status:** Cosmetic. No functional impact.
