-- Courier Settlement — post-finalize states (§5): ADJUSTED + RECONCILED.
-- Additive enum values only; no data change.

ALTER TYPE "CourierSettlementInvoiceState" ADD VALUE IF NOT EXISTS 'ADJUSTED';
ALTER TYPE "CourierSettlementInvoiceState" ADD VALUE IF NOT EXISTS 'RECONCILED';
