import { Test, TestingModule } from '@nestjs/testing';
import { MarketingAllocationService } from './marketing-allocation.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MarketingAllocationService', () => {
  let service: MarketingAllocationService;
  let prisma: PrismaService;

  const mockPrisma = () => ({
    orderAttribution: { findMany: jest.fn() },
    marketingCampaign: { findUnique: jest.fn() },
    marketingConsumption: { findMany: jest.fn(), groupBy: jest.fn(), aggregate: jest.fn() },
    marketingCampaignInsight: { findMany: jest.fn() },
    marketingCostAllocation: { upsert: jest.fn() },
    productMarketingCost: { deleteMany: jest.fn(), create: jest.fn() },
    systemSetting: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingAllocationService,
        { provide: PrismaService, useValue: mockPrisma() },
      ],
    }).compile();
    service = module.get(MarketingAllocationService);
    prisma = module.get(PrismaService);
    (prisma.marketingCampaign.findUnique as jest.Mock).mockResolvedValue({
      adAccount: { currency: 'USD' },
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('no-op for non-positive spend', async () => {
    const res = await service.allocateCampaignDate({ campaignId: 'camp-1', date: new Date('2026-01-10'), spend: 0 });
    expect(res).toEqual({ allocated: 0, orders: 0 });
    expect(prisma.orderAttribution.findMany).not.toHaveBeenCalled();
  });

  it('no-op when the campaign has no attributed orders that day', async () => {
    (prisma.orderAttribution.findMany as jest.Mock).mockResolvedValue([]);
    const res = await service.allocateCampaignDate({ campaignId: 'camp-1', date: new Date('2026-01-10'), spend: 100 });
    expect(res).toEqual({ allocated: 0, orders: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allocates spend pro-rata by order-total share (product_value) and replaces product rows', async () => {
    // Two orders on the same day: totals 3000 and 1000 → shares 75% / 25%.
    // Day spend 100 USD, one consumption row 100 @ rate 120 → dayRate 120,
    // funded spend 100 → allocatedCost = share * 100 * 120.
    const attrs = [
      {
        id: 'attr-1',
        orderId: 'order-1',
        campaignId: 'camp-1',
        order: {
          id: 'order-1',
          total: 3000,
          trashedAt: null,
          items: [{ id: 'item-1', price: 1000, quantity: 2 }, { id: 'item-2', price: 1000, quantity: 1 }],
        },
      },
      {
        id: 'attr-2',
        orderId: 'order-2',
        campaignId: 'camp-1',
        order: { id: 'order-2', total: 1000, trashedAt: null, items: [{ id: 'item-3', price: 1000, quantity: 1 }] },
      },
    ];
    (prisma.orderAttribution.findMany as jest.Mock).mockResolvedValue(attrs);

    const tx = {
      marketingConsumption: {
        findMany: jest.fn().mockResolvedValue([
          { effectiveRate: 120, consumedAmount: 100 },
        ]),
      },
      marketingCostAllocation: {
        upsert: jest.fn(async (args: any) => ({ id: `alloc-${args.where.orderId_campaignId.orderId}`, ...args.update })),
      },
      productMarketingCost: { deleteMany: jest.fn(), create: jest.fn().mockResolvedValue({}) },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));

    const res = await service.allocateCampaignDate({ campaignId: 'camp-1', date: new Date('2026-01-10'), spend: 100 });
    expect(res.orders).toBe(2);
    expect(res.allocated).toBe(100);

    // First order: 75% of 100 = 75 → cost 9000; second: 25 → cost 3000.
    const upsertCalls = tx.marketingCostAllocation.upsert.mock.calls.map((c: any) => c[0]);
    const order1 = upsertCalls.find((u: any) => u.where.orderId_campaignId.orderId === 'order-1');
    const order2 = upsertCalls.find((u: any) => u.where.orderId_campaignId.orderId === 'order-2');
    expect(order1.create.allocatedSpend).toBe(75);
    expect(order1.create.allocatedCost).toBe(9000);
    expect(order1.create.allocationMethod).toBe('product_value');
    expect(order2.create.allocatedSpend).toBe(25);
    expect(order2.create.allocatedCost).toBe(3000);

    // Product-level rows replaced for order 1 (2 items, 66.7%/33.3%).
    const createdItems = tx.productMarketingCost.create.mock.calls.map((c: any) => c[0].data);
    expect(createdItems.filter((d: any) => d.orderItemId === 'item-1' || d.orderItemId === 'item-2')).toHaveLength(2);
    const item1 = createdItems.find((d: any) => d.orderItemId === 'item-1');
    expect(item1.marketingCost).toBe(6000);
    expect(item1.allocationRatio).toBeCloseTo(2 / 3, 1);
    expect(tx.productMarketingCost.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('excludes trashed orders from allocation', async () => {
    (prisma.orderAttribution.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'attr-1',
        orderId: 'order-trashed',
        campaignId: 'camp-1',
        order: { id: 'order-trashed', total: 9999, trashedAt: new Date(), items: [] },
      },
    ]);
    const res = await service.allocateCampaignDate({ campaignId: 'camp-1', date: new Date('2026-01-10'), spend: 100 });
    expect(res).toEqual({ allocated: 0, orders: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('uses plain spend as fallback source when funding rows are absent', async () => {
    const attrs = [
      {
        id: 'attr-1',
        orderId: 'order-1',
        campaignId: 'camp-1',
        order: { id: 'order-1', total: 500, trashedAt: null, items: [{ id: 'item-1', price: 500, quantity: 1 }] },
      },
    ];
    (prisma.orderAttribution.findMany as jest.Mock).mockResolvedValue(attrs);
    const tx = {
      marketingConsumption: { findMany: jest.fn().mockResolvedValue([]) },
      marketingCostAllocation: {
        upsert: jest.fn(async (args: any) => ({ id: 'alloc-x', ...args.create })),
      },
      productMarketingCost: { deleteMany: jest.fn(), create: jest.fn() },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));

    await service.allocateCampaignDate({ campaignId: 'camp-1', date: new Date('2026-01-10'), spend: 50 });
    const upsert = tx.marketingCostAllocation.upsert.mock.calls[0][0];
    expect(upsert.create.allocatedSpend).toBe(50); // falls back to entry.spend
    expect(upsert.create.allocatedCost).toBe(0);   // no funded spend → rate 0
  });

  it('defaults to product_value when the allocation mode setting is missing', async () => {
    (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.orderAttribution.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'attr-1',
        orderId: 'order-1',
        campaignId: 'camp-1',
        order: { id: 'order-1', total: 500, trashedAt: null, items: [{ id: 'item-1', price: 500, quantity: 1 }] },
      },
    ]);
    const tx = {
      marketingConsumption: { findMany: jest.fn().mockResolvedValue([]) },
      marketingCostAllocation: { upsert: jest.fn(async (args: any) => ({ id: 'alloc-x', ...args.create })) },
      productMarketingCost: { deleteMany: jest.fn(), create: jest.fn() },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));

    await service.allocateCampaignDate({ campaignId: 'camp-1', date: new Date('2026-01-10'), spend: 50 });
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledWith({ where: { key: 'marketing_allocation_mode' } });
    expect(tx.marketingCostAllocation.upsert.mock.calls[0][0].create.allocationMethod).toBe('product_value');
  });

  it('falls back to product_value for an invalid allocation mode setting', async () => {
    (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({ key: 'marketing_allocation_mode', value: 'exact_cost' });
    (prisma.orderAttribution.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'attr-1',
        orderId: 'order-1',
        campaignId: 'camp-1',
        order: { id: 'order-1', total: 500, trashedAt: null, items: [{ id: 'item-1', price: 500, quantity: 1 }] },
      },
    ]);
    const tx = {
      marketingConsumption: { findMany: jest.fn().mockResolvedValue([]) },
      marketingCostAllocation: { upsert: jest.fn(async (args: any) => ({ id: 'alloc-x', ...args.create })) },
      productMarketingCost: { deleteMany: jest.fn(), create: jest.fn() },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));

    await service.allocateCampaignDate({ campaignId: 'camp-1', date: new Date('2026-01-10'), spend: 50 });
    expect(tx.marketingCostAllocation.upsert.mock.calls[0][0].create.allocationMethod).toBe('product_value');
  });

  it('splits spend equally across candidates in equal mode (1/n regardless of order totals)', async () => {
    (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({ key: 'marketing_allocation_mode', value: 'equal' });
    const attrs = [
      {
        id: 'attr-1',
        orderId: 'order-1',
        campaignId: 'camp-1',
        order: { id: 'order-1', total: 5000, trashedAt: null, items: [{ id: 'item-1', price: 5000, quantity: 1 }] },
      },
      {
        id: 'attr-2',
        orderId: 'order-2',
        campaignId: 'camp-1',
        order: { id: 'order-2', total: 200, trashedAt: null, items: [{ id: 'item-2', price: 200, quantity: 1 }] },
      },
      {
        id: 'attr-3',
        orderId: 'order-3',
        campaignId: 'camp-1',
        order: { id: 'order-3', total: 300, trashedAt: null, items: [{ id: 'item-3', price: 300, quantity: 1 }] },
      },
    ];
    (prisma.orderAttribution.findMany as jest.Mock).mockResolvedValue(attrs);
    const tx = {
      marketingConsumption: {
        findMany: jest.fn().mockResolvedValue([{ effectiveRate: 100, consumedAmount: 100 }]),
      },
      marketingCostAllocation: {
        upsert: jest.fn(async (args: any) => ({ id: `alloc-${args.where.orderId_campaignId.orderId}`, ...args.create })),
      },
      productMarketingCost: { deleteMany: jest.fn(), create: jest.fn() },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));

    const res = await service.allocateCampaignDate({ campaignId: 'camp-1', date: new Date('2026-01-10'), spend: 300 });
    expect(res.allocated).toBeCloseTo(100, 3); // funded spend 100 split 1/3 each
    expect(res.orders).toBe(3);

    const upsertCalls = tx.marketingCostAllocation.upsert.mock.calls.map((c: any) => c[0]);
    expect(upsertCalls).toHaveLength(3);
    for (const u of upsertCalls) {
      expect(u.create.allocatedSpend).toBeCloseTo(100 / 3, 3);
      expect(u.create.allocationMethod).toBe('equal');
    }
  });

  it('weights shares by ordered item quantity in quantity mode', async () => {
    (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({ key: 'marketing_allocation_mode', value: 'quantity' });
    const attrs = [
      {
        id: 'attr-1',
        orderId: 'order-1',
        campaignId: 'camp-1',
        order: {
          id: 'order-1',
          total: 1000,
          trashedAt: null,
          items: [
            { id: 'item-1', price: 100, quantity: 2 },
            { id: 'item-2', price: 100, quantity: 1 },
          ],
        },
      },
      {
        id: 'attr-2',
        orderId: 'order-2',
        campaignId: 'camp-1',
        order: { id: 'order-2', total: 1000, trashedAt: null, items: [{ id: 'item-3', price: 100, quantity: 1 }] },
      },
    ];
    (prisma.orderAttribution.findMany as jest.Mock).mockResolvedValue(attrs);
    const tx = {
      marketingConsumption: { findMany: jest.fn().mockResolvedValue([]) },
      marketingCostAllocation: {
        upsert: jest.fn(async (args: any) => ({ id: `alloc-${args.where.orderId_campaignId.orderId}`, ...args.create })),
      },
      productMarketingCost: { deleteMany: jest.fn(), create: jest.fn() },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));

    const res = await service.allocateCampaignDate({ campaignId: 'camp-1', date: new Date('2026-01-10'), spend: 100 });
    expect(res.allocated).toBe(100);

    const upsertCalls = tx.marketingCostAllocation.upsert.mock.calls.map((c: any) => c[0]);
    const order1 = upsertCalls.find((u: any) => u.where.orderId_campaignId.orderId === 'order-1');
    const order2 = upsertCalls.find((u: any) => u.where.orderId_campaignId.orderId === 'order-2');
    expect(order1.create.allocatedSpend).toBe(75); // qty 3 of 4
    expect(order2.create.allocatedSpend).toBe(25); // qty 1 of 4
    expect(order1.create.allocationMethod).toBe('quantity');
    expect(order2.create.allocationMethod).toBe('quantity');
  });

  it('rewrites the recorded method in the update branch and re-reads the setting per run', async () => {
    (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({ key: 'marketing_allocation_mode', value: 'equal' });
    (prisma.orderAttribution.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'attr-1',
        orderId: 'order-1',
        campaignId: 'camp-1',
        order: { id: 'order-1', total: 500, trashedAt: null, items: [{ id: 'item-1', price: 500, quantity: 1 }] },
      },
    ]);
    const tx = {
      marketingConsumption: { findMany: jest.fn().mockResolvedValue([]) },
      marketingCostAllocation: {
        upsert: jest.fn(async (args: any) => ({ id: 'alloc-x', ...args.create, ...args.update })),
      },
      productMarketingCost: { deleteMany: jest.fn(), create: jest.fn() },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));

    await service.allocateCampaignDate({ campaignId: 'camp-1', date: new Date('2026-01-10'), spend: 50 });
    const first = tx.marketingCostAllocation.upsert.mock.calls[0][0];
    expect(first.create.allocationMethod).toBe('equal');

    await service.allocateCampaignDate({ campaignId: 'camp-1', date: new Date('2026-01-10'), spend: 50 });
    const second = tx.marketingCostAllocation.upsert.mock.calls[1][0];
    expect(second.update.allocationMethod).toBe('equal');
    expect((prisma.systemSetting.findUnique as jest.Mock).mock.calls).toHaveLength(2);
  });

  it('groups spend days by (campaignId, spendDate) and aggregates per day', async () => {
    (prisma.marketingConsumption.groupBy as jest.Mock).mockResolvedValue([
      { campaignId: 'camp-1', spendDate: new Date('2026-01-10') },
      { campaignId: 'camp-1', spendDate: new Date('2026-01-11') },
    ]);
    (prisma.marketingConsumption.aggregate as jest.Mock).mockResolvedValue({ _sum: { consumedAmount: 40 } });
    const allocSpy = jest.spyOn(service as any, 'allocateCampaignDate').mockResolvedValue({ allocated: 40, orders: 1 });

    await service.runCampaignSpendAllocations();
    expect(allocSpy).toHaveBeenCalledTimes(2);
    const args = allocSpy.mock.calls.map((c: any) => c[0]);
    expect(args[0]).toMatchObject({ campaignId: 'camp-1', spend: 40 });
    expect(args[1]).toMatchObject({ campaignId: 'camp-1', spend: 40 });
  });

  it('rebuildFromInsights goes straight from insight rows to allocation math', async () => {
    (prisma.marketingCampaignInsight.findMany as jest.Mock).mockResolvedValue([
      { campaignId: 'camp-1', date: new Date('2026-01-10'), spend: 30 },
      { campaignId: 'camp-1', date: new Date('2026-01-11'), spend: 0 },
    ]);
    const allocSpy = jest.spyOn(service as any, 'allocateCampaignDate').mockResolvedValue({ allocated: 30, orders: 1 });
    const res = await service.rebuildFromInsights();
    expect(allocSpy).toHaveBeenCalledTimes(1); // zero-spend day skipped
    expect(allocSpy).toHaveBeenCalledWith({ campaignId: 'camp-1', date: expect.any(Date), spend: 30 });
    expect(res).toHaveLength(1);
  });
});