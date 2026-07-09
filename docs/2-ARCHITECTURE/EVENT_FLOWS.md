# Event Flows — Cross-Module Event Propagation

> **Status:** Verified against implementation  
> **Purpose:** Documents how events propagate across domains. These are the canonical event chains for understanding cross-domain impact.  
> **Cross-reference:** State machines documented in `docs/2-ARCHITECTURE/STATE_MACHINES.md`

---

## 1. Order Created (→ Pending)

```
Order Created
  │
  ├─▶ StockService.reserve per item
  │     │
  │     └─▶ reservedStock++ (all availability modes — even non-managed)
  │     └─▶ InventoryLog (legacy)
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
  ├─▶ deductStockForOrder (DIRECT Prisma write — bypasses StockService)
  │     │
  │     ├─▶ managedStockQuantity-- (only for MANAGED_STOCK + manageStock)
  │     ├─▶ ManagedStockLedger (OUT, ORDER_DEDUCTION)
  │     └─▶ reservedStock NOT decremented (stays elevated — known issue)
  │
  ├─▶ takeCostSnapshot
  │     └─▶ costSnapshot = standardCost per item, costType = 'estimated'
  │
  ├─▶ Order status updated to Confirmed
  │
  └─▶ No analytics event emitted
```

## 3. Dispatch HANDED_OVER

```
Dispatch HANDED_OVER
  │
  ├─▶ stockService.operate('deduct')
  │     │
  │     ├─▶ managedStockQuantity-- (via applyStockChange for MANAGED_STOCK)
  │     ├─▶ reservedStock-- (via applyStockChange — always runs)
  │     ├─▶ InventoryLog (legacy — NOT ManagedStockLedger)
  │     └─▶ DeductCostingLots (runs for all modes — not just MANAGED_STOCK)
  │
  ├─▶ handedOverAt set on Dispatch record
  │
  ├─▶ Order status NOT changed (dispatch is independent)
  │
  └─▶ Courier tracking activated

⚠️ Known Issue: Dual deduction with Order Confirmed. managedStockQuantity
   decremented at Confirmed AND at HANDED_OVER for MANAGED_STOCK products.
```

## 4. Order Cancelled (Pre-Courier)

```
Order Cancelled (pre-courier — from Pending/Confirmed/Packed/Packing Hold)
  │
  ├─▶ StockService.release per item
  │     └─▶ reservedStock--
  │
  ├─▶ restoreStockForCancelledOrder (DIRECT Prisma write — bypasses StockService)
  │     ├─▶ managedStockQuantity++ (only for MANAGED_STOCK, idempotent)
  │     └─▶ ManagedStockLedger (IN, CANCEL_RELEASE)
  │
  ├─▶ fireRefundEvent (tracking pixel)
  │
  ├─▶ order.status_changed event emitted (for admin notifications)
  │
  └─▶ Payment: refund flow begins if already paid
```

## 5. Order Returned

```
Order Returned (status → Returned)
  │
  ├─▶ handleReturnedSideEffects (DIRECT Prisma write — bypasses StockService)
  │     ├─▶ managedStockQuantity++ (only for MANAGED_STOCK, idempotent)
  │     └─▶ ManagedStockLedger (IN, RETURN)
  │
  ├─▶ Order status updated to Returned
  │
  └─▶ No analytics event emitted
```

## 6. Purchase Received (GRN)

```
Purchase Received (GRN Created)
  │
  ├─▶ StockService.add per item
  │     ├─▶ managedStockQuantity++ (only for MANAGED_STOCK)
  │     └─▶ InventoryLog (legacy)
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

```
Payment Verified (admin approves proof)
  │
  ├─▶ Payment.status → PAID
  │
  ├─▶ Order.paymentStatus recalculated
  │     ├─▶ Sum PAID >= total → PAID
  │     ├─▶ 0 < Sum < total → PARTIAL_PAID
  │     └─▶ Sum = 0 → PAYMENT_PENDING
  │
  ├─▶ Order.status → Confirmed (if was Payment Verifying)
  │     └─▶ Triggers Order Confirmed event chain (#2 above)
  │
  └─▶ No analytics event emitted
```

## 8. Refund Completed

```
Refund Completed (refund status → completed)
  │
  ├─▶ Order.paymentStatus recalculated
  │     ├─▶ Full refund → REFUNDED
  │     └─▶ Partial refund → PARTIAL_REFUNDED
  │
  ├─▶ restockOrderItems (InventoryService — only for MANAGED_STOCK/INVENTORY_CONTROLLED)
  │     ├─▶ managedStockQuantity++ (direct Prisma write)
  │     ├─▶ ManagedStockLedger (CANCEL_RELEASE or RETURN, IN)
  │     └─▶ InventoryLog (legacy — dual write)
  │
  └─▶ No analytics event emitted
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