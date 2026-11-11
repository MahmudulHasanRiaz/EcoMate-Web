import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from '../inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../../stock/stock.service';
import { StockRouterService } from '../../stock/stock-router.service';
import { CostingLotService } from '../../stock/costing-lot.service';
import { CacheService } from '../../cache/cache.service';
import { ManagedStockLedgerService } from '../managed-stock-ledger.service';

/**
 * 2026-11-03 fixes pinned here:
 *  - lowStock rows carry productId (variant rows: the PARENT product id),
 *  - valuation unitCost is the true FIFO average, standardCost separate,
 *  - stock-overview sortBy=stock orders variable products by variant-sum
 *    and sortOrder is honoured on every ordering.
 */
describe('InventoryService — overview / valuation / lowStock fixes', () => {
  let service: InventoryService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn(),
            $queryRawUnsafe: jest.fn(),
            product: { findMany: jest.fn(), count: jest.fn() },
            physicalInventory: { groupBy: jest.fn() },
          },
        },
        { provide: StockService, useValue: {} },
        {
          provide: StockRouterService,
          useValue: {
            isInventoryManagementEnabled: jest.fn().mockResolvedValue(false),
          },
        },
        { provide: CostingLotService, useValue: {} },
        { provide: ManagedStockLedgerService, useValue: {} },
        { provide: CacheService, useValue: {} },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('lowStock rows carry productId (variant rows: the parent product id)', async () => {
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([
        {
          id: 'p-1',
          name: 'Soap',
          slug: 'soap',
          stock: 2,
          lowStockQty: 5,
          sku: 'SOAP',
          images: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'p-2', // parent product id from the raw query's p.id
          name: 'Shirt',
          slug: 'shirt',
          sku: 'SH',
          lowStockQty: 5,
          images: null,
          variantId: 'v-1',
          variantSku: 'SH-S',
          variantStock: 1,
          variantImage: null,
          variantAttributes: 'S',
        },
      ]);

    const res = await service.lowStock();

    expect(res.products[0]).toMatchObject({
      id: 'p-1',
      productId: 'p-1',
      type: 'product',
    });
    // id keeps its variant semantics; productId is the parent.
    expect(res.products[1]).toMatchObject({
      id: 'v-1',
      productId: 'p-2',
      type: 'variant',
    });
  });

  it('valuation unitCost is the FIFO average and standardCost is separate', async () => {
    (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue([
      {
        id: 'p-1',
        name: 'Widget',
        sku: 'W-1',
        standardCost: 0,
        physical_qty: 8,
        physical_reserved: 4,
        fifo_value: 7680,
        lot_qty: 8,
        reconciliation_status: 'OK',
      },
      {
        id: 'p-2',
        name: 'Gadget',
        sku: 'G-1',
        standardCost: 55,
        physical_qty: 3,
        physical_reserved: 0,
        fifo_value: 0,
        lot_qty: 0,
        reconciliation_status: 'RECONCILIATION_NEEDED',
      },
    ]);

    const res = await service.valuation({} as any);

    // 8 lots' worth of stock valued ৳7680 → ৳960 true FIFO unit cost, NOT
    // the ৳0 standardCost the field used to carry.
    expect(res.items[0]).toMatchObject({
      unitCost: 960,
      standardCost: 0,
      lotRemainingQty: 8,
      fifoValue: 7680,
    });
    // No lots → unitCost 0 (no division by zero); standardCost preserved.
    expect(res.items[1]).toMatchObject({ unitCost: 0, standardCost: 55 });
  });

  describe('stockOverview sorting', () => {
    const simpleRow = {
      id: 'p-simple',
      name: 'Soap',
      slug: 'soap',
      sku: 'SOAP',
      type: 'simple',
      availabilityMode: 'MANAGED_STOCK',
      managedStockQuantity: 5,
      manageStock: true,
      reservedStock: 0,
      lowStockQty: null,
      basePrice: 100,
      salePrice: null,
      images: null,
      categoryId: null,
      category: null,
      variants: [],
      _count: { orderItems: 0 },
    };
    const variableRow = {
      ...simpleRow,
      id: 'p-var',
      name: 'Shirt',
      type: 'variable',
      managedStockQuantity: 0, // parent column is always 0
      variants: [
        {
          id: 'v-1',
          sku: 'SH-S',
          managedStockQuantity: 30,
          reservedStock: 0,
          price: 500,
          attributeValues: [],
        },
      ],
    };

    it('sortBy=stock orders by the variant-sum via raw SQL ids', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { id: 'p-var' },
        { id: 'p-simple' },
      ]);
      // The row fetch returns rows scrambled — the service must re-order
      // them by the SQL id order.
      (prisma.product.findMany as jest.Mock).mockResolvedValue([
        simpleRow,
        variableRow,
      ]);

      const res = await service.stockOverview({
        sortBy: 'stock',
        sortOrder: 'desc',
        page: 1,
        perPage: 20,
      });

      expect(res.data.map((p: any) => p.id)).toEqual(['p-var', 'p-simple']);
      expect(res.meta.total).toBe(2);
      // The reported figure for the variable product is the variant sum.
      expect(res.data[0].managedStockQuantity).toBe(30);
      const sqlArg = (prisma.$queryRaw as jest.Mock).mock.calls[0][0];
      expect(JSON.stringify(sqlArg)).toContain('ProductVariant');
    });

    it('honours sortOrder on the fallback ordering and on name', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      await service.stockOverview({ sortOrder: 'asc' });
      expect(
        (prisma.product.findMany as jest.Mock).mock.calls[0][0].orderBy,
      ).toEqual({ updatedAt: 'asc' });

      await service.stockOverview({ sortBy: 'name', sortOrder: 'desc' });
      expect(
        (prisma.product.findMany as jest.Mock).mock.calls[1][0].orderBy,
      ).toEqual({ name: 'desc' });
    });
  });

  describe('stockOverview — scoped managed view (2026-11-11, directive §3)', () => {
    const row = (id: string, mode: string) => ({
      id,
      name: id,
      slug: id,
      sku: id.toUpperCase(),
      type: 'simple',
      availabilityMode: mode,
      managedStockQuantity: 5,
      manageStock: true,
      reservedStock: 0,
      lowStockQty: null,
      basePrice: 100,
      salePrice: null,
      images: null,
      categoryId: null,
      category: null,
      variants: [],
      _count: { orderItems: 0 },
    });
    const all = [
      row('p-managed', 'MANAGED_STOCK'),
      row('p-ic', 'INVENTORY_CONTROLLED'),
      row('p-always-in', 'ALWAYS_IN_STOCK'),
      row('p-always-out', 'ALWAYS_OUT_OF_STOCK'),
    ];

    const mockDbFilter = () => {
      (prisma.product.findMany as jest.Mock).mockImplementation((args: any) =>
        Promise.resolve(
          args.where?.availabilityMode
            ? all.filter((r) => r.availabilityMode === args.where.availabilityMode)
            : all,
        ),
      );
      (prisma.product.count as jest.Mock).mockImplementation((args: any) =>
        Promise.resolve(
          args.where?.availabilityMode
            ? all.filter((r) => r.availabilityMode === args.where.availabilityMode).length
            : all.length,
        ),
      );
    };

    it('view=managed returns ONLY MANAGED_STOCK products (IC / Always-In / Always-Out absent)', async () => {
      mockDbFilter();
      const res = await service.stockOverview({ view: 'managed' });
      expect(res.data.map((p: any) => p.id)).toEqual(['p-managed']);
      expect(res.meta.total).toBe(1);
      const where = (prisma.product.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.availabilityMode).toBe('MANAGED_STOCK');
    });

    it('an explicit availabilityMode param scopes the same way', async () => {
      mockDbFilter();
      const res = await service.stockOverview({ availabilityMode: 'MANAGED_STOCK' });
      expect(res.data.map((p: any) => p.id)).toEqual(['p-managed']);
    });

    it('UNSCOPED calls stay mode-agnostic (detail-by-id, KPI total and reports keep seeing every product)', async () => {
      mockDbFilter();
      const res = await service.stockOverview({});
      expect(res.data.map((p: any) => p.id)).toEqual([
        'p-managed',
        'p-ic',
        'p-always-in',
        'p-always-out',
      ]);
      expect(res.meta.total).toBe(4);
    });

    it('the stock-sorted path applies the managed scope in its raw SQL too', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ id: 'p-managed' }]);
      (prisma.product.findMany as jest.Mock).mockResolvedValue([all[0]]);
      const res = await service.stockOverview({ view: 'managed', sortBy: 'stock' });
      expect(res.data.map((p: any) => p.id)).toEqual(['p-managed']);
      const sqlArg = (prisma.$queryRaw as jest.Mock).mock.calls[0][0];
      expect(JSON.stringify(sqlArg)).toContain('MANAGED_STOCK');
    });
  });
});
