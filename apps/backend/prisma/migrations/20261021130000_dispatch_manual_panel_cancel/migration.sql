-- Manual-fallback dispatch cancel (owner directive, 2026-10-21).
--
-- Pathao has a pickup/order cancel API, so its cancels are pushed (API mode).
-- Steadfast has NO cancel API: cancelling the order marks the dispatch
-- cancelled here (MANUAL mode) and the staff still owes the booking cancel in
-- the Steadfast panel. The pending marker lives on the dispatch until an
-- explicit confirmation records the actor + timestamp.
--
-- DDL-only, additive, backfill-free: existing dispatches keep NULL.
CREATE TYPE "CourierCancelMode" AS ENUM ('API', 'MANUAL');

ALTER TABLE "Dispatch" ADD COLUMN "courierCancelMode" "CourierCancelMode";
ALTER TABLE "Dispatch" ADD COLUMN "panelCancelConfirmedAt" TIMESTAMP(3);
ALTER TABLE "Dispatch" ADD COLUMN "panelCancelConfirmedBy" TEXT;
