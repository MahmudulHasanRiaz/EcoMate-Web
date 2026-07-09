# Business Workflows

> **Status:** Draft  
> **Purpose:** Describes HOW business processes work — the flow, triggers, business rules, and cross-domain impact.  
> **Does NOT describe:** Implementation details, API endpoints, UI components.

---

## Order Lifecycle

### Trigger
Customer completes checkout (storefront/POS).

### Flow
```
Draft → Confirmed → Processing → Packed → Dispatched → Delivered → Completed
                                                                      ↓
  Cancelled (any stage) → Refund                                  Returned
```

### Business Rules
1. **Confirmation** — Order moves from draft to confirmed. StockService.reserve() is called. Payment must be authorized.
2. **Processing** — Order is acknowledged by operations team. No stock change.
3. **Packing** — PackingLock acquired for physical inventory. Items physically gathered.
4. **Dispatch** — Packed items handed to courier. StockService.deduct() called. Managed Stock is reduced.
5. **Delivery** — Customer receives items. Order moves to completed.
6. **Cancellation** — Prior to dispatch: StockService.release(). After dispatch: return flow.
7. **Return** — Customer returns items. StockService.add() for returned Managed Stock. Physical inventory updated if items received.

### Services Involved
- OrdersService — order state machine
- StockService — reserve, deduct, release, add
- PackingService — packing lock management
- DispatchService — courier handoff
- PaymentService — payment capture and refund

### Ledger Impact
- Reserve: ManagedStockLedger (OUT direction, reason: RESERVED)
- Deduct: ManagedStockLedger (OUT direction, reason: SOLD)
- Release: ManagedStockLedger (IN direction, reason: RELEASED)
- Return add: ManagedStockLedger (IN direction, reason: RETURNED)

### Analytics Impact
- Order confirmed → track conversion event
- Order delivered → track fulfillment event
- Order cancelled → track cancellation event

### Accounting Impact
- Order confirmed → Accounts Receivable entry (future)
- Order delivered → Revenue recognition (future)
- Refund → Accounts Receivable reversal (future)

### Result
Customer receives items (or refund). Managed Stock is adjusted. Physical inventory is updated.

---

## Purchase Lifecycle

### Trigger
Operations team or auto-reorder identifies stock need.

### Flow
```
Draft → Ordered → Partially Received → Received → Completed
                                                ↓
                                          Cancelled
```

### Business Rules
1. **Ordered** — Purchase order sent to supplier. No stock impact.
2. **Partially Received** — Some items received via partial GRN. StockService.add() for received quantities.
3. **Received** — All items received. Full GRN finalized. Physical inventory updated.
4. **Cancelled** — No stock impact if nothing received. Reverse any partial receipts.

### Services Involved
- PurchasesService — purchase order management
- StockService — add() for received quantities
- InventoryService — physical inventory receipt

### Ledger Impact
- GRN creation: ManagedStockLedger (IN direction, reason: PURCHASED)

### Analytics Impact
- Purchase received → track procurement event

### Accounting Impact
- GRN → Inventory Asset increase (Accounting domain)
- CostingLot created with actual cost

### Result
Managed Stock increased. Physical inventory received. Cost recorded.

---

## Return Workflow

### Trigger
Customer requests return (within return window).

### Flow
```
Return Request → Approval → Item Received → Quality Check → Stock Restore → Refund
```

### Business Rules
1. **Approval** — Return within policy? Item condition acceptable?
2. **Item Received** — Physical item arrives at warehouse. Physical inventory updated.
3. **Stock Restore** — Managed Stock increased via StockService.add(). Cost recorded.
4. **Refund** — Money returned to customer. Payment reversal processed.

### Services Involved
- OrdersService — return request management
- StockService — add() for restored stock
- InventoryService — physical receipt of returned items
- PaymentService — refund processing

### Ledger Impact
- Stock restore: ManagedStockLedger (IN, RETURNED)

### Analytics Impact
- Return created → track return rate
- Refund processed → track refund value

### Accounting Impact
- Refund → Revenue reversal (Accounting domain)
- Inventory increase → Inventory Asset adjustment

### Result
Customer refunded. Stock restored (if returned). Analytics updated.

---

## Refund Workflow

### Trigger
Order cancellation (pre-dispatch) or return approval (post-dispatch).

### Flow
```
Refund Initiated → Payment Processor → Money Returned → Order Updated
```

### Business Rules
1. Full refund for cancelled orders. Prorated refund for partial returns.
2. Refund goes to original payment method.
3. Refund triggers reversal of any applicable commissions.

### Services Involved
- PaymentService — refund API call to gateway
- OrdersService — order status update

### Ledger Impact
- None directly (financial ledgers are Accounting domain)

### Analytics Impact
- Refund value tracked in reports

### Result
Money returned. Order status updated.

---

## Dispatch Workflow

### Trigger
Order packed and ready for courier handoff.

### Flow
```
Pack → Assign Courier → Handover → In Transit → Delivered
                                          ↓
                                        Failed → Return to Warehouse
```

### Business Rules
1. **Pack** — PackingLock acquired. Items physically gathered and packed.
2. **Courier Assignment** — Courier selected based on delivery area, weight, and cost.
3. **Handover** — Package given to courier. PackingLock released. Dispatch record created.
4. **Stock Deduction** — Dispatch confirmation triggers StockService.deduct().
5. **Delivery** — Courier confirms delivery. Order moves to delivered.
6. **Failure** — Package returned to warehouse. Reverse dispatch flow.

### Services Involved
- PackingService — packing lock and verification
- DispatchService — courier assignment and tracking
- StockService — deduct() on dispatch confirmation
- OrdersService — order status update

### Ledger Impact
- Dispatch: ManagedStockLedger (OUT, SOLD)

### Result
Items shipped. Stock deducted. Order status updated.

---

## Packing Workflow

### Trigger
Order ready for fulfillment (confirmed + paid).

### Flow
```
Lock Items → Pack → Verify → Unlock → Ready for Dispatch
```

### Business Rules
1. **Lock** — PackingLock created to prevent double-allocation.
2. **Pack** — Items physically gathered from warehouse bins.
3. **Verify** — Packed items verified against order items.
4. **Unlock** — PackingLock released after verification.

### Services Involved
- PackingService — lock/unlock management
- InventoryService — bin picking

### Ledger Impact
- None directly (lock is temporary, not a ledger event)

### Result
Items packed and ready for courier. Physical inventory updated.

---

## License Activation Workflow

### Trigger
New client deployment or license renewal.

### Flow
```
License Key → KeyMate API Validation → 7-Day Local Cache → Feature Unlock
```

### Business Rules
1. License validated against KeyMate API on first activation.
2. Successful validation creates 7-day local cache (in DB or file).
3. Cache extends on successful re-validation before expiry.
4. Expired cache triggers re-validation. If API unavailable, cached status may remain valid for grace period.
5. Each feature checked via `@RequiresFeature()` at runtime.

### Services Involved
- LicenseService — license activation and cache management
- FeatureGuard — per-route feature enforcement
- LicenseEngine — offline token verification (HMAC-SHA256)

### Ledger Impact
- None

### Result
Features unlocked for client. Cache set for 7 days.