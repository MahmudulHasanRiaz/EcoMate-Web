-- Preset supremacy (owner rule 2026-10-24): custom removals live beside the
-- existing custom additions (override_permissions). DDL only.
ALTER TABLE "better_auth_users" ADD COLUMN "denied_permissions" TEXT[] NOT NULL DEFAULT '{}';
