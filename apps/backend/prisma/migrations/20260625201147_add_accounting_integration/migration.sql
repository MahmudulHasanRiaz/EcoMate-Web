-- DDL moved to catchup_to_current (20260625203000) where referenced tables exist
-- Keep only safe seeds for tables created in 0000_initial
INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
SELECT 'accounting_enabled', 'false', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "SystemSetting" WHERE "key" = 'accounting_enabled');
