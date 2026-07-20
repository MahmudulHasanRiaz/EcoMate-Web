---
paths:
  - "apps/backend/src/accounting/**/*"
  - "apps/backend/src/accounts/**/*"
  - "apps/backend/src/financial-periods/**/*"
  - "apps/backend/src/opening-balances/**/*"
  - "apps/backend/src/payments/**/*"
  - "apps/backend/src/refunds/**/*"
  - "apps/backend/src/orders/**/*"
  - "apps/backend/src/purchases/**/*"
  - "apps/backend/src/inventory/**/*"
  - "apps/backend/src/stock/**/*"
  - "apps/backend/src/warehouses/**/*"
  - "apps/backend/prisma/**/*"
---

# ERP and Commerce Integrity

- Read the current service and its tests before changing a financial, stock, order, payment, refund, or purchase workflow.
- Preserve double-entry accounting: every journal entry must balance, each line has exactly one non-zero debit or credit, and group accounts are not posted to directly.
- Use Prisma `Decimal` or the established money representation. Do not introduce floating-point arithmetic for persisted money.
- Preserve idempotency keys and replay protection on externally retried operations.
- `managedStockQuantity` is the physical-stock source of truth. Stock changes must use the established inventory/stock service and write the corresponding ledger entry.
- Keep stock reservation, release, cancellation, return, transfer, and adjustment operations atomic and cycle-safe.
- Treat order, payment, shipment, refund, and accounting status changes as validated state transitions, not unrestricted field updates.
- Wrap cross-table mutations in a transaction and add tests for retry, duplicate submission, rollback, and boundary cases where applicable.
- Never repair a balance or stock discrepancy with an unexplained direct update. Preserve an auditable trail.
