-- License activation audit trail + single-activation guarantee.
--
-- Two problems this addresses:
--
--  1. LicenseActivation had no unique constraint and was read with
--     findFirst() (no ordering), so two concurrent activations could both
--     insert and the surviving row afterwards was unspecified. The activation
--     endpoint was also @Public(), which made concurrent calls trivial to
--     produce from anywhere on the internet. Activations now upsert on a fixed
--     singleton id.
--
--  2. A license change left no trace: the stored key was overwritten with no
--     record of the previous value, the actor, or the source IP. There is now
--     an append-only history table.
--
-- Only fingerprints (a truncated SHA-256 of the encrypted value) are stored,
-- never a decrypted key, so this cannot become a second copy of the secret.
CREATE TABLE "LicenseActivationHistory" (
    "id"                    TEXT        NOT NULL,
    -- activated | reactivated | deactivated
    "action"                TEXT        NOT NULL,
    -- Truncated SHA-256 of the encrypted license key, so successive changes can
    -- be correlated without holding the key itself.
    "licenseKeyFingerprint" TEXT,
    "previousKeyFingerprint" TEXT,
    "domain"                TEXT,
    "previousDomain"        TEXT,
    "actorUserId"           TEXT,
    "actorIp"               TEXT,
    "success"               BOOLEAN     NOT NULL DEFAULT true,
    "error"                 TEXT,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LicenseActivationHistory_pkey" PRIMARY KEY ("id")
);

-- "What changed on this license, most recent first" is the only query the
-- admin settings screen needs.
CREATE INDEX "LicenseActivationHistory_createdAt_idx"
    ON "LicenseActivationHistory" ("createdAt");

CREATE INDEX "LicenseActivationHistory_actorUserId_idx"
    ON "LicenseActivationHistory" ("actorUserId");
