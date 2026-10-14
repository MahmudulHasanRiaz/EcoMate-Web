-- Task 8 (courier docs audit): Steadfast hybrid multi-merchant credential sets.
--
-- Owner-locked: settings hold MULTIPLE accounts (label + keys, one default);
-- each Dispatch row stores the booking set id (nullable, null = legacy).
-- Tracking / status / balance / webhooks resolve the set from the booking
-- record, never the current default.
--
-- Backfill: NONE in SQL. The existing single set (plaintext columns on
-- CourierCredentials) becomes the default LAZILY in code
-- (SteadfastCredentialSetsService.resolveAuth falls back to the legacy row
-- while this table is empty) — zero friction for single-business, and SQL
-- never sees plaintext keys (they are re-encrypted by the app on first
-- save through the settings UI). A lazy row is NOT auto-created, so an
-- untouched single-business deployment keeps exactly one effective profile.
--
-- Expand-only, no data backfill, safe on redeploy. No 401 retry loops:
-- callers resolve ONE profile upfront and fail fast.

-- New encrypted multi-account table (ciphertext via EncryptionService).
CREATE TABLE "CourierCredentialSet" (
    "id"               TEXT        NOT NULL,
    "courier"          TEXT        NOT NULL DEFAULT 'steadfast',
    "label"            TEXT        NOT NULL,
    "apiKeyEnc"        TEXT,
    "secretKeyEnc"     TEXT,
    "webhookSecretEnc" TEXT,
    "isDefault"        BOOLEAN     NOT NULL DEFAULT false,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierCredentialSet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourierCredentialSet_courier_label_key"
    ON "CourierCredentialSet"("courier", "label");

CREATE INDEX "CourierCredentialSet_courier_idx"
    ON "CourierCredentialSet"("courier");

-- Booking set id on the dispatch record (NULL = legacy default).
ALTER TABLE "Dispatch" ADD COLUMN "credentialSetId" TEXT;

ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_credentialSetId_fkey"
    FOREIGN KEY ("credentialSetId") REFERENCES "CourierCredentialSet"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Dispatch_credentialSetId_idx"
    ON "Dispatch"("credentialSetId");
