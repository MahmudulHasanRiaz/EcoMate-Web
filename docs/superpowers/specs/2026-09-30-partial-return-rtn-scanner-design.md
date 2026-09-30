# Partial Return / RTN Orders + Unified Scanning System — Design

Date: 2026-09-30 · Status: implemented, tested, E2E-verified

## 1. Partial ≠ Short Fulfillment (non-negotiable)

- **Courier Partial** = partial *customer acceptance*: ordered A × 4, dispatched A × 4,
  customer accepted A × 2 and returned A × 2. It never means "EcoMate shipped fewer".
- **Short fulfillment** = ordered A × 4, dispatched A × 2 → A × 2 remain fulfillable
  from the SAME original order. No new customer order, no Partial status.
- `GET /orders/:id/remaining-fulfillment` makes short fulfillment deterministic:
  `remaining = ordered − Σ(dispatched quantities, non-cancelled dispatches)` per line,
  derived from `Dispatch.productMapping`.

## 2. RTN relationship (one original → one RTN)

- `Order.kind`: `SALE | RETURN` (default SALE). RTN orders are never sales.
- `Order.returnOfOrderId` — `@@unique([returnOfOrderId])` at the database level.
  Two concurrent RTN creations: exactly one wins; the other gets a deterministic 409
  (P2002 → ConflictException).
- RTN display id is derived: `ORD-260930-0001` → `RTN-260930-0001`. New internal id.
- `OrderItem.sourceOrderItemId` links each RTN line to the original line (costing restore).

## 3. Partial → RTN creation workflow

`POST /rtn/from-order/:orderId` `{ items: [{ orderItemId, quantity }] }` — one transaction:

1. Original must be `Partial` (non-Partial → 400; existing RTN → 409).
2. Per-line validation: `0 < returnQty ≤ currentQty`, item must belong to the original,
   no duplicate lines.
3. RTN created: `kind=RETURN`, `status=Return Pending`, exact returned quantities,
   combo component snapshots frozen (`unitQuantity × returnQty`).
4. Original lines reduced by exactly the returned quantities; full-line returns remove
   the line (combo snapshots follow the reduced quantity).
5. Original `Partial → Delivered` + timeline entry; totals recalculated with the
   existing `recalculate` primitive (no invented proration).
6. **No stock movement at creation.** No purchase/conversion events.

The generic `Partial → Delivered` path was REMOVED from the state machine
(`ORDER_TRANSITIONS`, admin `status-transitions.ts`, and the DB `nextStatuses` via
migration `20260930010000_rtn_return_orders`). RTN creation is the only legitimate path.

## 4. Stock restoration (RTN → Returned)

`CancelReturnStockService.restoreForReturnOrder` — exact inverse of a partial return:

- Managed: `operate('add', RETURN)` per RTN line / combo component.
- Physical: `operatePhysical('add')` (authoritative path) to the source warehouse.
- Costing: `CostingLotRestoration` rows scoped to the original order's FULFILLMENT
  consumptions (idempotent via `@@unique([consumptionId, returnReferenceId])`).
- **Durable idempotency**: `Order.stockRestored` checked at entry, set inside the same
  transaction as the movement. Repeated calls restore nothing.
- The original order is NOT touched — it stays `Delivered`.

## 5. Dispatch return finalization

`POST /rtn/dispatch/:dispatchId/finalize-return` (also the scanner Return purpose):

1. Atomic dispatch claim → `RETURNED` (conditional `updateMany`; race → idempotent
   `already_returned`).
2. **Partial return**: RTN `Return Pending → Returned` + exact RTN quantities restored.
   Original stays `Delivered`.
3. **Full return**: original `Return Pending → Returned` + `restoreForOrder`
   (existing primitive — unchanged behavior, no RTN created).
4. Unresolved Partial order → recoverable business exception:
   *"This Partial order has not been resolved into a Return Order yet."* — no mutation.
5. Timeline/audit entries on every mutated order; `order.status_changed` events emitted.

## 6. Scanner (unified scanning system)

