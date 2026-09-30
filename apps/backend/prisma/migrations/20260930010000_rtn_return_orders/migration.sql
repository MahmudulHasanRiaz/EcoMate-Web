-- RTN return orders: order kind, original-order relationship (one RTN per
-- original, database-enforced), return timestamp, stock-restore idempotency.
CREATE TYPE "OrderKind" AS ENUM ('SALE', 'RETURN');

ALTER TABLE "Order"
  ADD COLUMN "kind" "OrderKind" NOT NULL DEFAULT 'SALE',
  ADD COLUMN "returnOfOrderId" TEXT,
  ADD COLUMN "returnedAt" TIMESTAMP(3),
  ADD COLUMN "stockRestored" BOOLEAN NOT NULL DEFAULT false;

-- One original order -> at most one RTN order (NULLs are distinct in Postgres,
-- so every normal sale order keeps returnOfOrderId = NULL).
CREATE UNIQUE INDEX "Order_returnOfOrderId_key" ON "Order"("returnOfOrderId");
CREATE INDEX "Order_kind_idx" ON "Order"("kind");
CREATE INDEX "Order_returnOfOrderId_idx" ON "Order"("returnOfOrderId");

-- RTN items link back to the original sale-order item (costing restoration).
ALTER TABLE "OrderItem"
  ADD COLUMN "sourceOrderItemId" TEXT;

CREATE INDEX "OrderItem_sourceOrderItemId_idx" ON "OrderItem"("sourceOrderItemId");

-- Business rule: 'Partial' can no longer be closed to 'Delivered' through the
-- generic status path. A Partial order must be resolved via the RTN return
-- order workflow, which performs Partial -> Delivered itself at creation.
-- Reverses 20260928000500_partial_delivered_transition.
UPDATE "OrderStatus" AS p
SET "nextStatuses" = (
  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
  FROM jsonb_array_elements(p."nextStatuses") AS elem
  WHERE elem <> (SELECT to_jsonb(d.id) FROM "OrderStatus" AS d WHERE d."name" = 'Delivered')
)
WHERE p."name" = 'Partial';
