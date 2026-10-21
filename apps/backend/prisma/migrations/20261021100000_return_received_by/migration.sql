-- Return.receivedById: the staff member who RECEIVED this return.
--
-- Mirrors Refund.processedBy: a plain id column plus a relation to
-- UserProfile, so the "Received by" log always names a person. Receiving is
-- always a manual act by an employee (scanner "Process return", the detail
-- page's "Mark received") — no automated flow, courier webhook or status sync
-- may ever mark a return received, so this is never "system".
--
-- DDL-only, additive, backfill-free: historical received rows keep NULL and
-- the UI shows the date only (never an invented name).
ALTER TABLE "Return" ADD COLUMN "receivedById" TEXT;

-- AddForeignKey
ALTER TABLE "Return" ADD CONSTRAINT "Return_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
