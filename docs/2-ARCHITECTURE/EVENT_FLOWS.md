# Event Flows — Cross-Module Event Propagation

> **Status:** Draft  
> **Purpose:** Documents how events propagate across domains. These are the canonical event chains for understanding cross-domain impact.

---

## 1. Order Confirmed

```
Order Confirmed
  │
  ├─▶ Reservation (StockService.reserve)
  │     │
  │     └─▶ ManagedStockLedger (OUT, RESERVED)
  │
  ├─▶ Managed Stock decreased (available = managedStockQuantity - reservedStock)
  │
  ├─▶ Physical Inventory (no direct change — reservation is a managed stock concept)
  │
  ├─▶ Analytics
  │     └─▶ Order Confirmed event tracked
  │
  ├─▶ Accounting (future)
  │     └─▶ Accounts Receivable entry
  │
  └─▶ Commission (future)
        └─▶ Sales commission calculated
```

## 2. Order Dispatched

```
Order Dispatched
  │
  ├─▶ StockService.deduct
  │     │
  │     └─▶ ManagedStockLedger (OUT, SOLD)
  │
  ├─▶ Managed Stock decreased (deducted)
  │
  ├─▶ Physical Inventory allocated → decremented
  │
  ├─▶ PackingLock released
  │
  ├─▶ Courier assigned
  │
  ├─▶ Analytics
  │     └─▶ Dispatch event tracked
  │
  └─▶ Accounting (future)
        └─▶ Revenue recognition → Cost of Goods Sold entry
```

## 3. Purchase Received (GRN)

```
Purchase Received (GRN Created)
  │
  ├─▶ StockService.add
  │     │
  │     └─▶ ManagedStockLedger (IN, PURCHASED)
  │
  ├─▶ Physical Inventory → quantity increased
  │     │
  │     └─▶ CostingLot created (actual cost recorded)
  │
  ├─▶ Managed Stock increased
  │
  ├─▶ Analytics
  │     └─▶ Procurement event tracked
  │
  └─▶ Accounting
        └─▶ Inventory Asset increased
        └─▶ Accounts Payable entry (future)
```

## 4. Return Processed

```
Return Processed
  │
  ├─▶ Money Refund
  │     │
  │     └─▶ Payment reversal processed
  │     └─▶ Accounting: Revenue reversal
  │
  ├─▶ Item Returned to Warehouse
  │     │
  │     ├─▶ Physical Inventory → quantity increased (if item returned)
  │     │
  │     └─▶ StockService.add (if restocking)
  │           │
  │           └─▶ ManagedStockLedger (IN, RETURNED)
  │
  ├─▶ Analytics
  │     └─▶ Return event tracked
  │     └─▶ Refund value tracked
  │
  └─▶ Accounting
        └─▶ Revenue reversal
        └─▶ Inventory Asset adjustment
```

## 5. Stock Transfer

```
Stock Transfer (between warehouses/bins)
  │
  ├─▶ Origin Warehouse → quantity decreased
  │
  ├─▶ Destination Warehouse → quantity increased
  │
  ├─▶ Inventory Ledger (future)
  │     └─▶ OUT from origin, IN to destination
  │
  ├─▶ Inventory Valuation → adjusted per warehouse
  │
  └─▶ Analytics
        └─▶ Transfer event tracked (future)
```

## 6. License Activated

```
License Key Entered
  │
  ├─▶ KeyMate API validation
  │     │
  │     ├─▶ Success → 7-day cache created
  │     │           └─▶ Feature flags unlocked per license plan
  │     │
  │     └─▶ Failure → error returned, no cache
  │
  ├─▶ LicenseGuard → global license check passes
  │
  └─▶ FeatureGuard → per-route feature check passes (or blocks)
```

## 7. Order Cancelled (Pre-Dispatch)

```
Order Cancelled (Pre-Dispatch)
  │
  ├─▶ StockService.release
  │     │
  │     └─▶ ManagedStockLedger (IN, RELEASED)
  │
  ├─▶ Managed Stock increased (reservation released)
  │
  ├─▶ Money Refund (if paid)
  │     │
  │     └─▶ Payment reversal
  │
  ├─▶ Analytics
  │     └─▶ Cancellation event tracked
  │
  └─▶ Accounting (future)
        └─▶ Revenue reversal (if paid)
```

## 8. Order Cancelled (Post-Dispatch) — Return flow

```
Order Cancelled (Post-Dispatch)
  │
  └─▶ Return Workflow
        ├─▶ Item returned to warehouse
        ├─▶ StockService.add
        ├─▶ Money refunded
        └─▶ Analytics tracked
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
  ┌─────────────────────────────────────────────────────┐
  │                      Orders                          │
  │  Draft → Confirmed → Processing → Packed → Dispatch │
  └──────┬──────────────┬──────────────┬────────────────┘
         │              │              │
         ▼              ▼              ▼
  ┌──────────┐  ┌────────────┐  ┌──────────────┐
  │ StockSvc │  │ PackingSvc │  │ DispatchSvc  │
  │ reserve  │  │ lock/verify│  │ courier/hand │
  │ deduct   │  │ unlock     │  │ over/track   │
  │ release  │  └────────────┘  └──────┬───────┘
  │ add      │                         │
  └────┬─────┘                         │
       │                               │
       ▼                               ▼
  ┌──────────────┐            ┌──────────────┐
  │ ManagedStock │            │  Inventory   │
  │   Ledger     │            │  (Physical)  │
  └──────────────┘            └──────┬───────┘
       │                             │
       ▼                             ▼
  ┌──────────────────────────────────────┐
  │             Analytics                 │
  │  (Page Views, Conversions, Events)   │
  └──────────────┬───────────────────────┘
                 │
                 ▼
  ┌──────────────────────────────────────┐
  │            Accounting                 │
  │  (Revenue, COGS, Inventory Asset)    │
  └──────────────────────────────────────┘
