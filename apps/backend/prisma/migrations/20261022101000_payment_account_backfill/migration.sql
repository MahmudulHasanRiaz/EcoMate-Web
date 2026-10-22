-- Part 2: idempotent backfill of Payment.accountId (data only).
--
-- Rule order (owner directive):
--   1. legacy account string exactly matches its gateway's phoneNumber AND
--      that gateway already has a mapped settlement accountId;
--   2. otherwise the legacy string matches an Account.name or Account.code
--      (trimmed, case-insensitive), restricted to asset leaves (non-group);
--   3. otherwise leave NULL — the legacy string stays the display value.
--
-- Idempotency: both statements only touch rows whose accountId IS NULL, so
-- re-running this migration changes nothing.
--
-- Reporting query (run against a copy; not executed by the migration):
--   WITH nulls AS (
--     SELECT p.id, p.account, p."gatewayCode", g."phoneNumber", g."accountId" AS gateway_account
--     FROM "Payment" p
--     LEFT JOIN "PaymentGateway" g ON g.code = p."gatewayCode"
--     WHERE p."accountId" IS NULL
--   )
--   SELECT
--     count(*) FILTER (WHERE gateway_account IS NOT NULL
--                        AND btrim(account) = btrim("phoneNumber")) AS rule_1,
--     count(*) FILTER (WHERE NOT (gateway_account IS NOT NULL
--                        AND btrim(account) = btrim("phoneNumber"))
--                        AND EXISTS (
--                          SELECT 1 FROM "Account" a
--                          WHERE a.type = 'asset' AND a."isGroup" = false
--                            AND (lower(btrim(a.name)) = lower(btrim(nulls.account))
--                              OR lower(btrim(a.code)) = lower(btrim(nulls.account)))
--                        )) AS rule_2,
--     count(*) FILTER (WHERE NOT EXISTS (
--                          SELECT 1 FROM "Account" a
--                          WHERE a.type = 'asset' AND a."isGroup" = false
--                            AND (lower(btrim(a.name)) = lower(btrim(nulls.account))
--                              OR lower(btrim(a.code)) = lower(btrim(nulls.account)))
--                        )
--                        AND NOT (gateway_account IS NOT NULL
--                          AND btrim(account) = btrim("phoneNumber"))) AS unmatched
--   FROM nulls;

-- Rule 1 — exact phoneNumber match + gateway mapped.
WITH rule1 AS (
  SELECT p.id, g."accountId" AS account_id
  FROM "Payment" p
  JOIN "PaymentGateway" g ON g.code = p."gatewayCode"
  WHERE p."accountId" IS NULL
    AND g."accountId" IS NOT NULL
    AND p.account IS NOT NULL
    AND g."phoneNumber" IS NOT NULL
    AND btrim(p.account) = btrim(g."phoneNumber")
)
UPDATE "Payment" p
SET "accountId" = rule1.account_id
FROM rule1
WHERE p.id = rule1.id;

-- Rule 2 — trimmed, case-insensitive Account.name / Account.code match;
-- asset leaf only (type = asset AND isGroup = false). Code matches win over
-- name matches when both exist; account code then breaks any remaining tie.
WITH candidates AS (
  SELECT
    p.id,
    a.id AS account_id,
    ROW_NUMBER() OVER (
      PARTITION BY p.id
      ORDER BY
        (lower(btrim(a.code)) = lower(btrim(p.account))) DESC,
        a.code ASC
    ) AS rn
  FROM "Payment" p
  JOIN "Account" a
    ON a.type = 'asset'
   AND a."isGroup" = false
   AND (
     lower(btrim(a.name)) = lower(btrim(p.account))
     OR lower(btrim(a.code)) = lower(btrim(p.account))
   )
  WHERE p."accountId" IS NULL
    AND p.account IS NOT NULL
    AND btrim(p.account) <> ''
)
UPDATE "Payment" p
SET "accountId" = candidates.account_id
FROM candidates
WHERE p.id = candidates.id
  AND candidates.rn = 1;