`apps/backend/src/scanner/` — typed purpose registry (no dynamic plugin system):

| Purpose | Input | Behavior |
|---|---|---|
| `DISPATCH_HANDED_OVER` | dispatch id / order no | `DISPATCHED → HANDED_OVER` via existing dispatch state machine; idempotent stock deduction; rescan → "Already Handed Over" |
| `DISPATCH_RETURN` | dispatch id / order no | delegates to `finalizeDispatchReturn` (§5) |
| `ORDER_STATUS` | order no | staff picks target status; goes through `OrdersService.updateStatus` — the same state machine as the UI, no scanner bypass; Return Orders refused |
| `STICKER_PRINT` | order no | resolves order → existing sticker print page URL |

- All input methods (hardware scanner, camera via Html5Qrcode, manual typing) enter the
  same `POST /scanner/resolve` + `POST /scanner/scan` path.
- Resolution: order number (exact) or courier consignment/tracking identifier
  (case/whitespace-insensitive, alphanumeric-core fallback). One dispatch → auto-resolve;
  multiple → `selection_required` (explicit staff selection, never a guess).
- Authorization: `@Roles('superadmin','admin','manager')` + `@RequiresFeature('admin_barcode_search')`.
- Admin UI: `/admin/op/scanner` — mode tabs, auto-refocusing scan input, camera toggle,
  live result history (success/warning/error/duplicate + old→new state), counters
  (success/failed/duplicate/pending), and a **batch queue**: every scan serially
  enqueues (never replaces); duplicates are reported, not re-added; one target
  action applies to the whole queue.

## 11. Batch queue (ORDER_STATUS + dispatch purposes)

- Scan 100s/1000s of identifiers serially → each joins the in-session batch queue.
  Scanning the same identifier twice reports "already queued" (duplicate), not a
  second entry. `POST /scanner/scan` accepts `orderIds[]` / `dispatchIds[]`:
  - ORDER_STATUS: one `targetStatusId` applied to every queued order, each validated
    individually against the state machine (`success` / `warning` / `error` with
    per-order results). The UI offers only the **intersection** of allowed statuses
    across the queue, so a batch can never propose an illegal transition.
  - DISPATCH_HANDED_OVER / DISPATCH_RETURN: one call applies to every queued dispatch,
    each with its own idempotency guard.
  - STICKER_PRINT: the queue feeds the existing bulk print page
    (`/admin/op/print/bulk?type=sticker&ids=…`).

## 7. Analytics / marketing guards

`kind: 'SALE'` filters added to every sales-facing aggregation: dashboard KPIs,
`getSalesKpi`, customer totals/recent orders/delivered+cancelled counts, marketing
attribution order fetch, business-analytics shared `buildOrderWhere`, blocked-phone
order counts. Storefront/customer lookups (`findMyOrders`, `findMyOrderById`,
`findByPhone`, `findByDisplayId`) exclude Return Orders. RTN orders never trigger
Purchase/conversion events (creation runs no side effects).

## 8. Full-return compatibility

Courier/webhook behavior unchanged: returns still stop at `Return Pending` (stock held).
Finalization now happens via the scanner Return purpose (or the existing manual order
detail path) — same `restoreForOrder` primitive, same audit.

## 9. Concurrency / idempotency summary

- RTN creation: DB unique constraint on `returnOfOrderId` + in-transaction re-checks.
- Return finalization: atomic conditional dispatch claim + `stockRestored` flag.
- Webhook + scanner race: webhook may set dispatch `RETURNED` first; the scanner then
  finalizes the pending settlement (or reports `already_returned` if fully settled).
- Repeated courier sync: unchanged (webhook upsert + `WebhookAttempt.isDuplicate`).

## 10. Bug found & fixed during implementation

`ProductMappingItem.quantity` had no class-validator decorator; the global
`ValidationPipe({ whitelist: true })` silently stripped it from every dispatch create —
dispatch-level quantities (needed for remaining-fulfillment) were never persisted.
Fixed by decorating the field (`@IsNumber() @Min(0)`) + regression test.
