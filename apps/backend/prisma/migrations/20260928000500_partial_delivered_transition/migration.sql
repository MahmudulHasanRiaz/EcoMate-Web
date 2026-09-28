-- Allow a manually-staffed Partial order to be marked Delivered.
-- Partial is an automation-stopped state: couriers/webhooks never move it, but
-- staff must be able to close it out as Delivered (partially delivered, then
-- resolved) as well as send it to Return Pending.
-- Appends the Delivered status id to Partial.nextStatuses (idempotent jsonb merge).
UPDATE "OrderStatus" AS p
SET "nextStatuses" = p."nextStatuses" || jsonb_build_array(d.id)
FROM "OrderStatus" AS d
WHERE p."name" = 'Partial'
  AND d."name" = 'Delivered'
  AND NOT (p."nextStatuses" @> jsonb_build_array(d.id));
