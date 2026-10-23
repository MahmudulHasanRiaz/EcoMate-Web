-- D6 (owner-locked 2026-10-23): per-surface gateway visibility + gateway
-- logo + system-account protection. DDL only; every new column is nullable
-- or carries a default, so existing rows keep today's behavior exactly
-- (all surfaces visible, no logo, no system accounts).
ALTER TABLE "PaymentGateway" ADD COLUMN "showOnStorefront" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PaymentGateway" ADD COLUMN "showOnAdmin" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PaymentGateway" ADD COLUMN "showOnPos" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PaymentGateway" ADD COLUMN "logoUrl" TEXT;
ALTER TABLE "Account" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;
