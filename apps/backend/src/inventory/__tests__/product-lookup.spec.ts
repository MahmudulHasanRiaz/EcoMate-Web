import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from '../inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../../stock/stock.service';
import { StockRouterService } from '../../stock/stock-router.service';
import { CostingLotService } from '../../stock/costing-lot.service';
import { CacheService } from '../../cache/cache.service';
import { ManagedStockLedgerService } from '../managed-stock-ledger.service';

/**
 * `GET /inventory/product-lookup` — variant-level rows for the stock-transfer
 * picker. The contract these tests pin down:
 *
 *   - one row per SELECTABLE stock unit (simple → variantId null, variable →
 *     one row per active variant),
 *   - an exact SKU hit outranks every substring/name hit,
 *   - a parent SKU search returns the parent's VARIANTS and never the parent,
 *   - inactive products/variants never appear,
 *   - no query → no rows.
 */
describe('InventoryService — productLookup', () => {
  let service: InventoryService;
  let prisma: PrismaService;

  const simpleProduct = {
    id: 'prod-mug',
    name: 'Clay Mug',
    sku: 'MUG-001',
    type: 'simple',
    managedStockQuantity: 40,
    reservedStock: 5,
    variants: [],
  };

  const variableProduct = {
    id: 'prod-shirt',
    name: 'Cotton Shirt',
    // Product.sku is null for a variable product — only the parent code.
    sku: 'SHIRT',
    type: 'variable',
    managedStockQuantity: 0,
    reservedStock: 0,
    variants: [
      {
        id: 'var-shirt-s',
        sku: 'SHIRT-S',
        managedStockQuantity: 12,
        reservedStock: 2,
        attributeValues: [
          { attributeValue: { value: 'S' } },
          { attributeValue: { value: 'Cotton' } },
        ],
      },
      {
        id: 'var-shirt-m',
        sku: 'SHIRT-M',
        managedStockQuantity: 7,
        reservedStock: 0,
        attributeValues: [{ attributeValue: { value: 'M' } }],
      },
      {
        id: 'var-shirt-l',
        sku: 'SHIRT-L',
        managedStockQuantity: 3,
        reservedStock: 0,
        attributeValues: [{ attributeValue: { value: 'L' } }],
      },
    ],
  };

  /** Honour the `isActive` filter the service pushes into the relation. */
  const activeVariantsOnly = (p: any) => ({
    ...p,
    variants: p.variants.filter((v: any) => v.isActive !== false),
  });

  const findMany = () => prisma.product.findMany as jest.Mock;

  /**
   * `isActive` is enforced by the DATABASE, so the mock cannot "drop" a row the
   * service filtered out. Instead it asserts the filter is present and hands
   * back the rows the real query would have returned — i.e. already stripped of
   * inactive products and of variants the relation filter excluded.
   */
  const mockPage = (rows: any[]) => {
    findMany().mockImplementation((args: any) => {
      expect(args.where.isActive).toBe(true);
      expect(args.select.variants.where).toEqual({ isActive: { not: false } });
      return Promise.resolve(rows.map(activeVariantsOnly));
    });
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: PrismaService,
          useValue: {
            product: { findMany: jest.fn() },
            physicalInventory: { groupBy: jest.fn() },
          },
        },
        { provide: StockService, useValue: {} },
        { provide: StockRouterService, useValue: {} },
        { provide: CostingLotService, useValue: {} },
        { provide: ManagedStockLedgerService, useValue: {} },
        { provide: CacheService, useValue: {} },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    prisma = module.get<PrismaService>(PrismaService);

    findMany().mockResolvedValue([]);
    (prisma.physicalInventory.groupBy as jest.Mock).mockResolvedValue([]);
  });

  it('returns nothing for an empty query — it never scans the whole catalogue', async () => {
    const res = await service.productLookup({ q: '   ' });

    expect(res.data).toEqual([]);
    expect(res.meta).toEqual({ total: 0, perPage: 25 });
    expect(findMany()).not.toHaveBeenCalled();
  });

  it('matches on product name, Product.sku and ProductVariant.sku', async () => {
    await service.productLookup({ q: 'shirt' });

    // Phase 1 is the indexed exact-SKU pass (finds a buried SKU among
    // thousands); phase 2 is the fuzzy substring fill.
    expect(findMany().mock.calls[0][0].where).toEqual({
      isActive: true,
      OR: [
        { sku: { equals: 'shirt', mode: 'insensitive' } },
        { variants: { some: { sku: { equals: 'shirt', mode: 'insensitive' } } } },
      ],
    });
    expect(findMany().mock.calls.length).toBeGreaterThan(1);
    const fuzzyWhere = findMany().mock.calls[1][0].where;
    expect(fuzzyWhere.isActive).toBe(true);
    expect(fuzzyWhere.AND[0]).toEqual({
      OR: [
        { name: { contains: 'shirt', mode: 'insensitive' } },
        { sku: { contains: 'shirt', mode: 'insensitive' } },
        { variants: { some: { sku: { contains: 'shirt', mode: 'insensitive' } } } },
      ],
    });
  });

  it('finds a buried exact SKU without scanning the whole catalogue', async () => {
    // Thousands of products match "shirt" fuzzily, but the exact SKU sits deep
    // in id order. The exact phase must surface it on the first query.
    const buried = {
      id: 'prod-buried',
      name: 'Buried Exact',
      sku: 'BURIED-999',
      type: 'simple',
      managedStockQuantity: 5,
      reservedStock: 0,
      variants: [],
    };
    findMany().mockImplementation((args: any) => {
      const or = args.where.OR;
      if (or?.some((c: any) => c.sku?.equals)) return Promise.resolve([buried]);
      return Promise.resolve([]);
    });

    const res = await service.productLookup({ q: 'BURIED-999' });

    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({ productId: 'prod-buried', sku: 'BURIED-999' });
  });

  it('returns a single variantId-null row for a SIMPLE product', async () => {
    findMany().mockResolvedValue([simpleProduct]);

    const res = await service.productLookup({ q: 'MUG-001' });

    expect(res.data).toEqual([
      {
        productId: 'prod-mug',
        productName: 'Clay Mug',
        variantId: null,
        variantName: null,
        sku: 'MUG-001',
        type: 'product',
        available: 35,
      },
    ]);
    expect(res.meta).toEqual({ total: 1, perPage: 25, hasMore: false });
  });

  it('returns that product’s variants for a parent SKU — never a bare parent row', async () => {
    findMany().mockResolvedValue([variableProduct]);

    const res = await service.productLookup({ q: 'SHIRT' });

    // A parent-SKU search must force a variant choice: 3 rows, no variantId
    // left null, and no product-level row for the parent itself.
    expect(res.data).toHaveLength(3);
    expect(res.data.every((r) => r.variantId !== null)).toBe(true);
    expect(res.data.every((r) => r.type === 'variant')).toBe(true);
    expect(res.data.map((r) => r.sku)).toEqual(['SHIRT-L', 'SHIRT-M', 'SHIRT-S']);
    // Attribute values are joined for the "— VariantName (SKU)" label.
    expect(res.data[0].variantName).toBe('L');
    expect(res.data[2].variantName).toBe('S / Cotton');
  });

  it('puts the exact variant-SKU match first', async () => {
    const other = {
      id: 'prod-tee',
      name: 'Cotton Shirt Sleeve Tee',
      sku: null,
      type: 'variable',
      managedStockQuantity: 0,
      reservedStock: 0,
      variants: [
        {
          id: 'var-tee-1',
          sku: 'TEE-SLIM-S',
          managedStockQuantity: 4,
          reservedStock: 0,
          attributeValues: [],
        },
      ],
    };
    findMany().mockResolvedValue([other, variableProduct]);

    const res = await service.productLookup({ q: 'SHIRT-S' });

    expect(res.data[0]).toMatchObject({
      productId: 'prod-shirt',
      variantId: 'var-shirt-s',
      sku: 'SHIRT-S',
    });
    // The plain substring matches are still there, behind it.
    expect(res.data.length).toBeGreaterThan(1);
  });

  it('hoists an exact parent-SKU match above plain name matches', async () => {
    const exact = {
      id: 'prod-parent',
      name: 'Blue Oxford',
      sku: 'OXF-100',
      type: 'simple',
      managedStockQuantity: 10,
      reservedStock: 0,
      variants: [],
    };
    const nameOnly = {
      id: 'prod-oxford-tee',
      name: 'Oxford Oxford Tee',
      sku: 'OXF-TEE',
      type: 'simple',
      managedStockQuantity: 2,
      reservedStock: 0,
      variants: [],
    };
    findMany().mockResolvedValue([nameOnly, exact]);

    const res = await service.productLookup({ q: 'OXF-100' });

    expect(res.data[0]).toMatchObject({ productId: 'prod-parent', sku: 'OXF-100' });
    expect(res.data).toHaveLength(2);
  });

  it('excludes inactive products and inactive variants', async () => {
    // Only the ACTIVE variant survives the relation filter — the service must
    // not re-add it, and must not emit the parent row in its place.
    mockPage([
      {
        ...variableProduct,
        variants: [
          variableProduct.variants[0],
          { ...variableProduct.variants[1], isActive: false },
        ],
      },
    ]);

    const res = await service.productLookup({ q: 'SHIRT' });

    expect(res.data.map((r) => r.variantId)).toEqual(['var-shirt-s']);
    expect(res.data.every((r) => r.variantId !== null)).toBe(true);
  });

  it('emits no rows at all for an inactive product', async () => {
    // The DB applies `isActive: true`, so an inactive product yields an empty
    // page — and an empty page must surface as an empty result, not a fallback.
    mockPage([]);
    const res = await service.productLookup({ q: 'Clay Mug' });
    expect(res.data).toEqual([]);
    expect(res.meta.total).toBe(0);
  });

  it('overrides managed availability with warehouse-scoped physical stock', async () => {
    findMany().mockResolvedValue([variableProduct]);
    (prisma.physicalInventory.groupBy as jest.Mock).mockResolvedValue([
      { productId: 'prod-shirt', variantId: 'var-shirt-s', _sum: { quantity: 9, reservedQuantity: 4 } },
      { productId: 'prod-shirt', variantId: 'var-shirt-m', _sum: { quantity: 6, reservedQuantity: 1 } },
    ]);

    const res = await service.productLookup({ q: 'SHIRT', warehouseId: 'wh-main' });

    const byId = new Map(res.data.map((r) => [r.variantId, r.available]));
    expect(byId.get('var-shirt-s')).toBe(5);
    expect(byId.get('var-shirt-m')).toBe(5);
    // No physical rows for the L variant → keeps its managed figure.
    expect(byId.get('var-shirt-l')).toBe(3);

    const groupByArgs = (prisma.physicalInventory.groupBy as jest.Mock).mock.calls[0][0];
    expect(groupByArgs.by).toEqual(['productId', 'variantId']);
    expect(groupByArgs.where.warehouseId).toBe('wh-main');
  });

  it('caps the number of rows it returns', async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      ...simpleProduct,
      id: `prod-${i}`,
      sku: `SKU-${i}`,
    }));
    findMany().mockImplementation(() => Promise.resolve(many.slice(0, 3)));

    const res = await service.productLookup({ q: 'sku', perPage: 4 });
    expect(res.data.length).toBeLessThanOrEqual(4);

    const res2 = await service.productLookup({ q: 'sku', perPage: 5000 });
    expect(res2.meta.perPage).toBe(50);
  });
});