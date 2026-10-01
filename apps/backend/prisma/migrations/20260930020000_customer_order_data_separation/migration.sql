-- CreateEnum
CREATE TYPE "CustomerAddressType" AS ENUM ('SHIPPING', 'BILLING');

-- AlterTable
ALTER TABLE "CustomerProfile" ADD COLUMN     "lastOrderAt" TIMESTAMP(3),
ADD COLUMN     "lastOrderIp" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "billingAddress" JSONB DEFAULT '{}';

-- AlterTable
ALTER TABLE "TrackingDispatch" ADD COLUMN     "payloadSnapshot" JSONB;

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" TEXT NOT NULL,
    "customerProfileId" TEXT NOT NULL,
    "type" "CustomerAddressType" NOT NULL DEFAULT 'SHIPPING',
    "label" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "area" TEXT,
    "thana" TEXT,
    "district" TEXT,
    "division" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Bangladesh',
    "normalizedHash" TEXT,
    "sourceOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerAddress_customerProfileId_type_idx" ON "CustomerAddress"("customerProfileId", "type");

-- CreateIndex
CREATE INDEX "CustomerAddress_customerProfileId_isDefault_idx" ON "CustomerAddress"("customerProfileId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAddress_customerProfileId_type_normalizedHash_key" ON "CustomerAddress"("customerProfileId", "type", "normalizedHash");

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
