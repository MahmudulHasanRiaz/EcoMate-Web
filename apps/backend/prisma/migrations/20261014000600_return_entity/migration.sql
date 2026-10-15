-- Task 6 (courier FINAL follow-up, Fix 13 §§17.1–17.3): unified Return entity.
--
-- ADD ONLY — new enums + new tables + new indexes. No existing table, column,
-- enum value, or index is touched, so old rows + old code keep working and the
-- migration is safe on redeploy. Schema wiring (model Return + ReturnCounter)
-- ships in the SAME commit.
--
-- Semantics (code wiring ships in the same commit):
-- - Return: EVERY return creates ONE row (source STAFF | COURIER | EXCHANGE) —
--   never a phantom Order. RTN return-orders (rtn module) stay separate.
-- - displayId: human sequence RTN-YYMMDD-NNNN via ReturnCounter (mirrors the
--   ORD-XXXX OrderCounter generator; own counter so order numbering never
--   shifts). Enforced unique in SQL below.
-- - status chain: REQUESTED → IN_TRANSIT → RECEIVED → RESTOCKED → CLOSED.
-- - items: JSONB [{ productId, variantId?, quantity }]. Courier-sourced rows
--   start EMPTY (the courier API never reports the split) — staff confirm
--   exact quantities at mark-received; nothing restocks until then.
-- - courierReturnId: first courier-side return reference seen (Pathao
--   return_consignment_id, Steadfast return_request_id / return_list_id, or
--   the consignment id for reconcile-created rows). Set-once; indexed.
-- - stockReconciled (+At): durable item-restore guard, set in the SAME
--   transaction as the stock movement (reconcile retries + mark-received can
--   never restore twice).

-- CreateEnum
CREATE TYPE "ReturnType" AS ENUM ('FULL', 'PARTIAL', 'EXCHANGE');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'IN_TRANSIT', 'RECEIVED', 'RESTOCKED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReturnSource" AS ENUM ('STAFF', 'COURIER', 'EXCHANGE');

-- CreateTable
CREATE TABLE "Return" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "displayId" TEXT NOT NULL,
    "type" "ReturnType" NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "items" JSONB NOT NULL DEFAULT '[]',
    "reason" TEXT,
    "source" "ReturnSource" NOT NULL,
    "courier" TEXT,
    "courierReturnId" TEXT,
    "courierStatus" TEXT,
    "stockReconciled" BOOLEAN NOT NULL DEFAULT false,
    "stockReconciledAt" TIMESTAMP(3),
    "refundId" TEXT,
    "exchangeOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Return_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnCounter" (
    "date" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "ReturnCounter_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE UNIQUE INDEX "Return_displayId_key" ON "Return"("displayId");

-- CreateIndex
CREATE INDEX "Return_orderId_idx" ON "Return"("orderId");

-- CreateIndex
CREATE INDEX "Return_courierReturnId_idx" ON "Return"("courierReturnId");

-- AddForeignKey
ALTER TABLE "Return" ADD CONSTRAINT "Return_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
