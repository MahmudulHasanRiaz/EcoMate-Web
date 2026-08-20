-- CreateTable
CREATE TABLE "MarketingDailyProductCost" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spend" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "revenue" DECIMAL(14,2),
    "cost" DECIMAL(14,2),
    "profit" DECIMAL(14,2),
    "orders" INTEGER NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingDailyProductCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingDailyProductCost_date_idx" ON "MarketingDailyProductCost"("date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingDailyProductCost_productId_date_key" ON "MarketingDailyProductCost"("productId", "date");

-- AddForeignKey
ALTER TABLE "MarketingDailyProductCost" ADD CONSTRAINT "MarketingDailyProductCost_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;