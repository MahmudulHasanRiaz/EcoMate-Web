-- Cancel a DISPATCHED order (owner directive, 2026-10-21): a shipped order
-- can be cancelled while its dispatch is still cancellable with the courier
-- (the dispatch is cancelled with the courier FIRST, then the order — a
-- picked-up / handed-over dispatch is refused by the runtime gate).
--
-- The transition lives in the shared map (src/orders/order-transitions.ts) and
-- the seed writes it only for statuses it creates — an existing installation's
-- configured transitions are never overwritten by a reseed. So the 'Cancelled'
-- exit is added to Shipping.nextStatuses here, exactly like the earlier
-- 'Partial' → 'Delivered' reversal (20260930010000_rtn_return_orders).
--
-- Idempotent: the Cancelled id is added only when it is not present yet.
UPDATE "OrderStatus" AS s
SET "nextStatuses" = (
  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
  FROM (
    SELECT elem FROM jsonb_array_elements(COALESCE(s."nextStatuses", '[]'::jsonb)) AS elem
    UNION ALL
    SELECT to_jsonb(c.id) FROM "OrderStatus" AS c WHERE c."name" = 'Cancelled'
  ) AS merged
)
WHERE s."name" = 'Shipping'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(s."nextStatuses", '[]'::jsonb)) AS elem
    WHERE elem = (SELECT to_jsonb(c2.id) FROM "OrderStatus" AS c2 WHERE c2."name" = 'Cancelled')
  );
