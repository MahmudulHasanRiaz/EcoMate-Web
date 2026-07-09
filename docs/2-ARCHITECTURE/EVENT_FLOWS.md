# Event Flows — Cross-Module Event Propagation

> **Status:** Target architecture (not current implementation)  
> **Purpose:** Documents how events SHOULD propagate across domains per the dual-mode stock architecture.  
> **Cross-reference:** State machines in `docs/2-ARCHITECTURE/STATE_MACHINES.md`, invariants in `docs/1-BUSINESS/ARCHITECTURE_INVARIANTS.md`

---

**Important:** Event flows depend on whether **Inventory Management** feature is enabled:

- **Mode A (Disabled):** Managed Stock is primary. Current implementation (see ⚠️ notes for known violations).
- **Mode B (Enabled):** Physical Inventory is primary. Managed Stock is optional per-product (`syncManagedStock`).

Current implementation follows Mode A with several bugs. Mode B requires new code.

---

## 1. Order Created (→ Pending)

```
Order Created
  │
  ├─▶ [Mode A] StockService.reserve() → reservedStock++
  │       └─▶ InventoryLog (legacy)
  │
  ├─▶ [Mode B, INVENTORY_CONTROLLED] StockService.reservePhysical()
  │       └─▶ PhysicalInventory.reservedQuantity += orderQty
  │
  ├─▶ [Mode B, MANAGED_STOCK] No physical reserve yet (reserved at Confirm)
  │
  ├─▶ PaymentStatus set: PAYMENT_PENDING (FULL_PAYMENT/PARTIAL_PAYMENT)
  │                      or UNPAID (CASH_ON_DELIVERY)
  │
  ├─▶ OrderStatus set: Pending (isInitial)
  │
  └─▶ No analytics event emitted
```

## 2. Order Confirmed

```
Order Confirmed (status → Confirmed)
  │
  ├─▶ [Mode A] StockService.deduct() → managedStockQuantity--
  │     └─▶ ManagedStockLedger (OUT, ORDER_DEDUCTION)
  │
  ├─▶ [Mode B] StockService.checkPhysicalAvailability() — if insufficient, REJECT
  │     └─▶ StockService.reservePhysical() → PhysicalInventory.reservedQuantity +=
  │
  ├─▶ [Mode B + syncManagedStock=ON] StockService.deduct() → managedStockQuantity--
  │     └─▶ ManagedStockLedger (OUT, ORDER_DEDUCTION)
  │
  ├─▶ takeCostSnapshot
  │     └─▶ costSnapshot = standardCost per item, costType = 'estimated'
  │
  ├─▶ Order status updated to Confirmed
  │
  └─▶ No analytics event emitted

⚠️ Current implementation: deductStockForOrder() uses DIRECT Prisma writes
   (bypasses StockService). Mode B physical check + reserve not implemented.
```

## 3. Dispatch HANDED_OVER

```
Dispatch HANDED_OVER
  │
  ├─▶ [Mode A] StockService.operate('deduct')
  │     ├─▶ managedStockQuantity-- (via applyStockChange)
  │     ├─▶ reservedStock-- (via applyStockChange)
  │     └─▶ InventoryLog (legacy)
  │
  ├─▶ [Mode B] StockService.deductPhysical()
  │     ├─▶ PhysicalInventory.quantity -= orderQty
  │     ├─▶ PhysicalInventory.reservedQuantity -= orderQty
  │     └─▶ CostingLot deducted (FIFO actual cost)
  │
  ├─▶ [Mode B + syncManagedStock=ON] StockService.deduct() → managedStockQuantity--
  │
  ├─▶ handedOverAt set on Dispatch record
  │
  ├─▶ Order status NOT changed (dispatch is independent)
  │
  └─▶ Courier tracking activated

⚠️ Current Mode A: Dual deduction with Order Confirmed. managedStockQuantity
   decremented at Confirmed AND at HANDED_OVER for MANAGED_STOCK products.
   DeductCostingLots runs for ALL modes (not just MANAGED_STOCK).
```

## 4. Order Cancelled (Pre-Courier)

```
Order Cancelled (pre-courier — from Pending/Confirmed/Packed/Packing Hold)
  │
  ├─▶ [Mode A] StockService.release() → reservedStock--
  │     └─▶ StockService.restoreStock() → managedStockQuantity++
  │
  ├─▶ [Mode B] StockService.releasePhysical()
  │     └─▶ PhysicalInventory.reservedQuantity -= orderQty
  │
  ├─▶ [Mode B + syncManagedStock=ON] StockService.release() + restoreStock()
  │
  ├─▶ fireRefundEvent (tracking pixel)
  │
  ├─▶ order.status_changed event emitted (for admin notifications)
  │
  └─▶ Payment: refund flow begins if already paid

⚠️ Current implementation: restoreStockForCancelledOrder() uses DIRECT Prisma writes.
   Mode B physical release not implemented.
```

## 5. Order Returned

