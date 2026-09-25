/**
 * P6 immutability suite (BR-17): external-store order data is not an
 * operational source of truth. After ingest, only status and store metadata
 * are mutable from the store side; totals, items and prices are immutable.
 */
import { StoreOrderIngestService } from '../store-order-ingest.service';

function mockPrisma() {
  return {
    store: { findUnique: jest.fn() },
    storeOrderMapping: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    storeOrderStatusMap: { findUnique: jest.fn(), create: jest.fn() },
    storeSkuMapping: { findUnique: jest.fn(), upsert: jest.fn() },
    productVariant: { findUnique: jest.fn() },
    product: { findFirst: jest.fn() },
    orderStatus: { findFirst: jest.fn() },
    order: { findUnique: jest.fn(), update: jest.fn() },
    syncRun: { update: jest.fn().mockResolvedValue({}) },
  } as any;
}

function buildIngest(prisma: any) {
  const orders = {
    create: jest.fn().mockResolvedValue({ id: 'ord-1', status: { name: 'Confirmed' }, total: 250 }),
    updateStatus: jest.fn(),
  };
  const runs = {
    recordItem: jest.fn().mockResolvedValue({}),
    upsertIssue: jest.fn().mockResolvedValue({}),
    finish: jest.fn().mockResolvedValue({}),
  } as any;
  const svc = new StoreOrderIngestService(prisma, orders as any, runs, {} as any, {} as any);
  return { svc, orders, runs, prisma };
}

const MAPPING = {
  orderId: 'ord-1',
  externalOrderId: 'ext-2',
  order: { status: { name: 'Confirmed' }, total: 500 },
};

describe('P6 BR-17 — totals/items/prices immutable from the store side', () => {
  it('a store-side totals + items + price rewrite is ignored with a note', async () => {
    const { svc, orders, prisma } = buildIngest(mockPrisma());
    prisma.storeOrderMapping.findUnique.mockResolvedValue({ ...MAPPING });
    prisma.storeOrderStatusMap.findUnique.mockResolvedValue({ internalStatusName: 'Confirmed' });

    const res = await svc.ingest('s1', {
      id: 'ext-2',
      status: 'processing',
      total: 1200, // store claims a different total
      currency: 'BDT',
      createdAt: '2026-09-21T11:00:00.000Z',
      items: [{ sku: 'SKU-CHANGED', qty: 9, price: 1 }], // and different lines
    }, { type: 'WEBHOOK', runId: 'run-1' });

    expect(res).toMatchObject({ created: false, status: 'Confirmed', statusChanged: false });
    expect(orders.create).not.toHaveBeenCalled();
    expect(orders.updateStatus).not.toHaveBeenCalled();
    // The ONLY order-row write allowed here is the timeline note — never
    // items, total, subtotal, prices, or a status rewrite.
    for (const call of prisma.order.update.mock.calls) {
      const data = call[0].data;
      expect(data).not.toHaveProperty('items');
      expect(data).not.toHaveProperty('total');
      expect(data).not.toHaveProperty('subtotal');
      expect(data).not.toHaveProperty('statusId');
      expect(data).not.toHaveProperty('discount');
    }
    // The ignored delta is recorded, not silently dropped.
    const noted =
      prisma.order.update.mock.calls.some((c: any[]) =>
        JSON.stringify(c[0].data?.timeline ?? '').includes('BR-17'),
      );
    expect(noted).toBe(true);
  });

  it('a disallowed store-side transition fails closed (SKIPPED + issue, no throw)', async () => {
    const { svc, orders, runs } = buildIngest(mockPrisma());
    const prisma = (svc as any).prisma;
    prisma.storeOrderMapping.findUnique.mockResolvedValue({ ...MAPPING });
    prisma.storeOrderStatusMap.findUnique.mockResolvedValue({ internalStatusName: 'Delivered' });
    prisma.orderStatus.findFirst.mockResolvedValue({ id: 'st-del', name: 'Delivered' });
    (orders.updateStatus as jest.Mock).mockRejectedValue(
      new Error('Cannot transition from "Confirmed" to "Delivered". Allowed: Hold, Packed'),
    );

    const res = await svc.ingest('s1', {
      id: 'ext-2', status: 'completed', total: 500, currency: 'BDT',
      createdAt: '2026-09-21T11:00:00.000Z', items: [],
    }, { type: 'RECONCILE', runId: 'run-1' });

    expect(res).toMatchObject({ created: false, status: 'Confirmed', statusChanged: false });
    expect(runs.upsertIssue).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ORDER_STATUS_RECONCILE_FAILED' }),
    );
    expect(runs.recordItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'SKIPPED' }),
    );
  });

  it('mapping carries the status mirror P7 pushes from (no push in P6)', async () => {
    const { svc, prisma } = buildIngest(mockPrisma());
    prisma.store.findUnique.mockResolvedValue({ id: 's1', kind: 'CUSTOM', name: 'Bridge' });
    prisma.storeOrderMapping.findUnique.mockResolvedValue(null);
    prisma.storeOrderStatusMap.findUnique.mockResolvedValue({ internalStatusName: 'Confirmed' });
    prisma.orderStatus.findFirst.mockResolvedValue({ id: 'st-c', name: 'Confirmed' });
    prisma.storeSkuMapping.findUnique.mockResolvedValue(null);
    prisma.productVariant.findUnique.mockResolvedValue(null);
    prisma.product.findFirst.mockResolvedValue(null);
    (svc as any).ordersServiceOrNull.create.mockResolvedValue({ id: 'ord-9', status: { name: 'Confirmed' }, total: 99 });

    await svc.ingest('s1', {
      id: 'ext-9', status: 'cancelled', total: 99, currency: 'BDT',
      createdAt: '2026-09-24T14:00:00.000Z', items: [],
    }, { type: 'WEBHOOK', runId: 'run-1' });

    // Mapping persists the external status mirror + order link; the cancel →
    // provider-target translation itself is P7 (no pushOrderStatus call here).
    expect(prisma.storeOrderMapping.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeId: 's1',
          externalOrderId: 'ext-9',
          orderId: 'ord-9',
          lastExternalStatus: 'cancelled',
        }),
      }),
    );
  });
});
