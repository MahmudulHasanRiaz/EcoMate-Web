-- D19: advanced (automatic, Shopify-style) discounts. DDL only; every new
-- column is nullable or carries a default, so existing rows keep today's
-- behavior exactly (no automatic discount applies until one is created).
CREATE TABLE "Discount" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'SITEWIDE',
    "categoryIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "productIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "type" TEXT NOT NULL DEFAULT 'percentage',
    "value" DECIMAL(10,2) NOT NULL,
    "minOrderAmount" DECIMAL(10,2),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Discount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscountApplication" (
    "id" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountApplication_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DiscountApplication_discountId_idx" ON "DiscountApplication"("discountId");
CREATE INDEX "DiscountApplication_orderId_idx" ON "DiscountApplication"("orderId");

ALTER TABLE "DiscountApplication" ADD CONSTRAINT "DiscountApplication_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "Discount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscountApplication" ADD CONSTRAINT "DiscountApplication_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Order" ADD COLUMN "autoDiscount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "autoDiscountBreakdown" JSONB;
