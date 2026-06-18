-- AlterTable
ALTER TABLE "User" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lockoutUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Order_guestPhone_idx" ON "Order"("guestPhone");
