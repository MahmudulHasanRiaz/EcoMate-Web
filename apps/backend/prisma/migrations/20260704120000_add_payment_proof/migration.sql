-- AlterTable: add paymentProof column to Order
ALTER TABLE "Order" ADD COLUMN "paymentProof" JSONB DEFAULT '{}';
