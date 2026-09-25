-- CreateEnum
CREATE TYPE "StoreAssignmentSource" AS ENUM ('MANUAL', 'RULE');

-- CreateEnum
CREATE TYPE "FieldOwnership" AS ENUM ('ECOMATE', 'EXTERNAL', 'CONFLICT');

-- CreateEnum
CREATE TYPE "OwnershipEvidence" AS ENUM ('PLUGIN', 'INFERRED');

-- CreateTable
CREATE TABLE "ProductStoreAssignment" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "source" "StoreAssignmentSource" NOT NULL DEFAULT 'MANUAL',
    "available" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductStoreAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreAvailabilityRule" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "inheritFromParent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreAvailabilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductStoreFieldState" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "ownership" "FieldOwnership" NOT NULL DEFAULT 'ECOMATE',
    "baselineHash" TEXT,
    "externalHash" TEXT,
    "ecoMateHashAtRebase" TEXT,
    "evidence" "OwnershipEvidence",
    "lastPushedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductStoreFieldState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductStoreAssignment_productId_idx" ON "ProductStoreAssignment"("productId");

-- CreateIndex
CREATE INDEX "ProductStoreAssignment_storeId_idx" ON "ProductStoreAssignment"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductStoreAssignment_storeId_productId_key" ON "ProductStoreAssignment"("storeId", "productId");

-- CreateIndex
CREATE INDEX "StoreAvailabilityRule_storeId_idx" ON "StoreAvailabilityRule"("storeId");

-- CreateIndex
CREATE INDEX "StoreAvailabilityRule_categoryId_idx" ON "StoreAvailabilityRule"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreAvailabilityRule_storeId_categoryId_key" ON "StoreAvailabilityRule"("storeId", "categoryId");

-- CreateIndex
CREATE INDEX "ProductStoreFieldState_storeId_productId_idx" ON "ProductStoreFieldState"("storeId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductStoreFieldState_storeId_productId_field_key" ON "ProductStoreFieldState"("storeId", "productId", "field");

-- AddForeignKey
ALTER TABLE "ProductStoreAssignment" ADD CONSTRAINT "ProductStoreAssignment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStoreAssignment" ADD CONSTRAINT "ProductStoreAssignment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreAvailabilityRule" ADD CONSTRAINT "StoreAvailabilityRule_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreAvailabilityRule" ADD CONSTRAINT "StoreAvailabilityRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStoreFieldState" ADD CONSTRAINT "ProductStoreFieldState_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStoreFieldState" ADD CONSTRAINT "ProductStoreFieldState_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

