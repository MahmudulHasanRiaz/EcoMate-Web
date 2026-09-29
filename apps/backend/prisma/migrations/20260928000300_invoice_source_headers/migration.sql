-- §3/§18 source-column fidelity: Postgres jsonb re-serializes object keys
-- (length-then-byte order), so the imported sheet cannot reconstruct the
-- original file column order from rawJson alone. Freeze it at import time.

-- AlterTable
ALTER TABLE "CourierSettlementInvoice" ADD COLUMN "sourceHeaders" JSONB;

-- Drift alignment (schema is source of truth): the singleton unique on
-- (orderItemId) predates the composite unique (orderItemId, cycleId) declared
-- in the datamodel; it would block legitimate multi-cycle reservations.
-- DropIndex
-- IF EXISTS: the singleton index is already dropped by
-- 20260715132458_cycle_safe_reservation_and_combo_snapshot, so a shadow-DB
-- replay reaches this statement with nothing to drop.
DROP INDEX IF EXISTS "PhysicalReservation_orderItemId_key";
