-- Allow Confirmed orders to transition to Hold (pause/deliver-later flow).
-- Appends the Hold status id to Confirmed.nextStatuses (idempotent jsonb merge).
UPDATE "OrderStatus" AS c
SET "nextStatuses" = c."nextStatuses" || jsonb_build_array(h.id)
FROM "OrderStatus" AS h
WHERE c."name" = 'Confirmed'
  AND h."name" = 'Hold'
  AND NOT (c."nextStatuses" @> jsonb_build_array(h.id));