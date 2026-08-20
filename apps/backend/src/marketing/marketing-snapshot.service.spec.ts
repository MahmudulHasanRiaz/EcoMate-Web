import { Test, TestingModule } from '@nestjs/testing';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { MarketingSnapshotService } from './marketing-snapshot.service';
import { MarketingSnapshotController } from './marketing-snapshot.controller';
import { PrismaService } from '../prisma/prisma.service';
import { ROLES_KEY } from '../common/decorators/roles.decorator';

describe('MarketingSnapshotService', () => {
  let service: MarketingSnapshotService;
  let prisma: PrismaService;

  const mockPrisma = () => ({
    marketingCostAllocation: { findMany: jest.fn() },
    marketingDailyProductCost: { upsert: jest.fn(), findMany: jest.fn() },
  });

  const allocation = {
    id: 'alloc-1',
    allocatedSpend: '100',
    allocatedCost: '80',
    productCosts: [
      {
        allocationRatio: '0.6',
        marketingCost: '48',
        orderItem: { productId: 'p1', orderId: 'o1', price: '500', quantity: 2 },
      },
      {
        allocationRatio: '0.4',
        marketingCost: '32',
        orderItem: { productId: 'p2', orderId: 'o1', price: '300', quantity: 1 },
      },
    ],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingSnapshotService,
        { provide: PrismaService, useValue: mockPrisma() },
      ],
    }).compile();
    service = module.get(MarketingSnapshotService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('rebuildProductSnapshots', () => {
    it('creates rows with summed spend/cost/revenue/orders/qty from allocations', async () => {
      (prisma.marketingCostAllocation.findMany as jest.Mock).mockResolvedValue([allocation]);
      (prisma.marketingDailyProductCost.upsert as jest.Mock).mockImplementation(
        async (args: any) => ({ id: 'snap-1', ...args.create }),
      );

      const res = await service.rebuildProductSnapshots('2026-08-01', '2026-08-02');

      expect(res.rebuilt).toBe(4); // 2 products x 2 days
      const calls = (prisma.marketingDailyProductCost.upsert as jest.Mock).mock.calls;
      expect(calls).toHaveLength(4);
      const p1 = calls.filter((c) => c[0].where.productId_date.productId === 'p1');
      expect(p1).toHaveLength(2);
      expect(p1[0][0].create).toMatchObject({
        productId: 'p1',
        spend: 60,
        cost: 48,
        revenue: 1000,
        profit: 952,
        orders: 1,
        quantity: 2,
      });
      const p2 = calls.filter((c) => c[0].where.productId_date.productId === 'p2');
      expect(p2[0][0].create).toMatchObject({
        productId: 'p2',
        spend: 40,
        cost: 32,
        revenue: 300,
        profit: 268,
        orders: 1,
        quantity: 1,
      });
    });

    it('is deterministic on rerun (upsert targets the same composite key)', async () => {
      (prisma.marketingCostAllocation.findMany as jest.Mock).mockResolvedValue([allocation]);
      (prisma.marketingDailyProductCost.upsert as jest.Mock).mockImplementation(
        async (args: any) => ({ id: 'snap-1', ...args.create }),
      );

      await service.rebuildProductSnapshots('2026-08-01', '2026-08-01');
      const first = (prisma.marketingDailyProductCost.upsert as jest.Mock).mock.calls.map(
        (c) => c[0].where.productId_date,
      );
      await service.rebuildProductSnapshots('2026-08-01', '2026-08-01');
      const second = (prisma.marketingDailyProductCost.upsert as jest.Mock).mock.calls
        .slice(2)
        .map((c) => c[0].where.productId_date);

      expect(first).toEqual(second);
      const where = (prisma.marketingDailyProductCost.upsert as jest.Mock).mock.calls[0][0].where;
      expect(where).toEqual({ productId_date: { productId: 'p1', date: expect.any(Date) } });
      const args = (prisma.marketingDailyProductCost.upsert as jest.Mock).mock.calls[0][0];
      expect(args.update).toEqual(expect.objectContaining({ spend: 60 }));
    });

    it('returns {rebuilt:0} for an empty window without throwing', async () => {
      (prisma.marketingCostAllocation.findMany as jest.Mock).mockResolvedValue([]);
      const res = await service.rebuildProductSnapshots('2026-08-10', '2026-08-11');
      expect(res.rebuilt).toBe(0);
      expect(prisma.marketingDailyProductCost.upsert).not.toHaveBeenCalled();
    });
  });

  describe('productSnapshotSummary', () => {
    const row = (productId: string, name: string, profit: number, orders = 1) => ({
      productId,
      spend: '10',
      revenue: '100',
      cost: '20',
      profit: String(profit),
      orders,
      quantity: 1,
      product: { id: productId, name },
    });

    it('groups rows per product, orders by profit desc and includes product name', async () => {
      (prisma.marketingDailyProductCost.findMany as jest.Mock).mockResolvedValue([
        row('p2', 'Shirt', 40),
        row('p1', 'Jeans', 20),
        row('p1', 'Jeans', 10),
      ]);

      const res = await service.productSnapshotSummary('2026-08-01', '2026-08-31');

      expect(res.data).toHaveLength(2);
      expect(res.data[0].productId).toBe('p2');
      expect(res.data[0].profit).toBe(40);
      expect(res.data[0].spend).toBe(10);
      expect(res.data[0].orders).toBe(1);
      expect(res.data[1]).toMatchObject({ productName: 'Jeans', profit: 30, orders: 2, spend: 20 });
      expect(res.data[1].roas).toBe(10);
    });

    it('caps at 100 products', async () => {
      (prisma.marketingDailyProductCost.findMany as jest.Mock).mockResolvedValue(
        Array.from({ length: 120 }, (_, i) => row(`p${i}`, `T${i}`, i)),
      );

      const res = await service.productSnapshotSummary('2026-08-01', '2026-08-31');

      expect(res.data).toHaveLength(100);
      expect(res.data[0].productId).toBe('p119');
      expect(res.data[99].productId).toBe('p20');
    });

    it('returns {data:[]} for an empty window', async () => {
      (prisma.marketingDailyProductCost.findMany as jest.Mock).mockResolvedValue([]);
      const res = await service.productSnapshotSummary('2026-08-01', '2026-08-31');
      expect(res.data).toEqual([]);
    });
  });
});

describe('MarketingSnapshotController — license gating', () => {
  it('is gated with RequiresFeature(marketing_attribution)', () => {
    expect(Reflect.getMetadata(REQUIRES_FEATURE_KEY, MarketingSnapshotController)).toBe(
      'marketing_attribution',
    );
  });

  it('requires staff roles (never customer) at class level', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, MarketingSnapshotController);
    expect(roles).toEqual(['superadmin', 'admin', 'manager']);
    expect(roles).not.toContain('customer');
  });

  it('exposes the products GET and rebuild POST handlers', () => {
    const proto = MarketingSnapshotController.prototype;
    expect(typeof proto.products).toBe('function');
    expect(typeof proto.rebuild).toBe('function');
  });
});