import { PrismaClient, UserRole, UserStatus, PaymentOptionType, PaymentStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname } from 'path';
import { v4 as uuid } from 'uuid';
import { createHash } from 'crypto';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

const MIME_EXT_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
};

async function main() {
  const seedDummyData = process.env.SEED_DUMMY_DATA !== 'false';
  console.log(`Seeding database... (Dummy Data: ${seedDummyData})`);

  // ── Super Admin ──
  const adminPassword = await bcrypt.hash('Admin@123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@ecomate.com' },
    update: {},
    create: {
      firstName: 'Super',
      lastName: 'Admin',
      username: 'superadmin',
      email: 'admin@ecomate.com',
      phoneNumber: '+8801700000000',
      password: adminPassword,
      role: UserRole.superadmin,
      status: UserStatus.active,
    },
  });
  console.log(`  ✓ Super admin created: admin@ecomate.com / Admin@123`);

  let customer: any = null;
  if (seedDummyData) {
    // ── Customer User ──
  const customerPassword = await bcrypt.hash('Customer@123', 12);
  const customer = await prisma.user.upsert({
    where: { email: 'customer@example.com' },
    update: {},
    create: {
      firstName: 'Md.',
      lastName: 'Rahim',
      username: 'rahim_customer',
      email: 'customer@example.com',
      phoneNumber: '+8801711111111',
      password: customerPassword,
      role: UserRole.customer,
      status: UserStatus.active,
    },
  });
  console.log(`  ✓ Customer created: customer@example.com / Customer@123`);
  }

  // ── Order Statuses ──
  const statuses = [
    { name: 'Payment Pending', color: '#F59E0B', isInitial: true, isFinal: false, sortOrder: 0, nextStatuses: [] },
    { name: 'Pending', color: '#F59E0B', isInitial: false, isFinal: false, sortOrder: 1, nextStatuses: [] },
    { name: 'Confirmed', color: '#3B82F6', isInitial: false, isFinal: false, sortOrder: 2, nextStatuses: [] },
    { name: 'Processing', color: '#8B5CF6', isInitial: false, isFinal: false, sortOrder: 3, nextStatuses: [] },
    { name: 'Shipped', color: '#06B6D4', isInitial: false, isFinal: false, sortOrder: 4, nextStatuses: [] },
    { name: 'Delivered', color: '#10B981', isInitial: false, isFinal: true, sortOrder: 5, nextStatuses: [] },
    { name: 'Cancelled', color: '#EF4444', isInitial: false, isFinal: true, sortOrder: 6, nextStatuses: [] },
    { name: 'Refunded', color: '#EC4899', isInitial: false, isFinal: true, sortOrder: 7, nextStatuses: [] },
    { name: 'Returned', color: '#DC2626', isInitial: false, isFinal: true, sortOrder: 8, nextStatuses: [] },
    { name: 'Return Pending', color: '#EC4899', isInitial: false, isFinal: false, sortOrder: 9, nextStatuses: [] },
    { name: 'Damaged', color: '#991B1B', isInitial: false, isFinal: true, sortOrder: 10, nextStatuses: [] },
  ];

  const orderStatusMap: Record<string, string> = {};
  for (const s of statuses) {
    const status = await prisma.orderStatus.upsert({
      where: { name: s.name },
      update: {},
      create: { ...s, nextStatuses: [] },
    });
    orderStatusMap[s.name] = status.id;
  }

  // Define allowed transitions
  const transitions: Record<string, string[]> = {
    'Payment Pending': ['Pending', 'Confirmed', 'Cancelled'],
    'Pending': ['Confirmed', 'Cancelled'],
    'Confirmed': ['Processing', 'Cancelled'],
    'Processing': ['Shipped', 'Cancelled'],
    'Shipped': ['Delivered', 'Return Pending', 'Damaged'],
    'Delivered': [],
    'Cancelled': [],
    'Refunded': [],
    'Returned': [],
    'Return Pending': ['Returned', 'Refunded'],
    'Damaged': [],
  };

  for (const [name, nextNames] of Object.entries(transitions)) {
    const ids = nextNames.map((n) => orderStatusMap[n]).filter(Boolean);
    await prisma.orderStatus.update({
      where: { name },
      data: { nextStatuses: ids as any },
    });
  }
  console.log(`  ✓ ${statuses.length} order statuses created`);

  if (seedDummyData) {
    // ── Categories ──
  const categoryData = [
    { name: 'Fruits & Vegetables', slug: 'fruits-vegetables', sortOrder: 1, isActive: true },
    { name: 'Dairy & Eggs', slug: 'dairy-eggs', sortOrder: 2, isActive: true },
    { name: 'Meat & Fish', slug: 'meat-fish', sortOrder: 3, isActive: true },
    { name: 'Beverages', slug: 'beverages', sortOrder: 4, isActive: true },
    { name: 'Snacks & Bakery', slug: 'snacks-bakery', sortOrder: 5, isActive: true },
    { name: 'Household', slug: 'household', sortOrder: 6, isActive: true },
    { name: 'Personal Care', slug: 'personal-care', sortOrder: 7, isActive: true },
    { name: 'Baby Products', slug: 'baby-products', sortOrder: 8, isActive: true },
  ];

  const categoryMap: Record<string, string> = {};
  for (const c of categoryData) {
    const cat = await prisma.category.upsert({
      where: { slug: c.slug },
      update: {},
      create: c,
    });
    categoryMap[c.name] = cat.id;
  }
  console.log(`  ✓ ${categoryData.length} categories created`);

  // ── Attributes ──
  const weightAttr = await prisma.attribute.upsert({
    where: { name: 'Weight' },
    update: {},
    create: {
      name: 'Weight',
      values: {
        create: [
          { value: '500g', sortOrder: 1 },
          { value: '1kg', sortOrder: 2 },
          { value: '2kg', sortOrder: 3 },
          { value: '5kg', sortOrder: 4 },
        ],
      },
    },
    include: { values: true },
  });

  const sizeAttr = await prisma.attribute.upsert({
    where: { name: 'Size' },
    update: {},
    create: {
      name: 'Size',
      values: {
        create: [
          { value: 'Small', sortOrder: 1 },
          { value: 'Medium', sortOrder: 2 },
          { value: 'Large', sortOrder: 3 },
        ],
      },
    },
    include: { values: true },
  });

  const volumeAttr = await prisma.attribute.upsert({
    where: { name: 'Volume' },
    update: {},
    create: {
      name: 'Volume',
      values: {
        create: [
          { value: '250ml', sortOrder: 1 },
          { value: '500ml', sortOrder: 2 },
          { value: '1L', sortOrder: 3 },
          { value: '2L', sortOrder: 4 },
        ],
      },
    },
    include: { values: true },
  });
  console.log('  ✓ Attributes created');

  const weightValues = weightAttr.values.reduce((acc, v) => ({ ...acc, [v.value]: v.id }), {} as Record<string, string>);
  const sizeValues = sizeAttr.values.reduce((acc, v) => ({ ...acc, [v.value]: v.id }), {} as Record<string, string>);
  const volumeValues = volumeAttr.values.reduce((acc, v) => ({ ...acc, [v.value]: v.id }), {} as Record<string, string>);

  // ── Products ──
  const productsData = [
    {
      name: 'Fresh Broccoli',
      slug: 'fresh-broccoli',
      category: 'Fruits & Vegetables',
      basePrice: 120,
      salePrice: 99,
      stock: 50,
      lowStockQty: 10,
      manageStock: true,
      description: 'Fresh green broccoli, rich in vitamins and fiber. Perfect for salads and stir-fry.',
      shortDesc: 'Fresh green broccoli, 500g',
      sku: 'FV-BROC-001',
      images: ['https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=400'],
      tags: ['vegetable', 'green', 'fresh'],
      isFeatured: true,
      isActive: true,
      variants: [
        { sku: 'FV-BROC-500', price: 99, stock: 30, image: null, attrKey: 'Weight', attrValue: '500g' },
        { sku: 'FV-BROC-1K', price: 180, stock: 20, image: null, attrKey: 'Weight', attrValue: '1kg' },
      ],
    },
    {
      name: 'Organic Tomatoes',
      slug: 'organic-tomatoes',
      category: 'Fruits & Vegetables',
      basePrice: 80,
      salePrice: 65,
      stock: 100,
      lowStockQty: 20,
      manageStock: true,
      description: 'Organic juicy tomatoes, grown without pesticides.',
      shortDesc: 'Organic tomatoes, 500g',
      sku: 'FV-TOM-001',
      images: ['https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=400'],
      tags: ['vegetable', 'organic', 'tomato'],
      isFeatured: true,
      isActive: true,
      variants: [
        { sku: 'FV-TOM-500', price: 65, stock: 60, image: null, attrKey: 'Weight', attrValue: '500g' },
        { sku: 'FV-TOM-1K', price: 120, stock: 40, image: null, attrKey: 'Weight', attrValue: '1kg' },
      ],
    },
    {
      name: 'Fresh Whole Milk',
      slug: 'fresh-whole-milk',
      category: 'Dairy & Eggs',
      basePrice: 130,
      salePrice: null,
      stock: 40,
      lowStockQty: 10,
      manageStock: true,
      description: 'Farm-fresh whole milk, pasteurized and creamy.',
      shortDesc: 'Fresh whole milk, 1L',
      sku: 'DE-MLK-001',
      images: ['https://images.unsplash.com/photo-1563636619-e9143da7973b?w=400'],
      tags: ['dairy', 'milk', 'fresh'],
      isFeatured: false,
      isActive: true,
      variants: [
        { sku: 'DE-MLK-500', price: 75, stock: 20, image: null, attrKey: 'Volume', attrValue: '500ml' },
        { sku: 'DE-MLK-1L', price: 130, stock: 20, image: null, attrKey: 'Volume', attrValue: '1L' },
      ],
    },
    {
      name: 'Free Range Eggs (12 pcs)',
      slug: 'free-range-eggs',
      category: 'Dairy & Eggs',
      basePrice: 150,
      salePrice: 135,
      stock: 80,
      lowStockQty: 15,
      manageStock: true,
      description: 'Free-range chicken eggs from local farms.',
      shortDesc: '12 free-range eggs per tray',
      sku: 'DE-EGG-012',
      images: ['https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=400'],
      tags: ['eggs', 'protein', 'dairy'],
      isFeatured: true,
      isActive: true,
      variants: [],
    },
    {
      name: 'Chicken Breast Boneless',
      slug: 'chicken-breast-boneless',
      category: 'Meat & Fish',
      basePrice: 350,
      salePrice: 320,
      stock: 30,
      lowStockQty: 5,
      manageStock: true,
      description: 'Fresh boneless chicken breast, skinless. High protein, low fat.',
      shortDesc: 'Boneless chicken breast per kg',
      sku: 'MF-CHK-001',
      images: ['https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=400'],
      tags: ['chicken', 'meat', 'protein'],
      isFeatured: true,
      isActive: true,
      variants: [
        { sku: 'MF-CHK-500', price: 180, stock: 15, image: null, attrKey: 'Weight', attrValue: '500g' },
        { sku: 'MF-CHK-1K', price: 320, stock: 15, image: null, attrKey: 'Weight', attrValue: '1kg' },
      ],
    },
    {
      name: 'Rui Fish (Whole)',
      slug: 'rui-fish-whole',
      category: 'Meat & Fish',
      basePrice: 280,
      salePrice: 250,
      stock: 20,
      lowStockQty: 5,
      manageStock: true,
      description: 'Fresh Rui fish, cleaned and ready to cook.',
      shortDesc: 'Fresh Rui fish per kg',
      sku: 'MF-RUI-001',
      images: ['https://images.unsplash.com/photo-1615141982883-c7ad0e69fd62?w=400'],
      tags: ['fish', 'freshwater'],
      isFeatured: false,
      isActive: true,
      variants: [],
    },
    {
      name: 'Mineral Water',
      slug: 'mineral-water',
      category: 'Beverages',
      basePrice: 25,
      salePrice: 20,
      stock: 200,
      lowStockQty: 50,
      manageStock: true,
      description: 'Pure mineral drinking water.',
      shortDesc: 'Mineral water 500ml bottle',
      sku: 'BEV-WTR-001',
      images: ['https://images.unsplash.com/photo-1560023907-5f3395ea0d7c?w=400'],
      tags: ['water', 'beverage'],
      isFeatured: false,
      isActive: true,
      variants: [
        { sku: 'BEV-WTR-500', price: 20, stock: 150, image: null, attrKey: 'Volume', attrValue: '500ml' },
        { sku: 'BEV-WTR-2L', price: 45, stock: 50, image: null, attrKey: 'Volume', attrValue: '2L' },
      ],
    },
    {
      name: 'Orange Juice (Pack of 6)',
      slug: 'orange-juice-pack',
      category: 'Beverages',
      basePrice: 240,
      salePrice: 210,
      stock: 40,
      lowStockQty: 10,
      manageStock: true,
      description: 'Freshly squeezed orange juice, no added sugar. Pack of 6 bottles.',
      shortDesc: 'Orange juice 250ml x 6 pack',
      sku: 'BEV-OJ-006',
      images: ['https://images.unsplash.com/photo-1613478223719-2ab802602423?w=400'],
      tags: ['juice', 'orange', 'beverage'],
      isFeatured: true,
      isActive: true,
      variants: [],
    },
    {
      name: 'Potato Chips (Classic Salted)',
      slug: 'potato-chips-classic',
      category: 'Snacks & Bakery',
      basePrice: 60,
      salePrice: 50,
      stock: 100,
      lowStockQty: 20,
      manageStock: true,
      description: 'Crispy potato chips with classic salted flavor.',
      shortDesc: 'Classic salted chips, 100g',
      sku: 'SNK-CHP-001',
      images: ['https://images.unsplash.com/photo-1566478989037-eec170784d8b?w=400'],
      tags: ['chips', 'snack', 'salted'],
      isFeatured: false,
      isActive: true,
      variants: [],
    },
    {
      name: 'Mixed Nuts (Roasted)',
      slug: 'mixed-nuts-roasted',
      category: 'Snacks & Bakery',
      basePrice: 450,
      salePrice: 399,
      stock: 25,
      lowStockQty: 5,
      manageStock: true,
      description: 'Premium roasted mixed nuts - almonds, cashews, walnuts, peanuts.',
      shortDesc: 'Roasted mixed nuts, 500g',
      sku: 'SNK-NUT-001',
      images: ['https://images.unsplash.com/photo-1604068549290-dea0e4a305ca?w=400'],
      tags: ['nuts', 'healthy', 'snack'],
      isFeatured: true,
      isActive: true,
      variants: [],
    },
    {
      name: 'Dishwashing Liquid (Lemon)',
      slug: 'dishwashing-liquid-lemon',
      category: 'Household',
      basePrice: 180,
      salePrice: 160,
      stock: 60,
      lowStockQty: 10,
      manageStock: true,
      description: 'Powerful dishwashing liquid with lemon freshness.',
      shortDesc: 'Dishwashing liquid, 500ml',
      sku: 'HH-DWL-001',
      images: ['https://images.unsplash.com/photo-1625860690297-47fe65483b42?w=400'],
      tags: ['cleaning', 'household'],
      isFeatured: false,
      isActive: true,
      variants: [
        { sku: 'HH-DWL-500', price: 160, stock: 40, image: null, attrKey: 'Volume', attrValue: '500ml' },
        { sku: 'HH-DWL-1L', price: 280, stock: 20, image: null, attrKey: 'Volume', attrValue: '1L' },
      ],
    },
    {
      name: 'Toilet Paper (12 rolls)',
      slug: 'toilet-paper-12rolls',
      category: 'Household',
      basePrice: 320,
      salePrice: 290,
      stock: 40,
      lowStockQty: 10,
      manageStock: true,
      description: 'Soft, strong, 3-ply toilet paper. 12 rolls per pack.',
      shortDesc: '3-ply toilet paper, 12 rolls',
      sku: 'HH-TP-012',
      images: ['https://images.unsplash.com/photo-1616627562147-68ba7d68659f?w=400'],
      tags: ['bathroom', 'essentials'],
      isFeatured: false,
      isActive: true,
      variants: [],
    },
    {
      name: 'Shampoo (Anti-Dandruff)',
      slug: 'shampoo-anti-dandruff',
      category: 'Personal Care',
      basePrice: 380,
      salePrice: 350,
      stock: 35,
      lowStockQty: 8,
      manageStock: true,
      description: 'Anti-dandruff shampoo with tea tree oil. Suitable for all hair types.',
      shortDesc: 'Anti-dandruff shampoo, 400ml',
      sku: 'PC-SHP-001',
      images: ['https://images.unsplash.com/photo-1559559241-44c2b0e96d3f?w=400'],
      tags: ['shampoo', 'hair', 'personal care'],
      isFeatured: false,
      isActive: true,
      variants: [
        { sku: 'PC-SHP-200', price: 200, stock: 20, image: null, attrKey: 'Volume', attrValue: '250ml' },
        { sku: 'PC-SHP-400', price: 350, stock: 15, image: null, attrKey: 'Volume', attrValue: '500ml' },
      ],
    },
    {
      name: 'Hand Sanitizer',
      slug: 'hand-sanitizer',
      category: 'Personal Care',
      basePrice: 90,
      salePrice: 75,
      stock: 150,
      lowStockQty: 30,
      manageStock: true,
      description: 'Alcohol-based hand sanitizer (70%). Kills 99.9% germs.',
      shortDesc: 'Hand sanitizer, 100ml',
      sku: 'PC-HS-001',
      images: ['https://images.unsplash.com/photo-1603219965291-8d6e52763f50?w=400'],
      tags: ['sanitizer', 'hygiene'],
      isFeatured: false,
      isActive: true,
      variants: [],
    },
    {
      name: 'Baby Diapers (Size M, 30 pcs)',
      slug: 'baby-diapers-size-m',
      category: 'Baby Products',
      basePrice: 520,
      salePrice: 490,
      stock: 30,
      lowStockQty: 8,
      manageStock: true,
      description: 'Ultra-soft baby diapers, size Medium (6-10 kg). Pack of 30.',
      shortDesc: 'Baby diapers size M, 30 pcs',
      sku: 'BP-DPR-001',
      images: ['https://images.unsplash.com/photo-1575397004167-0e2e3bd973b5?w=400'],
      tags: ['baby', 'diapers'],
      isFeatured: false,
      isActive: true,
      variants: [
        { sku: 'BP-DPR-S', price: 420, stock: 15, image: null, attrKey: 'Size', attrValue: 'Small' },
        { sku: 'BP-DPR-M', price: 490, stock: 15, image: null, attrKey: 'Size', attrValue: 'Medium' },
      ],
    },
    {
      name: 'Baby Wipes (Pack of 3)',
      slug: 'baby-wipes-pack-3',
      category: 'Baby Products',
      basePrice: 280,
      salePrice: 250,
      stock: 45,
      lowStockQty: 10,
      manageStock: true,
      description: 'Gentle baby wipes, alcohol-free, hypoallergenic. 80 wipes per pack.',
      shortDesc: 'Baby wipes 80s x 3 packs',
      sku: 'BP-WPE-003',
      images: ['https://images.unsplash.com/photo-1584097079931-f0b1e1e557f2?w=400'],
      tags: ['baby', 'wipes'],
      isFeatured: false,
      isActive: true,
      variants: [],
    },
  ];

  interface VariantSeed {
    sku: string;
    price: number;
    stock: number;
    image: string | null;
    attrKey: string;
    attrValue: string;
  }

  const createdProductIds: string[] = [];

  for (const p of productsData) {
    const { variants, category, ...productData } = p;
    const catId = categoryMap[category];
    if (!catId) {
      console.warn(`  ⚠ Category not found for ${p.name}`);
      continue;
    }

    const product = await prisma.product.create({
      data: {
        ...productData,
        categoryId: catId,
        basePrice: productData.basePrice,
        salePrice: productData.salePrice ?? null,
        tags: productData.tags,
        images: productData.images,
      },
    });
    createdProductIds.push(product.id);

    for (const v of variants as VariantSeed[]) {
      const attrValMap = v.attrKey === 'Weight' ? weightValues : v.attrKey === 'Size' ? sizeValues : volumeValues;
      const attrValId = attrValMap[v.attrValue];
      if (!attrValId) {
        console.warn(`  ⚠ Attribute value not found for ${v.sku}`);
        continue;
      }

      const variant = await prisma.productVariant.create({
        data: {
          productId: product.id,
          sku: v.sku,
          price: v.price,
          stock: v.stock,
          image: v.image,
          isActive: true,
          attributeValues: {
            create: { attributeValueId: attrValId },
          },
        },
      });
    }
  }
  console.log(`  ✓ ${productsData.length} products created with variants`);

  // ── Combos ──
  const comboProducts = await prisma.product.findMany({ take: 6, include: { variants: { take: 1 } } });

  const combos = [
    {
      name: 'Healthy Breakfast Combo',
      slug: 'healthy-breakfast-combo',
      description: 'Start your day right with fresh milk, eggs, and orange juice.',
      shortDesc: 'Milk + Eggs + Orange Juice',
      basePrice: 520,
      salePrice: 470,
      image: null,
      stock: 15,
      manageStock: true,
      isFeatured: true,
      isActive: true,
      category: 'Dairy & Eggs',
      items: [
        { productName: 'Fresh Whole Milk', variantSku: 'DE-MLK-1L', quantity: 1 },
        { productName: 'Free Range Eggs (12 pcs)', variantSku: null, quantity: 1 },
        { productName: 'Orange Juice (Pack of 6)', variantSku: null, quantity: 1 },
      ],
    },
    {
      name: 'Salad Lover Pack',
      slug: 'salad-lover-pack',
      description: 'Everything you need for fresh salads all week.',
      shortDesc: 'Broccoli + Tomatoes + Mixed Nuts',
      basePrice: 729,
      salePrice: 650,
      image: null,
      stock: 10,
      manageStock: true,
      isFeatured: true,
      isActive: true,
      category: 'Fruits & Vegetables',
      items: [
        { productName: 'Fresh Broccoli', variantSku: 'FV-BROC-1K', quantity: 1 },
        { productName: 'Organic Tomatoes', variantSku: 'FV-TOM-1K', quantity: 1 },
        { productName: 'Mixed Nuts (Roasted)', variantSku: null, quantity: 1 },
      ],
    },
    {
      name: 'Family BBQ Bundle',
      slug: 'family-bbq-bundle',
      description: 'Perfect weekend BBQ pack for the whole family.',
      shortDesc: 'Chicken + Rui Fish + Mineral Water',
      basePrice: 645,
      salePrice: 580,
      image: null,
      stock: 8,
      manageStock: true,
      isFeatured: true,
      isActive: true,
      category: 'Meat & Fish',
      items: [
        { productName: 'Chicken Breast Boneless', variantSku: 'MF-CHK-1K', quantity: 1 },
        { productName: 'Rui Fish (Whole)', variantSku: null, quantity: 1 },
        { productName: 'Mineral Water', variantSku: 'BEV-WTR-2L', quantity: 2 },
      ],
    },
  ];

  for (const combo of combos) {
    const catId = categoryMap[combo.category];
    const comboRecord = await prisma.combo.create({
      data: {
        name: combo.name,
        slug: combo.slug,
        description: combo.description,
        shortDesc: combo.shortDesc,
        basePrice: combo.basePrice,
        salePrice: combo.salePrice,
        image: combo.image,
        stock: combo.stock,
        manageStock: combo.manageStock,
        isFeatured: combo.isFeatured,
        isActive: combo.isActive,
        categoryId: catId || null,
        images: [],
        tags: [],
      },
    });

    for (const item of combo.items) {
      const product = await prisma.product.findFirst({ where: { name: item.productName } });
      if (!product) {
        console.warn(`  ⚠ Product not found for combo item: ${item.productName}`);
        continue;
      }

      let variantId: string | undefined;
      if (item.variantSku) {
        const variant = await prisma.productVariant.findUnique({ where: { sku: item.variantSku } });
        if (variant) variantId = variant.id;
      }

      await prisma.comboItem.create({
        data: {
          comboId: comboRecord.id,
          productId: product.id,
          variantId: variantId || null,
          quantity: item.quantity,
        },
      });
    }
  }
  console.log(`  ✓ ${combos.length} combos created with items`);

  // ── Orders ──
  const allProducts = await prisma.product.findMany({
    where: { isActive: true },
    include: { variants: { where: { isActive: true }, take: 1 } },
  });

  const orderData = [
    {
      subtotal: 750,
      shippingCharge: 60,
      discount: 0,
      total: 810,
      status: 'Delivered',
      items: [
        { productName: 'Organic Tomatoes', variantSku: 'FV-TOM-1K', quantity: 2, price: 120 },
        { productName: 'Fresh Whole Milk', variantSku: 'DE-MLK-1L', quantity: 1, price: 130 },
        { productName: 'Free Range Eggs (12 pcs)', variantSku: null, quantity: 2, price: 135 },
        { productName: 'Mineral Water', variantSku: 'BEV-WTR-2L', quantity: 3, price: 45 },
      ],
    },
    {
      subtotal: 970,
      shippingCharge: 60,
      discount: 50,
      discountType: 'flat',
      total: 980,
      status: 'Processing',
      items: [
        { productName: 'Chicken Breast Boneless', variantSku: 'MF-CHK-1K', quantity: 2, price: 320 },
        { productName: 'Fresh Broccoli', variantSku: 'FV-BROC-1K', quantity: 1, price: 180 },
        { productName: 'Mixed Nuts (Roasted)', variantSku: null, quantity: 1, price: 399 },
      ],
    },
    {
      subtotal: 490,
      shippingCharge: 0,
      discount: 0,
      total: 490,
      status: 'Pending',
      items: [
        { productName: 'Baby Diapers (Size M, 30 pcs)', variantSku: 'BP-DPR-M', quantity: 1, price: 490 },
      ],
    },
    {
      subtotal: 470,
      shippingCharge: 60,
      discount: 0,
      total: 530,
      status: 'Shipped',
      items: [
        { productName: 'Healthy Breakfast Combo', variantSku: null, quantity: 1, price: 470, isCombo: true },
      ],
    },
  ];

  for (const order of orderData) {
    const displayId = `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const orderRecord = await prisma.order.create({
      data: {
        displayId,
        customerId: customer!.id,
        statusId: orderStatusMap[order.status],
        subtotal: order.subtotal,
        shippingCharge: order.shippingCharge,
        discount: order.discount,
        discountType: (order as any).discountType || 'flat',
        total: order.total,
        shippingAddress: JSON.stringify({
          street: '123 Gulshan Avenue',
          city: 'Dhaka',
          area: 'Gulshan 1',
          zip: '1212',
          phone: '+8801711111111',
        }),
        customerNotes: order.status === 'Pending' ? 'Please deliver between 9-11 AM' : null,
        timeline: [
          { status: order.status, timestamp: new Date().toISOString(), note: 'Order placed' },
        ],
      },
    });

    for (const item of order.items) {
      if ((item as any).isCombo) {
        const combo = await prisma.combo.findFirst({ where: { slug: 'healthy-breakfast-combo' } });
        await prisma.orderItem.create({
          data: {
            orderId: orderRecord.id,
            comboId: combo?.id || null,
            quantity: item.quantity,
            price: item.price,
          },
        });
      } else {
        const product = await prisma.product.findFirst({ where: { name: item.productName } });
        let variantId: string | undefined;
        if ((item as any).variantSku) {
          const variant = await prisma.productVariant.findUnique({
            where: { sku: (item as any).variantSku },
          });
          if (variant) variantId = variant.id;
        }

        await prisma.orderItem.create({
          data: {
            orderId: orderRecord.id,
            productId: product?.id || null,
            variantId: variantId || null,
            quantity: item.quantity,
            price: item.price,
          },
        });
      }
    }

    // Create payment for each order
    await prisma.payment.create({
      data: {
        orderId: orderRecord.id,
        gatewayCode: order.status === 'Pending' ? 'cash' : 'bkash',
        amount: order.total,
        status: order.status === 'Delivered' ? PaymentStatus.PAID : order.status === 'Pending' ? PaymentStatus.PENDING : PaymentStatus.PAID,
        transactionId: order.status !== 'Pending' ? `TXN${Date.now()}${Math.random().toString(36).substring(2, 6).toUpperCase()}` : null,
        verifiedBy: order.status === 'Delivered' ? admin.id : null,
        verifiedAt: order.status === 'Delivered' ? new Date() : null,
      },
    });
  }
  console.log(`  ✓ ${orderData.length} sample orders created with items and payments`);
  }

  // ── Payment Options ──
  const paymentOptions = [
    { type: PaymentOptionType.FULL_PAYMENT, name: 'Full Payment', description: 'Pay the full order amount online', enabled: true, sortOrder: 1 },
    { type: PaymentOptionType.PARTIAL_PAYMENT, name: 'Partial Payment', description: 'Pay a partial amount online, rest on delivery', enabled: true, sortOrder: 2 },
    { type: PaymentOptionType.CASH_ON_DELIVERY, name: 'Cash on Delivery', description: 'Pay in cash when order is delivered', enabled: true, sortOrder: 3 },
  ];
  for (const opt of paymentOptions) {
    await prisma.paymentOption.upsert({
      where: { type: opt.type },
      create: opt,
      update: {},
    });
  }
  console.log(`  ✓ ${paymentOptions.length} payment options created`);

  // ── Payment Gateways ──
  const gateways = [
    // CASH_ON_DELIVERY gateways
    { code: 'cash', name: 'Cash', type: 'cash', paymentOptionType: PaymentOptionType.CASH_ON_DELIVERY, enabled: true, mode: 'personal', phoneNumber: null, credentials: {}, sortOrder: 1 },
    
    // FULL_PAYMENT / PARTIAL_PAYMENT manual gateways
    { code: 'bkash', name: 'bKash (Manual)', type: 'manual', paymentOptionType: PaymentOptionType.FULL_PAYMENT, enabled: false, mode: 'personal', phoneNumber: '01700000000', credentials: {}, sortOrder: 2 },
    { code: 'nagad', name: 'Nagad (Manual)', type: 'manual', paymentOptionType: PaymentOptionType.FULL_PAYMENT, enabled: false, mode: 'personal', phoneNumber: '01700000001', credentials: {}, sortOrder: 3 },
    { code: 'rocket', name: 'Rocket (Manual)', type: 'manual', paymentOptionType: PaymentOptionType.FULL_PAYMENT, enabled: false, mode: 'personal', phoneNumber: '01700000002', credentials: {}, sortOrder: 4 },
    { code: 'upay', name: 'Upay (Manual)', type: 'manual', paymentOptionType: PaymentOptionType.FULL_PAYMENT, enabled: false, mode: 'personal', phoneNumber: null, credentials: {}, sortOrder: 5 },
    { code: 'cellfin', name: 'Cellfin (Manual)', type: 'manual', paymentOptionType: PaymentOptionType.FULL_PAYMENT, enabled: false, mode: 'personal', phoneNumber: null, credentials: {}, sortOrder: 6 },
    
    // bKash PGW - API gateway
    { code: 'bkash_pgw', name: 'bKash PGW (API)', type: 'api', paymentOptionType: PaymentOptionType.FULL_PAYMENT, enabled: false, mode: 'sandbox', phoneNumber: null, credentials: { appKey: '', appSecret: '', username: '', password: '' }, sortOrder: 7 },
  ];
  for (const g of gateways) {
    await prisma.paymentGateway.upsert({
      where: { code: g.code },
      create: g,
      update: {},
    });
  }
  console.log(`  ✓ ${gateways.length} payment gateways created`);

  // ── Courier Credentials ──
  const courierCreds = [
    { courier: 'steadfast', enabled: false, mode: 'sandbox', apiKey: null, secretKey: null, username: null, password: null, clientId: null, clientSecret: null, storeId: null, webhookSecret: null, credentials: {} },
    { courier: 'pathao', enabled: false, mode: 'sandbox', apiKey: null, secretKey: null, username: null, password: null, clientId: null, clientSecret: null, storeId: null, webhookSecret: null, credentials: {} },
    { courier: 'redx', enabled: false, mode: 'sandbox', apiKey: null, secretKey: null, username: null, password: null, clientId: null, clientSecret: null, storeId: null, webhookSecret: null, credentials: {} },
    { courier: 'carrybee', enabled: false, mode: 'sandbox', apiKey: null, secretKey: null, username: null, password: null, clientId: null, clientSecret: null, storeId: null, webhookSecret: null, credentials: {} },
  ];
  for (const c of courierCreds) {
    await prisma.courierCredentials.upsert({
      where: { courier: c.courier },
      create: c,
      update: {},
    });
  }
  console.log(`  ✓ ${courierCreds.length} courier credentials created`);

  // ── System Settings ──
  const systemSettings = [
    { key: 'storage_provider', value: 'local' },
    { key: 'store_name', value: 'EcoMate' },
    { key: 'store_tagline', value: 'Fresh Groceries, Delivered to Your Door' },
    { key: 'store_email', value: 'hello@ecomate.com' },
    { key: 'store_phone', value: '+8801700000000' },
    { key: 'store_address', value: '123 Gulshan Avenue, Dhaka 1212' },
    { key: 'currency', value: 'BDT' },
    { key: 'currency_symbol', value: '৳' },
    { key: 'delivery_charge', value: '60' },
    { key: 'free_delivery_min', value: '1000' },
    { key: 'meta_pixel_enabled', value: 'false' },
    { key: 'tiktok_pixel_enabled', value: 'false' },
{ key: 'hero_slides', value: JSON.stringify([
      { image: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&q=80&w=1600', link: '/products' },
      { image: 'https://images.unsplash.com/photo-1616348436168-de43ad0db179?auto=format&fit=crop&q=80&w=1600', link: '/combos' },
      { image: 'https://images.unsplash.com/photo-1593642632823-8f785ba67e45?auto=format&fit=crop&q=80&w=1600', link: '/products' },
    ]) },
    { key: 'social_facebook', value: 'https://facebook.com/ecomate' },
    { key: 'social_instagram', value: 'https://instagram.com/ecomate' },
    { key: 'social_youtube', value: 'https://youtube.com/@ecomate' },
    { key: 'social_whatsapp', value: '+8801700000000' },
    { key: 'seo_title', value: 'EcoMate - Fresh Groceries Delivered to Your Door' },
    { key: 'seo_description', value: 'Shop fresh groceries, fruits, vegetables, dairy, and more online. Fast delivery across Dhaka.' },
    { key: 'seo_keywords', value: 'grocery, fresh, delivery, Dhaka, Bangladesh, online shopping' },
    { key: 'footer_description', value: 'EcoMate is your trusted online grocery store. We deliver fresh fruits, vegetables, dairy, meat, and household essentials right to your doorstep.' },
    { key: 'footer_copyright', value: `© ${new Date().getFullYear()} EcoMate. All rights reserved.` },
    { key: 'about_us_text', value: 'EcoMate is a premier online grocery delivery service based in Dhaka, Bangladesh. We are committed to providing fresh, high-quality groceries at competitive prices with fast and reliable delivery.' },
    { key: 'shipping_info', value: 'We deliver across Dhaka city. Orders placed before 6 PM are delivered the same day. Delivery charge applies for orders under BDT 1,000.' },
    { key: 'payment_info', value: 'We accept Cash on Delivery, bKash, and Online Payment via credit/debit cards.' },
  ];

  for (const s of systemSettings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      create: { key: s.key, value: s.value },
      update: { value: s.value },
    });
  }
  console.log(`  ✓ ${systemSettings.length} system settings created`);

  if (seedDummyData) {
    // ── Download external images to local storage ──
    console.log('\n  Downloading external product images...');
  let scanned = 0;
  let migrated = 0;
  let failed = 0;

  const downloadAndSave = async (url: string): Promise<string | null> => {
    scanned++;
    try {
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        redirect: 'follow',
        headers: { 'User-Agent': 'EcoMate-Seed/1.0' },
      });
      if (!resp.ok) { failed++; return null; }
      const contentType = resp.headers.get('content-type')?.split(';')[0].trim() || '';
      if (!contentType.startsWith('image/')) { failed++; return null; }
      const buffer = Buffer.from(await resp.arrayBuffer());

      // Deduplicate by sha256
      const hash = createHash('sha256').update(buffer).digest('hex');
      const existing = await prisma.media.findUnique({ where: { hash } });
      if (existing) { migrated++; return existing.url; }

      const ext = MIME_EXT_MAP[contentType] || extname(new URL(url).pathname) || '.jpg';
      const filename = `${uuid()}${ext}`;

      // Save to uploads directory
      const uploadDir = join(process.cwd(), 'uploads');
      if (!existsSync(uploadDir)) await mkdir(uploadDir, { recursive: true });
      await writeFile(join(uploadDir, filename), buffer);

      // Register in Media library
      const localUrl = `/uploads/${filename}`;
      await prisma.media.create({
        data: {
          filename,
          url: localUrl,
          mimeType: contentType,
          size: buffer.length,
          hash,
          sourceUrl: url,
        },
      });

      migrated++;
      return localUrl;
    } catch {
      failed++;
      return null;
    }
  };

  const products = await prisma.product.findMany({ select: { id: true, images: true } });
  for (const p of products) {
    const imgs = (p.images as string[]) || [];
    if (imgs.length === 0) continue;
    const newImgs: string[] = [];
    for (const img of imgs) {
      if (/^https?:\/\//i.test(img)) {
        const local = await downloadAndSave(img);
        newImgs.push(local || img);
      } else {
        newImgs.push(img);
      }
    }
    const changed = JSON.stringify(newImgs) !== JSON.stringify(imgs);
    if (changed) {
      await prisma.product.update({ where: { id: p.id }, data: { images: newImgs as any } });
    }
  }

  // Storefront hero slides
  const heroRow = await prisma.systemSetting.findUnique({ where: { key: 'hero_slides' } });
  if (heroRow?.value) {
    try {
      const slides: { image: string; link?: string; alt?: string }[] = JSON.parse(heroRow.value);
      const newSlides: typeof slides = [];
      for (const s of slides) {
        if (s.image && /^https?:\/\//i.test(s.image)) {
          const local = await downloadAndSave(s.image);
          newSlides.push({ ...s, image: local || s.image });
        } else {
          newSlides.push(s);
        }
      }
      if (JSON.stringify(newSlides) !== JSON.stringify(slides)) {
        await prisma.systemSetting.update({
          where: { key: 'hero_slides' },
          data: { value: JSON.stringify(newSlides) },
        });
      }
    } catch { /* ignore */ }
  }

  console.log(`  ✓ Scanned: ${scanned}, Saved: ${migrated}, Failed: ${failed}`);
  if (failed > 0) {
    console.log(`  ⚠ ${failed} image(s) failed — may still have external URLs in DB`);
  }
  }

  console.log('\n✅ Database seeded successfully!');
  console.log('   Super Admin: admin@ecomate.com / Admin@123');
  if (seedDummyData) {
    console.log('   Customer:    customer@example.com / Customer@123');
  }
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
