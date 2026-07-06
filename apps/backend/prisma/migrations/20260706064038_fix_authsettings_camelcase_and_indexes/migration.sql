/*
  Warnings:

  - You are about to drop the `AuthSettings` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "AuthSettings";

-- CreateTable
CREATE TABLE "auth_settings" (
    "id" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_settings_providerName_key" ON "auth_settings"("providerName");

-- CreateIndex
CREATE INDEX "Address_customerProfileId_idx" ON "Address"("customerProfileId");

-- CreateIndex
CREATE INDEX "CustomerProfile_email_idx" ON "CustomerProfile"("email");

-- CreateIndex
CREATE INDEX "Employee_accessPresetId_idx" ON "Employee"("accessPresetId");