```
Order Returned (status → Returned)
  │
  ├─▶ [Mode A] StockService.add() → managedStockQuantity++
  │     └─▶ ManagedStockLedger (IN, RETURN)
  │
  ├─▶ [Mode B] StockService.addPhysical()
  │     └─▶ PhysicalInventory.quantity += returnQty
  │
  ├─▶ [Mode B + syncManagedStock=ON] StockService.add() → managedStockQuantity++
  │
  ├─▶ Order status updated to Returned
  │
  └─▶ No analytics event emitted

⚠️ Current implementation: handleReturnedSideEffects() uses DIRECT Prisma writes.
```

## 6. Purchase Received (GRN)

```
Purchase Received (GRN Created)
  │
  ├─▶ [Mode A] StockService.add()
  │     ├─▶ managedStockQuantity++ (only for MANAGED_STOCK)
  │     └─▶ InventoryLog (legacy)
  │
  ├─▶ [Mode B] StockService.addPhysical()
  │     └─▶ PhysicalInventory.quantity += receivedQty
  │
  ├─▶ [Mode B + syncManagedStock=ON] StockService.add() → managedStockQuantity++
  │
  ├─▶ Physical Inventory → quantity increased
  │     └─▶ CostingLot created (actual cost recorded)
  │
  ├─▶ Accounting (future)
  │     └─▶ Inventory Asset increased
  │
  └─▶ No analytics event emitted
```

## 7. Payment Verified

(No stock impact — payment only)

## 8. Refund Completed

```
Refund Completed (refund status → completed)
  │
  ├─▶ Order.paymentStatus recalculated
  │     ├─▶ Full refund → REFUNDED
  │     └─▶ Partial refund → PARTIAL_REFUNDED
  │
  ├─▶ [Mode A] StockService.add() → managedStockQuantity++
  │     └─▶ ManagedStockLedger (CANCEL_RELEASE or RETURN, IN)
  │
  ├─▶ [Mode B] StockService.addPhysical()
  │     └─▶ PhysicalInventory.quantity +=
  │
  ├─▶ [Mode B + syncManagedStock=ON] StockService.add() → managedStockQuantity++
  │
  └─▶ No analytics event emitted

⚠️ Current implementation: restockOrderItems() writes directly to ManagedStockLedger
   AND InventoryLog (dual legacy write).
```

## 9. License Activated

```
License Key Entered
  │
  ├─▶ KeyMate API validation
  │     ├─▶ Success → 7-day cache created
  │     │           └─▶ Feature flags unlocked per license plan
  │     └─▶ Failure → error returned, no cache
  │
  ├─▶ LicenseGuard → global license check passes
  │
  └─▶ FeatureGuard → per-route feature check passes (or blocks)
```

## 10. Stock Transfer (between warehouses/bins)

```
Stock Transfer
  │
  ├─▶ InventoryLog (legacy — transfer entry)
  │
  ├─▶ Warehouse/Bin quantities NOT changed (not implemented)
  │
  └─▶ No managed stock or ledger impact
```

## Complete System Event Map

```
                    ┌─────────────────────────────┐
                    │       License Activation     │
                    └──────────┬──────────────────┘
                               │
                               ▼
                    ┌─────────────────────────────┐
                    │     FeatureGuard unlocks     │
                    │     all protected routes     │
                    └─────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
  │   Storefront  │    │     Admin    │    │     POS      │
  │  (Customer)   │    │   (Ops/CS)   │    │  (In-Store)  │
  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
         │                   │                   │
         ▼                   ▼                   ▼
  ┌──────────────────────────────────────────────────────┐
  │                         Orders                        │
  │  Pending → Payment Pending → Confirmed → Packed →    │
  │  Shipping → Delivered (+ Cancelled/Return branches)  │
  └──────┬────────────────┬──────────────────┬───────────┘
         │                │                  │
         ▼                ▼                  ▼
  ┌──────────┐    ┌──────────────┐   ┌──────────────┐
  │ StockSvc │    │  PackingSvc  │   │ DispatchSvc  │
  │ reserve  │    │  lock/verify │   │ courier/hand │
  │ release  │    │  markDone →  │   │ over/status  │
  │ add      │    │  Packed      │   │ HANDED_OVER  │
  │ (deduct  │    │  markHold →  │   │ → deduct     │
  │  via op) │    │  Packing Hold│   └──────┬───────┘
  └────┬─────┘    └──────────────┘          │
       │                                    │
       ▼                                    ▼
  ┌──────────────┐                 ┌──────────────┐
  │ ManagedStock │                 │  Inventory   │
  │   Ledger     │                 │  (Physical)  │
  └──────────────┘                 └──────┬───────┘
       │                                  │
       ▼                                  ▼
  ┌───────────────────────────────────────────┐
  │              Analytics                     │
  │  (order.status_changed, refund tracking)  │
  └──────────────────┬────────────────────────┘
                     │
                     ▼
  ┌───────────────────────────────────────────┐
  │             Accounting                     │
  │  (Cost snapshots, COD auto-pay, future)   │
  └───────────────────────────────────────────┘
```