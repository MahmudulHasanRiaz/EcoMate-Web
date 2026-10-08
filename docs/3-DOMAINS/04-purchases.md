# Purchases Domain

## Models

- `Purchase` — Supplier procurement order (commitment, NOT stock)
- `PurchaseItem` — Ordered lines with `quantity`, `receivedQty`, `shortClosedQty`
- `GoodsReceiptNote (GRN)` — Receipt event document; one PO takes many GRNs
- `PurchaseEvent` — Append-only audit trail (created / GRN / short-close / cancel)

## Lifecycle (verified end-to-end)

1. **PO create** moves no stock. Lines require product existence; variable
   products require a variant. Numbers come from the atomic `PurchaseCounter`.
2. **GRN posts** (per accepted line, router-routed by availabilityMode × IM
   switch): costing lot + managed and/or physical legs + supplier
   `totalPurchases`/`balance` increment + event. Damage never stocks.
3. **Disposition gate**: an item is done when
   `accepted + rejected + shortClosed ≥ ordered`. PO closes only when every
   line is done — never on raw received alone.
4. **Idempotency**: `POST :id/grn` accepts `Idempotency-Key`; replays return
   the original GRN. Concurrent receives serialize (Serializable + retry);
   the remaining-qty guard bounds total postings.
5. **Cancel** short-closes all remainders with reason; posted stock stays.
   After any GRN only notes are editable; cancelled POs are notes-only.

## Owns

- Supplier management (+ supplier-level payments ledger view)
- Purchase orders, GRNs, short-close, cancel
- Damage responsibility capture (supplier/company) and per-line warehouses

## Depends On

- **Products** — Purchases reference products/variants
- **StockService / router** — Managed + physical legs on receipt
- **Inventory** — Physical rows, costing lots

## Does NOT Own (Accounting boundary)

- Supplier **payments** live in the suppliers module
  (`POST /suppliers/:id/payments`, validates ≤ balance, decrements balance,
  increments `totalPaid`). Purchase responsibility ends at posting accepted
  values into `totalPurchases`/`balance` and exposing `acceptedValue`,
  short/damage splits and events for reconciliation.
- `Purchase.paidAmount` is unused (always 0) — per-PO payment allocation was
  never built; do not read it as paid state.
- Product catalog/pricing, Managed Stock itself, adjustments/transfers,
  sales lifecycle, financial accounting.

## Future scope (explicitly NOT built)

- **Return-against-PO**: posting a supplier return that reverses lots/stock
  and adjusts `balance` with full trail (today: cancel only blocks the
  future; posted stock stays by design).
- **Supplier Damage Claim/Return flow**: claim records linked to rejected
  lines (`supplierDamageValue` is already exposed for this).
- **Concurrent-submit UX copy**: replayed GRNs return HTTP 201 with the
  original body (same as created) — clients must not treat 201 as proof of
  a new posting; compare GRN ids.