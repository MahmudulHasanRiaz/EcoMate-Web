-- AlterTable
ALTER TABLE "ManagedStockLedger" ADD COLUMN "reservedBefore" INTEGER;
ALTER TABLE "ManagedStockLedger" ADD COLUMN "reservedAfter" INTEGER;

-- AlterTable
ALTER TABLE "PhysicalInventoryLedger" ADD COLUMN "reservedBefore" INTEGER;
ALTER TABLE "PhysicalInventoryLedger" ADD COLUMN "reservedAfter" INTEGER;
