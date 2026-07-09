# Business Workflows

> **Status:** Draft  
> **Purpose:** Describes HOW business processes work — the flow, triggers, business rules, and cross-domain impact.  
> **Does NOT describe:** Implementation details, API endpoints, UI components.

---

## Order Lifecycle

> **Cross-reference:** Full state machine with all transitions documented in `docs/2-ARCHITECTURE/STATE_MACHINES.md`

### Trigger
Customer completes checkout (storefront/POS).

### State Machine (14 states)
```
Pending → Payment Pending → Payment Verifying → Confirmed → Packed → Shipping → Delivered
  │            │                 │                  │          │                     │
  │            │                 │                  ├──Packing └──Packing            │
  │            │                 │                  │   Hold       Hold              │
  │            │                 │                  │                            Return
  │            │                 │                  │                            Pending
  │            ├──Hold───────────┤                  │                              │
  │            │                 │                  │                         ┌────┴────┐
  │            │                 │                  │                         │         │
  └────Cancelled (pre-courier)──┘                  │                    Returned    Damaged
                                                   │                         │
                                                   └───Return Pending ←─────┘
                                                         │
                                                    (post-courier only)
```

### Business Rules
1. **Pending** — Initial state on order creation. `StockService.reserve()` called per item. `reservedStock` incremented.
2. **Payment Pending** — Order awaiting payment. Can transition to Payment Verifying (proof submitted), Hold, Confirmed (for COD/manual), or Cancelled.
3. **Payment Verifying** — Customer submitted payment proof. Admin approves → Confirmed + PAID. Admin rejects → Payment Pending.
4. **Confirmed** — `deductStockForOrder()` decrements `managedStockQuantity` (direct SQL, bypasses StockService). Writes ManagedStockLedger (ORDER_DEDUCTION, OUT). `reservedStock` NOT decremented here. `takeCostSnapshot()` captures estimated cost per item.
5. **Packed** — Items physically packed. Set by Packing service. Allows transition to Shipping or Packing Hold.
6. **Packing Hold** — Packing paused. Can return to Packed or Cancelled.
7. **Shipping** — Items handed to courier. Equivalent to courier handover milestone. Allows Delivered or Partial.
8. **Delivered** — Customer received items. COD payment auto-marked PAID. Final state (except Return Pending).
9. **Partial** — Partial delivery. Allows Return Pending.
10. **Cancellation** — Only allowed before Shipping (pre-courier). `StockService.release()` decrements `reservedStock`. `restoreStockForCancelledOrder()` increments `managedStockQuantity` (idempotent). After Shipping → use Return workflow.
11. **Return Pending** — Post-courier return requested. Leads to Returned or Damaged.
12. **Returned** — Items received back. `handleReturnedSideEffects()` increments `managedStockQuantity` (idempotent). Writes ManagedStockLedger (RETURN, IN).
13. **Damaged** — Terminal state for damaged returns.
14. **Hold** — Order on hold (operations decision). Can return to Pending, Confirmed, or Cancelled.

### Cancel Business Rule
**Orders can be cancelled before they are handed over to the courier.** After courier handover (Shipping status), cancellation is not allowed — only the Return workflow applies. Verified against implementation: `Cancelled` is allowed from Pending, Payment Pending, Payment Verifying, Hold, Confirmed, Packed, Packing Hold. NOT allowed from Shipping, Delivered, Partial.

### Stock Impact per Transition

#### Mode A: Inventory Management DISABLED (Current)

| Transition | reserve | release | deduct | restore | reservedStock | managedStockQuantity | Ledger |
|-----------|---------|---------|-------|---------|--------------|-------------------|--------|
| Create (→Pending) | ✅ | — | — | — | ++ | — | InventoryLog |
| →Confirmed | — | — | ✅ (direct) | — | unchanged | -- | ManagedStockLedger (ORDER_DEDUCTION) |
| →Cancelled (pre-courier) | — | ✅ | — | ✅ (direct) | -- | ++ | ManagedStockLedger (CANCEL_RELEASE) |
| →Returned | — | — | — | ✅ (direct) | — | ++ | ManagedStockLedger (RETURN) |
| Add item | ✅ | — | — | — | ++ | — | InventoryLog |
| Remove item | — | ✅ | — | — | -- | — | InventoryLog |
| Dispatch HANDED_OVER | — | — | ✅ (operate) | — | -- | -- | InventoryLog (legacy) |
| Dispatch RETURNED | — | — | — | ✅ (operate) | — | ++ | InventoryLog (legacy) |

#### Mode B: Inventory Management ENABLED (Target)

