const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

async function main() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecomate_web';
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  
  const productCount = await prisma.product.count();
  const categoryCount = await prisma.category.count();
  const tagCount = await prisma.tag.count();
  const variantCount = await prisma.productVariant.count();
  
  console.log("STATS:", {
    productCount,
    categoryCount,
    tagCount,
    variantCount
  });
  
  const someProducts = await prisma.product.findMany({ take: 5, select: { name: true, sku: true, slug: true } });
  console.log("SOME PRODUCTS:", someProducts);
}
main().catch(console.error).finally(() => process.exit());
