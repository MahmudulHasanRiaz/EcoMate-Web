-- AlterTable
ALTER TABLE "HeldCart" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "PackingLock" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "packerId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "PackingLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PackingLock_orderId_key" ON "PackingLock"("orderId");

-- CreateIndex
CREATE INDEX "PackingLock_packerId_idx" ON "PackingLock"("packerId");

-- AddForeignKey
ALTER TABLE "PackingLock" ADD CONSTRAINT "PackingLock_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingLock" ADD CONSTRAINT "PackingLock_packerId_fkey" FOREIGN KEY ("packerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "OrderStatus" ("id", "name", "color", "isInitial", "isFinal", "sortOrder", "createdAt")
SELECT gen_random_uuid(), 'Packed', '#059669', false, false, 3, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Packed');

INSERT INTO "OrderStatus" ("id", "name", "color", "isInitial", "isFinal", "sortOrder", "createdAt")
SELECT gen_random_uuid(), 'Packing Hold', '#D97706', false, false, 4, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Packing Hold');
