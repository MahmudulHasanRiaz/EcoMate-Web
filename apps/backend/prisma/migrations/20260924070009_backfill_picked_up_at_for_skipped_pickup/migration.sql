-- Backfill Dispatch.pickedUpAt for rows that progressed past pickup without
-- ever recording the explicit PICKED_UP transition (missed pickup webhook,
-- HOLD → IN_TRANSIT/DELIVERED, courier sync mapping straight to a later status).
-- Dashboard "Picked Up" KPI reads this column — without the stamp those
-- orders never count as picked up.
--
-- RETURN_PENDING / RETURNED included: a parcel cannot return without first
-- being picked up.
--
-- First write wins: only null pickedUpAt. Event time best-effort from the
-- closest available event timestamp (courier status time → handover → row
-- update → create).
UPDATE "Dispatch" d
SET "pickedUpAt" = COALESCE(d."courierStatusAt", d."handedOverAt", d."updatedAt", d."createdAt")
FROM "Order" o
WHERE o.id = d."orderId"
  AND o."trashedAt" IS NULL
  AND d."pickedUpAt" IS NULL
  AND d."status" IN (
    'PICKED_UP', 'IN_TRANSIT', 'ASSIGNED_TO_RIDER', 'DELIVERED', 'PARTIAL',
    'RETURN_PENDING', 'RETURNED'
  );
