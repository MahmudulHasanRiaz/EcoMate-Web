-- Per-gateway tri-state overrides for the two global payment settings
-- (payments.staffAutoVerified / payments.editAllowed SystemSetting keys).
-- NULL = "use global default" (the default state — behavior unchanged for
-- every existing gateway); true/false = explicit override.
ALTER TABLE "PaymentGateway" ADD COLUMN "staffAutoVerifiedOverride" BOOLEAN;
ALTER TABLE "PaymentGateway" ADD COLUMN "editAllowedOverride" BOOLEAN;
