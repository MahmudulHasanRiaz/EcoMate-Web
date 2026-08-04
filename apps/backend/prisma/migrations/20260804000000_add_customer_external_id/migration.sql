-- AlterTable
ALTER TABLE "CustomerProfile" ADD COLUMN "externalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProfile_externalId_key" ON "CustomerProfile"("externalId");
