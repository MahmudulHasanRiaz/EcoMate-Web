import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const productCount = await prisma.product.count();
  const activeCount = await prisma.product.count({ where: { isActive: true } });
  const variantCount = await prisma.productVariant.count();

  console.log(`Total Products: ${productCount}`);
  console.log(`Active Products: ${activeCount}`);
  console.log(`Total Variants: ${variantCount}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