| Transition | Physical Inventory | Managed Stock (if syncManagedStock=ON) |
|-----------|-------------------|----------------------------------------|
| Create (INVENTORY_CONTROLLED) | RESERVE: reservedQty += | reservedStock++ |
| Create (MANAGED_STOCK) | — | reservedStock++ |
| →Confirmed (MANAGED_STOCK) | CHECK availability, RESERVE: reservedQty += | deduct: managedStockQuantity-- |
| →Confirmed (INVENTORY_CONTROLLED) | CHECK (already reserved) | — |
| →Cancelled | RELEASE: reservedQty -= | release + restore |
| →Returned | ADD: qty += returnQty | restore |
| HANDED_OVER | DEDUCT: qty -=, reservedQty -= | deduct (if not already) |
| GRN | ADD: qty += receivedQty | add |

### Services Involved
- OrdersService — order state machine
- StockService — reserve, release, add, AND (target) deduct, reservePhysical, deductPhysical
- PackingService — packing lock and status transition to Packed/Packing Hold
- DispatchService — courier handoff and stock deduction at HANDED_OVER
- PaymentService — payment capture, verification, and refund

### Issues
1. **Dual deduction** — `managedStockQuantity` decremented at Confirmed AND at HANDED_OVER. Target: Mode B removes deduct from Confirm, moves to HANDED_OVER.
2. **reservedStock never cleared on confirm** — Stays elevated until HANDED_OVER or cancel. **This is correct by design** per target architecture (reserved = held, not deducted).
3. **Packing bypasses validation** — Writes `statusId` directly without checking allowed transitions.
4. **Courier webhook bypasses validation** — Writes Order status directly for DELIVERED/PARTIAL/RETURN_PENDING.
5. **No Physical Inventory reservation** — PhysicalInventory.reservedQuantity does not exist. Need schema migration.
6. **StockService not centralized for Physical Inventory** — StockService needs new methods for physical operations.
7. **No ALWAYS_OUT_OF_STOCK guard** — Orders can be created for discontinued products.

### Ledger Impact (Current)
- Order creation (reserve): InventoryLog (legacy)
- Order confirmed (deductStockForOrder): ManagedStockLedger (OUT, ORDER_DEDUCTION)
- Order cancelled: ManagedStockLedger (IN, CANCEL_RELEASE)
- Order returned: ManagedStockLedger (IN, RETURN)

### Ledger Impact (Target — Mode B)
- Order confirm: ManagedStockLedger (if syncManagedStock) + Physical Inventory ledger (future)
- HANDED_OVER: CostingLot deducted (FIFO) + Physical Inventory qty reduced
- No legacy InventoryLog writes

### Analytics Impact
- Order created → track creation event
- Order cancelled → track cancellation event (`order.status_changed` event + refund tracking)
- No confirmed/delivered event emitted currently

### Accounting Impact
- Order confirmed → Cost snapshot taken (estimated)
- Order delivered → COD auto-paid (UNPAID→PAID)
- Refund → Refund tracking event (future: Revenue reversal entry)
- All other accounting entries: future

### Result
Customer receives items (or refund). Managed Stock adjusted via deductStockForOrder at confirm (not at dispatch). Physical inventory updated on dispatch HANDED_OVER.

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
- InventoryService — GRN creation, PhysicalInventory records, calls StockService.operate('add')
- StockService — add() for received quantities (writes InventoryLog, NOT ManagedStockLedger)

### Ledger Impact
- GRN creation: InventoryLog (legacy 'add') via StockService.operate
- ⚠️ Note: No ManagedStockLedger write for GRN (StockService.operate writes InventoryLog, not ManagedStockLedger)

### Analytics Impact
- No analytics event emitted (no event wiring exists)

### Accounting Impact
- CostingLot created with actual cost

### Result
Physical inventory received. Cost recorded. Managed Stock increased (MANAGED_STOCK only).

---

## Return Workflow

> **Cross-reference:** Return state machine in `docs/2-ARCHITECTURE/STATE_MACHINES.md`

### Trigger
Order is in Shipping/Delivered status and return is requested (post-courier only).

### Flow
```
Order → Return Pending → Returned → Damaged (if applicable)
  │                          │
  └──Money Refund────────────┘
```

### Business Rules
1. **Return Pending** — Set via admin or courier webhook (if courier reports RETURN_PENDING). Not final.
2. **Returned** — Items received back. `handleReturnedSideEffects()` increments `managedStockQuantity` (idempotent — guarded by `hasExistingRestock()`). Writes ManagedStockLedger (RETURN, IN).
3. **Damaged** — Terminal state if items arrived damaged. No stock restore.
4. **Refund** — Created via `POST /refunds`. Refund service sets Order.paymentStatus → `REFUNDED` or `PARTIAL_REFUNDED`. Refund approval triggers `inventoryService.restockOrderItems()` which increments stock + writes both ManagedStockLedger and InventoryLog.
5. **Returns can only be initiated post-courier** (from Shipping/Delivered/Partial). Pre-courier → use Cancellation.

