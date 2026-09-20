-- AlterTable: Add order-time customer snapshot fields to Order table.
-- These fields capture customer data at order creation time and are NEVER
-- mutated after order creation. They provide immutable order-time customer
-- identity for Purchase tracking events, independent of later CustomerProfile
-- mutations.

ALTER TABLE "Order" ADD COLUMN "customerEmail" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerPhone" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerFirstName" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerLastName" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerCity" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerState" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerZip" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerCountry" TEXT DEFAULT 'BD';
