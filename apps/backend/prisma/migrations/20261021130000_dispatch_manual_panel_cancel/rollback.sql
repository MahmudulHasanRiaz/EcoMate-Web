ALTER TABLE "Dispatch" DROP COLUMN "panelCancelConfirmedBy";
ALTER TABLE "Dispatch" DROP COLUMN "panelCancelConfirmedAt";
ALTER TABLE "Dispatch" DROP COLUMN "courierCancelMode";
DROP TYPE "CourierCancelMode";
