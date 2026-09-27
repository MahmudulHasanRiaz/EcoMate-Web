-- §3/§18 source-column fidelity: Postgres jsonb re-serializes object keys
-- (length-then-byte order), so the imported sheet cannot reconstruct the
-- original file column order from rawJson alone. Freeze it at import time.

-- AlterTable
ALTER TABLE "CourierSettlementInvoice" ADD COLUMN "sourceHeaders" JSONB;

-- Drift alignment (schema is source of truth): the singleton unique on
-- (orderItemId) predates the composite unique (orderItemId, cycleId) declared
-- in the datamodel; it would block legitimate multi-cycle reservations.
-- DropIndex
DROP INDEX "PhysicalReservation_orderItemId_key";
