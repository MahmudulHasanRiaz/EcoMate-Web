-- Dispatch: the courier's cancel response/reference.
--
-- When a dispatched order is cancelled, the booking is cancelled WITH the
-- courier first (Carrybee / RedX) and the courier's answer is stored on the
-- dispatch: the booking id we cancelled, when we cancelled it, and the raw
-- response (audit + support).
--
-- DDL-only, additive, backfill-free: existing dispatches keep NULL (they
-- were never cancelled with a courier).
ALTER TABLE "Dispatch" ADD COLUMN "courierCancelRef" TEXT;
ALTER TABLE "Dispatch" ADD COLUMN "courierCancelAt" TIMESTAMP(3);
ALTER TABLE "Dispatch" ADD COLUMN "courierCancelResponse" JSONB;
