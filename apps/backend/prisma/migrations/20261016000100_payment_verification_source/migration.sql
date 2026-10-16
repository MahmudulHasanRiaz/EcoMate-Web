-- Payment.verificationSource: how a row was verified — 'auto' (S1 staff
-- auto-verify / API gateway) vs 'manual' (human approve/reject). The admin
-- Verified-by column uses it to show a System chip distinct from a user chip.
-- Nullable: NULL = never verified (or legacy row).
ALTER TABLE "Payment" ADD COLUMN "verificationSource" TEXT;

-- Backfill (deterministic, no guessing):
--  * A staff row whose recordedBy user equals its verifiedBy user is EXACTLY
--    the S1 auto-verify signature — the manual approve path blocks
--    self-approval (403 'Staff cannot approve their own entry'), so no human
--    approve can ever produce recordedBy = verifiedBy.
UPDATE "Payment"
SET "verificationSource" = 'auto'
WHERE "verifiedBy" IS NOT NULL
  AND "recordedBy" IS NOT NULL
  AND "recordedBy" = 'staff:' || "verifiedBy";

--  * Every other verified row was verified by a different actor → manual.
UPDATE "Payment"
SET "verificationSource" = 'manual'
WHERE "verifiedBy" IS NOT NULL
  AND "verificationSource" IS NULL;
