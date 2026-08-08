-- CreateTable
CREATE TABLE "OrderEditLock" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderEditLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderEditLock_orderId_key" ON "OrderEditLock"("orderId");

-- CreateIndex
CREATE INDEX "OrderEditLock_userId_idx" ON "OrderEditLock"("userId");

-- CreateIndex
CREATE INDEX "OrderEditLock_expiresAt_idx" ON "OrderEditLock"("expiresAt");

-- AddForeignKey
ALTER TABLE "OrderEditLock" ADD CONSTRAINT "OrderEditLock_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEditLock" ADD CONSTRAINT "OrderEditLock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