### Services Involved
- OrdersService — `handleReturnedSideEffects()` (direct stock increment)
- RefundsService — refund creation and approval
- InventoryService — `restockOrderItems()` on refund approval (direct stock increment + dual ledger write)
- PaymentService — refund processing

### Ledger Impact
- Order returned: ManagedStockLedger (IN, RETURN) via handleReturnedSideEffects
- Refund approved: ManagedStockLedger (CANCEL_RELEASE or RETURN) + InventoryLog via restockOrderItems

### ⚠️ Known Issue: Double restock risk
If an order goes Cancelled → Confirmed → Returned, both `restoreStockForCancelledOrder()` and `handleReturnedSideEffects()` fire. The idempotency guard (`hasExistingRestock()`) prevents double increment, but the interaction between cancel restore and return restore is fragile.

### Result
Customer refunded. Stock restored (if returned and MANAGED_STOCK).

## Refund Workflow

### Trigger
Order cancellation (pre-courier) or return approval (post-courier).

### State Machine (Refund status — independent)
```
pending → approved → completed → (terminal)
pending → rejected → (terminal)
```

### Flow
```
Refund Created (pending)
  │
  ├─▶ approved
  │     │
  │     └─▶ inventoryService.restockOrderItems()
  │           ├─▶ managedStockQuantity++ (direct — only MANAGED_STOCK/INVENTORY_CONTROLLED)
  │           ├─▶ ManagedStockLedger (CANCEL_RELEASE or RETURN)
  │           └─▶ InventoryLog (legacy — dual write)
  │
  └─▶ completed
        └─▶ Order.paymentStatus recalculated
              ├─▶ Full refund → REFUNDED
              └─▶ Partial refund → PARTIAL_REFUNDED
```

### Business Rules
1. Full refund for cancelled orders. Prorated refund for partial returns.
2. Refund goes to original payment method.
3. Refund approval triggers stock restock via InventoryService.
4. Refund service blocks cancellation if active dispatches exist (HANDED_OVER, PICKED_UP, IN_TRANSIT, DELIVERED).

### Services Involved
- RefundsService — refund creation and state machine
- InventoryService — restockOrderItems() on approval
- PaymentService — refund API call to gateway

### Ledger Impact
- Restock on refund approval: ManagedStockLedger (CANCEL_RELEASE or RETURN) + InventoryLog

### Analytics Impact
- None currently (no analytics event emitted for refunds)

### Result
Money returned. Stock restored (if MANAGED_STOCK/INVENTORY_CONTROLLED). Order payment status updated.

---

## Dispatch Workflow

> **Cross-reference:** Dispatch state machine in `docs/2-ARCHITECTURE/STATE_MACHINES.md`

### Trigger
Order packed and ready for courier handoff (from Packed status).

### State Machine (9 statuses — no transition validation)
```
PENDING → DISPATCHED → HANDED_OVER → PICKED_UP → IN_TRANSIT → DELIVERED
                                                                    │
   (any status at courier webhook) ←── PENDING_RETURN ←──── RETURN_PENDING
```

### Flow
```
Pack → Assign Courier → Handover → In Transit → Delivered
                                          ↓
                                   Return Pending → Returned
```

### Business Rules
1. **PENDING** — Initial state when dispatch record created.
2. **DISPATCHED** — Package handed to courier (first handoff milestone).
3. **HANDED_OVER** — ⚠️ Triggers stockService.operate('deduct') — dual deduction for MANAGED_STOCK (also deducted at Order Confirmed). reservedStock decremented.
4. **PICKED_UP / IN_TRANSIT** — Courier tracking updates. No stock impact.
5. **DELIVERED** — Courier confirms delivery. `updateOrderStatusOnCourierWebhook` sets Order.status to the delivered mapping.
6. **PENDING_RETURN / RETURN_PENDING** — Courier webhook signals return/issue. Sets order.orderStatus through webhook mapping.
7. **Dispatch status has NO transition validation** — any string accepted via `status as any` cast. No nextStatuses DB table. No code-level transition map.
8. **Order status follows independently** — Dispatch status does not control Order status (except via specific webhook handlers).

### Services Involved
- PackingService — packing lock and verification
- DispatchService — courier assignment, tracking, webhook handling
- StockService — operate('deduct') on HANDED_OVER
- OrdersService — order status update on courier webhook

### Ledger Impact
- HANDED_OVER: InventoryLog (legacy 'deduct'), DeductCostingLots, managedStockQuantity-- (via applyStockChange), reservedStock-- (via applyStockChange)

### ⚠️ Known Issues
- No transition validation — any status transition accepted
- Dual deduction: managedStockQuantity decremented at Order Confirmed AND at HANDED_OVER
- DeductCostingLots runs for all availability modes (not just MANAGED_STOCK)

### Result
Items shipped. Stock deducted. Order status update via courier webhook.

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