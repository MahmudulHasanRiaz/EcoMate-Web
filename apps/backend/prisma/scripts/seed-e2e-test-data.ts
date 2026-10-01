import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecomate_web';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('[E2E Seed] Starting E2E test data seeding...');

  // 1. Fetch main showroom warehouse
  const warehouse = await prisma.warehouse.findFirst({
    where: { slug: 'main-showroom' },
  });
  if (!warehouse) {
    throw new Error('Default showroom not found! Run npm run seed first.');
  }

  // 2. Clean up existing data to ensure idempotency
  await prisma.comboItem.deleteMany({
    where: { combo: { slug: 'e2e-combo-product' } },
  });
  await prisma.combo.deleteMany({
    where: { slug: 'e2e-combo-product' },
  });
  await prisma.physicalInventory.deleteMany({
    where: {
      product: {
        slug: { in: ['e2e-simple-product', 'e2e-ic-simple-product', 'e2e-variable-product', 'e2e-godown-only-variable-product'] },
      },
    },
  });
  await prisma.productVariant.deleteMany({
    where: {
      product: { slug: 'e2e-variable-product' },
    },
  });
  await prisma.product.deleteMany({
    where: {
      slug: { in: ['e2e-simple-product', 'e2e-ic-simple-product', 'e2e-variable-product', 'e2e-godown-only-variable-product'] },
    },
  });

  // The cross-warehouse fixture's godown is created by this script, so clean it
  // up too and keep re-runs idempotent.
  await prisma.warehouse.deleteMany({
    where: { slug: 'main-godown' },
  });

  console.log('[E2E Seed] Cleaned up existing E2E test products.');

  // 3. Create E2E Simple Product (MANAGED_STOCK, manageStock: true)
  const simpleProduct = await prisma.product.create({
    data: {
      name: 'E2E Simple Product',
      slug: 'e2e-simple-product',
      type: 'simple',
      basePrice: 100,
      sku: 'E2E-SMP-001',
      availabilityMode: 'MANAGED_STOCK',
      manageStock: true,
      managedStockQuantity: 100,
      isActive: true,
      warehouseId: warehouse.id,
    },
  });
  // Physical Inventory: 50
  await prisma.physicalInventory.create({
    data: {
      productId: simpleProduct.id,
      warehouseId: warehouse.id,
      quantity: 50,
      reservedQuantity: 0,
    },
  });
  console.log(`[E2E Seed] Created Simple Product: ${simpleProduct.name}`);

  // 4. Create E2E IC Simple Product (INVENTORY_CONTROLLED)
  const icSimpleProduct = await prisma.product.create({
    data: {
      name: 'E2E IC Simple Product',
      slug: 'e2e-ic-simple-product',
      type: 'simple',
      basePrice: 150,
      sku: 'E2E-IC-001',
      availabilityMode: 'INVENTORY_CONTROLLED',
      manageStock: false,
      managedStockQuantity: 0,
      isActive: true,
      warehouseId: warehouse.id,
    },
  });
  // Physical Inventory: 30
  await prisma.physicalInventory.create({
    data: {
      productId: icSimpleProduct.id,
      warehouseId: warehouse.id,
      quantity: 30,
      reservedQuantity: 0,
    },
  });
  console.log(`[E2E Seed] Created IC Simple Product: ${icSimpleProduct.name}`);

  // 5. Create E2E Variable Product
  const variableProduct = await prisma.product.create({
    data: {
      name: 'E2E Variable Product',
      slug: 'e2e-variable-product',
      type: 'variable',
      basePrice: 200,
      availabilityMode: 'MANAGED_STOCK',
      manageStock: true,
      isActive: true,
      warehouseId: warehouse.id,
    },
  });

  // Create variants: A, B, C
  const variantA = await prisma.productVariant.create({
    data: {
      productId: variableProduct.id,
      sku: 'E2E-VAR-A',
      price: 200,
      managedStockQuantity: 50,
      isActive: true,
      warehouseId: warehouse.id,
    },
  });
  await prisma.physicalInventory.create({
    data: {
      productId: variableProduct.id,
      variantId: variantA.id,
      warehouseId: warehouse.id,
      quantity: 20,
      reservedQuantity: 0,
    },
  });

  const variantB = await prisma.productVariant.create({
    data: {
      productId: variableProduct.id,
      sku: 'E2E-VAR-B',
      price: 220,
      managedStockQuantity: 40,
      isActive: true,
      warehouseId: warehouse.id,
    },
  });
  // Physical Inventory: 0 for Variant B
  await prisma.physicalInventory.create({
    data: {
      productId: variableProduct.id,
      variantId: variantB.id,
      warehouseId: warehouse.id,
      quantity: 0,
      reservedQuantity: 0,
    },
  });

  const variantC = await prisma.productVariant.create({
    data: {
      productId: variableProduct.id,
      sku: 'E2E-VAR-C',
      price: 240,
      managedStockQuantity: 30,
      isActive: true,
      warehouseId: warehouse.id,
    },
  });
  await prisma.physicalInventory.create({
    data: {
      productId: variableProduct.id,
      variantId: variantC.id,
      warehouseId: warehouse.id,
      quantity: 15,
      reservedQuantity: 0,
    },
  });
  console.log(`[E2E Seed] Created Variable Product with variants A, B, C`);

  // 5b. Cross-warehouse sibling-variant fixture.
  //
  // Reproduces the production shape behind the 2026-10-01 "See where" incident:
  // a variable product with NO stock in the showroom, while the godown holds it
  // under a variant the showroom has never stocked. The alternative-location
  // lookup used to filter on the exact variantId, so it returned nothing and
  // the UI claimed no location had stock.
  //
  // This needs its OWN product: attaching the godown-only variant to the
  // product above would not reproduce it, because that product already has
  // showroom stock on other variants and so is not showroom-zero at the
  // product level.
  //
  // Local development previously had every variant stocked in the showroom, so
  // this shape never occurred and the bug could not be reproduced. Keeping this
  // fixture means the regression is caught by the test suite rather than on a
  // production site.
  const godown = await prisma.warehouse.upsert({
    where: { slug: 'main-godown' },
    update: {},
    create: {
      name: 'Main Godown',
      slug: 'main-godown',
      type: 'main',
      isActive: true,
    },
  });

  const godownOnlyProduct = await prisma.product.create({
    data: {
      name: 'E2E Godown-Only Variable Product',
      slug: 'e2e-godown-only-variable-product',
      type: 'variable',
      basePrice: 300,
      availabilityMode: 'MANAGED_STOCK',
      manageStock: true,
      isActive: true,
      warehouseId: godown.id,
    },
  });
  const godownOnlyVariant = await prisma.productVariant.create({
    data: {
      productId: godownOnlyProduct.id,
      sku: 'E2E-VAR-GODOWN-ONLY',
      price: 300,
      managedStockQuantity: 60,
      isActive: true,
      warehouseId: godown.id,
    },
  });
  await prisma.physicalInventory.create({
    data: {
      productId: godownOnlyProduct.id,
      variantId: godownOnlyVariant.id,
      warehouseId: godown.id,
      quantity: 35,
      reservedQuantity: 0,
    },
  });
  // Deliberately NO showroom row for this product at all: that absence is what
  // made the old exact-variant filter return an empty network.
  console.log(
    `[E2E Seed] Cross-warehouse fixture: "E2E Godown-Only Variable Product" has NO showroom stock, 35 in ${godown.name}`,
  );

  // 6. Create Combo Product
  const combo = await prisma.combo.create({
    data: {
      name: 'E2E Combo Product',
      slug: 'e2e-combo-product',
      basePrice: 500,
      isActive: true,
      warehouseId: warehouse.id,
    },
  });

  // Combo items:
  // Component 1: simple product (qty: 2)
  await prisma.comboItem.create({
    data: {
      comboId: combo.id,
      productId: simpleProduct.id,
      quantity: 2,
    },
  });

  // Component 2: variable product variant A (qty: 1, fixed variant)
  await prisma.comboItem.create({
    data: {
      comboId: combo.id,
      productId: variableProduct.id,
      variantId: variantA.id,
      quantity: 1,
    },
  });

  // Component 3: variable product selected variant (qty: 1, customer selected)
  await prisma.comboItem.create({
    data: {
      comboId: combo.id,
      productId: variableProduct.id,
      variantId: null,
      quantity: 1,
    },
  });

  // Component 4: IC simple product (qty: 1, mixed mode child)
  await prisma.comboItem.create({
    data: {
      comboId: combo.id,
      productId: icSimpleProduct.id,
      quantity: 1,
    },
  });

  console.log(`[E2E Seed] Created Combo Product and added items.`);
  console.log('[E2E Seed] Seeding completed successfully!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
