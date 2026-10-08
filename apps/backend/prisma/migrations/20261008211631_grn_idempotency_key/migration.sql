-- GRN idempotency key: client-supplied Idempotency-Key stored uniquely so a
-- retried POST returns the original GRN instead of double-posting stock.
-- Purely additive (nullable column + unique index).
ALTER TABLE "GoodsReceiptNote" ADD COLUMN "clientKey" TEXT;
CREATE UNIQUE INDEX "GoodsReceiptNote_clientKey_key" ON "GoodsReceiptNote"("clientKey");
