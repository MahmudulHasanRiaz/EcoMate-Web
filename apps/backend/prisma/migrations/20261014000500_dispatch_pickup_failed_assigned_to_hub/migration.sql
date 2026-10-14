-- Task 3 / Fix 7 (courier FINAL follow-up, owner-locked): new DispatchStatus
-- values for the pickup-failed + last-mile-hub courier events.
--
-- ADD ONLY — never rename/remove an enum value (old rows + old code keep
-- working). Expand-only, no data backfill, safe on redeploy and re-runnable:
-- each ADD VALUE is guarded (duplicate_object catch, per the
-- 20261014000200_void_placeholder_payments precedent).
--
-- Semantics (code wiring ships in the same commit):
-- - PICKUP_FAILED: order.pickup-failed (Pathao + Carrybee) → record attempt +
--   reason + alert, order Shipping; staff can retry/update the same dispatch.
-- - ASSIGNED_TO_HUB: order.received-at-last-mile-hub (Pathao + Carrybee) →
--   order Shipping. ASSIGNED_TO_RIDER is then ONLY for assigned-for-delivery.
-- - order.delivery-failed stays record-only (no dispatch state, both couriers).

DO $$ BEGIN
  ALTER TYPE "DispatchStatus" ADD VALUE 'PICKUP_FAILED';
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'F7 PICKUP_FAILED migration: DispatchStatus PICKUP_FAILED already exists — skipping';
END $$;

DO $$ BEGIN
  ALTER TYPE "DispatchStatus" ADD VALUE 'ASSIGNED_TO_HUB';
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'F7 ASSIGNED_TO_HUB migration: DispatchStatus ASSIGNED_TO_HUB already exists — skipping';
END $$;
