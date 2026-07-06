-- AlterTable
ALTER TABLE "User" ADD COLUMN "betterAuthUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_betterAuthUserId_key" ON "User"("betterAuthUserId");
