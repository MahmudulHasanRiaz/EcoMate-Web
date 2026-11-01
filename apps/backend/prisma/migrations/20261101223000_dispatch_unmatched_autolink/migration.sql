-- Courier consignment auto-connect (2026-11-01): a Dispatch row may now be
-- UNMATCHED (orderId NULL) — a consignment a courier reported by webhook
-- that no order could be resolved for (e.g. a courier-panel exchange booked
-- under the original order's invoice). courierInvoiceRef stores the
-- merchant order id / invoice verbatim so the row can be matched to an
-- order later (staff assign, or auto retro-link on exchange create).
-- DDL-only and fail-safe on every client shape: DROP NOT NULL and ADD
-- COLUMN cannot fail on existing data; no rows are read or rewritten.
ALTER TABLE "Dispatch" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "Dispatch" ADD COLUMN "courierInvoiceRef" TEXT;
CREATE INDEX "Dispatch_courierInvoiceRef_idx" ON "Dispatch"("courierInvoiceRef");
