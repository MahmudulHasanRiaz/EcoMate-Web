import { Test, TestingModule } from '@nestjs/testing';
import { ReturnReceivePurpose } from '../return-receive.purpose';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReturnsService } from '../../../returns/returns.service';

/**
 * Return/Exchange hardening (3): SCAN RESOLUTION (backend part).
 *
 * A return/exchange scan mode resolving an ORDER barcode → linked
 * returns/exchanges: exactly one → returned; several → list for the picker;
 * none → 404 "No active return/exchange for this order." The order itself is
 * NEVER marked. (Admin picker UI is phase 2 — structured data is returned.)
 *
 * RED phase: the purpose does not exist yet.
 */
describe('ReturnReceivePurpose — return/exchange scan resolution (hardening 3)', () => {
  let purpose: ReturnReceivePurpose;
  let prisma: any;
  let returns: any;

  const actor = { userId: 'user-1', email: 'staff@ecomate.com' };

  const saleOrder = (over: any = {}) => ({
    id: 'order-1',
    displayId: 'ORD-260930-0001',
    kind: 'SALE',
    status: { id: 'st-shipping', name: 'Shipping', nextStatuses: [] },
    trashedAt: null,
    ...over,
  });

  const activeReturn = (over: any = {}) => ({
    id: 'ret-1',
    displayId: 'RTN-260930-0001',
    orderId: 'order-1',
    type: 'PARTIAL',
    status: 'REQUESTED',
    stockReconciled: false,
    createdAt: new Date('2026-10-14T00:00:00Z'),
    ...over,
  });

  function setup(opts: {
    order?: any;
    returns?: any[];
    exchanges?: any[];
    products?: any[];
    variants?: any[];
  }) {
    const order = opts.order ?? saleOrder();
    prisma = {
      orderStatus: { findMany: async () => [{ id: 'st-shipping', name: 'Shipping' }] },
      order: {
        findFirst: async () => (order ? { ...order, dispatches: [] } : null),
        findUnique: async ({ where }: any) =>
          order && where.id === order.id ? order : null,
        findMany: async () => opts.exchanges ?? [],
        update: jest.fn(),
      },
      product: {
        findMany: async ({ where }: any) =>
          (opts.products ?? []).filter((p: any) => where?.id?.in?.includes(p.id)),
      },
      productVariant: {
        findMany: async ({ where }: any) =>
          (opts.variants ?? []).filter((v: any) => where?.id?.in?.includes(v.id)),
      },
      dispatch: { findMany: async () => [] },
      return: {
        findMany: async () => opts.returns ?? [],
        findUnique: async ({ where }: any) =>
          (opts.returns ?? []).find((r: any) => r.id === where.id) ?? null,
      },
    };
    returns = {
      restoreStockForReturn: jest.fn().mockImplementation(async (id: string) => ({
        ...(opts.returns ?? []).find((r: any) => r.id === id),
        status: 'RESTOCKED',
        stockReconciled: true,
      })),
    };
    return { prisma, returns };
  }

  async function build(opts: Parameters<typeof setup>[0] = {}) {
    setup(opts);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReturnReceivePurpose,
        { provide: PrismaService, useValue: prisma },
        { provide: ReturnsService, useValue: returns },
      ],
    }).compile();
    purpose = module.get<ReturnReceivePurpose>(ReturnReceivePurpose);
  }

  it('resolves an order barcode to its single linked return', async () => {
    await build({ returns: [activeReturn()] });
    const outcome = await purpose.resolve('ORD-260930-0001');
    expect(outcome.status).toBe('resolved');
    expect(outcome.linked).toHaveLength(1);
    expect(outcome.linked?.[0]).toMatchObject({
      kind: 'return',
      id: 'ret-1',
      displayId: 'RTN-260930-0001',
    });
  });

  it('returns a picker list when several returns/exchanges are linked', async () => {
    await build({
      returns: [activeReturn(), activeReturn({ id: 'ret-2', displayId: 'RTN-260930-0002' })],
      exchanges: [{ id: 'ex-1', displayId: 'EX-260930-0001', status: { name: 'Confirmed' } }],
    });
    const outcome = await purpose.resolve('ORD-260930-0001');
    expect(outcome.status).toBe('selection_required');
    expect(outcome.linked).toHaveLength(3);
    expect(outcome.linked?.map((l: any) => l.kind).sort()).toEqual(
      ['exchange', 'return', 'return'],
    );
  });

  it('404s with a clear message when nothing is linked', async () => {
    await build({ returns: [], exchanges: [] });
    const outcome = await purpose.resolve('ORD-260930-0001');
    expect(outcome.status).toBe('not_found');
    expect(outcome.message).toBe('No active return/exchange for this order.');
  });

  it('execute with a return id receives it without touching the order', async () => {
    await build({ returns: [activeReturn()] });
    const res = await purpose.execute({ identifier: 'ORD-260930-0001', returnId: 'ret-1' }, actor);
    expect(res.status).toBe('success');
    expect(returns.restoreStockForReturn).toHaveBeenCalledTimes(1);
    expect(returns.restoreStockForReturn).toHaveBeenCalledWith(
      'ret-1',
      expect.objectContaining({ performedBy: 'staff@ecomate.com' }),
    );
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('double-scan of the same return id is a duplicate (no second restore)', async () => {
    await build({
      returns: [activeReturn({ status: 'RESTOCKED', stockReconciled: true })],
    });
    const res = await purpose.execute({ identifier: 'ORD-260930-0001', returnId: 'ret-1' }, actor);
    expect(res.status).toBe('duplicate');
    expect(returns.restoreStockForReturn).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it("execute accepts the Return's own RTN display id (no order cross-check needed)", async () => {
    await build({ returns: [activeReturn()] });
    // A Return Order may not exist for a staff-created Return; even if the
    // generic resolver matches an unrelated RTN order, the scanned value IS
    // this leg's own display id — the cross-order guard must not misfire.
    (prisma.order.findFirst as any) = async () => ({
      ...saleOrder(),
      id: 'order-9',
      displayId: 'RTN-260930-0001',
    });
    const res = await purpose.execute(
      { identifier: 'RTN-260930-0001', returnId: 'ret-1' },
      actor,
    );
    expect(res.status).toBe('success');
    expect(returns.restoreStockForReturn).toHaveBeenCalledWith(
      'ret-1',
      expect.objectContaining({ performedBy: 'staff@ecomate.com' }),
    );
  });

  it('execute rejects a return id that belongs to another order', async () => {
    await build({
      returns: [activeReturn({ id: 'ret-x', orderId: 'order-9', displayId: 'RTN-9' })],
    });
    const res = await purpose.execute({ identifier: 'ORD-260930-0001', returnId: 'ret-x' }, actor);
    expect(res.status).toBe('error');
    expect(returns.restoreStockForReturn).not.toHaveBeenCalled();
  });

  it('execute without a selection asks the picker to choose (never marks the order)', async () => {
    await build({ returns: [activeReturn()] });
    const res = await purpose.execute({ identifier: 'ORD-260930-0001' }, actor);
    expect(res.status).toBe('error');
    expect(returns.restoreStockForReturn).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('execute with an exchange id returns info with zero mutations', async () => {
    await build({
      exchanges: [{ id: 'ex-1', displayId: 'EX-260930-0001', status: { name: 'Confirmed' } }],
    });
    (prisma.order.findUnique as any) = async ({ where }: any) =>
      where.id === 'ex-1'
        ? { id: 'ex-1', displayId: 'EX-260930-0001', exchangeOfOrderId: 'order-1' }
        : saleOrder();
    const res = await purpose.execute({ identifier: 'ORD-260930-0001', exchangeId: 'ex-1' }, actor);
    expect(res.status).toBe('success');
    expect(returns.restoreStockForReturn).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('enriches the linked return candidate with returned-line previews, units and stage-time processability', async () => {
    await build({
      order: saleOrder({ items: [{ quantity: 3 }, { quantity: 2 }] }),
      returns: [activeReturn({ items: [{ productId: 'p-1', variantId: 'v-1', quantity: 2 }] })],
      products: [{ id: 'p-1', name: 'Panjabi', sku: 'PNJ', images: ['/uploads/p1.jpg'] }],
      variants: [
        {
          id: 'v-1',
          sku: 'PNJ-RD-XL',
          image: '/uploads/p1-rd.jpg',
          images: ['/uploads/p1-rd.jpg'],
          product: { id: 'p-1', name: 'Panjabi', images: ['/uploads/p1.jpg'] },
          attributeValues: [
            { attributeValue: { value: 'Red', hexCode: '#f00', attribute: { name: 'Color' } } },
          ],
        },
      ],
    });
    const outcome = await purpose.resolve('ORD-260930-0001');
    expect(outcome.status).toBe('resolved');
    const leg = (outcome.linked ?? [])[0] as any;
    expect(leg.coversUnits).toBe(2);
    expect(leg.orderUnits).toBe(5);
    expect(leg.orderDisplayId).toBe('ORD-260930-0001');
    expect(leg.processable).toBe(true);
    expect(leg.image).toBe('/uploads/p1-rd.jpg');
    expect(leg.items).toEqual([
      {
        productId: 'p-1',
        variantId: 'v-1',
        name: 'Panjabi',
        variantLabel: 'Color: Red',
        sku: 'PNJ-RD-XL',
        image: '/uploads/p1-rd.jpg',
        quantity: 2,
        maxQuantity: 2,
      },
    ]);
  });

  it('supplies order-line previews and an unconfirmed flag when the courier reported no split', async () => {
    await build({
      order: saleOrder({
        items: [
          {
            quantity: 3,
            productId: 'p-1',
            variantId: null,
            product: { id: 'p-1', name: 'Panjabi', sku: 'PNJ', images: [] },
          },
        ],
      }),
      returns: [activeReturn({ items: [] })],
    });
    const leg = (await purpose.resolve('ORD-260930-0001').then((o) => o.linked ?? []))[0] as any;
    expect(leg.itemsConfirmed).toBe(false);
    expect(leg.items).toEqual([
      expect.objectContaining({
        productId: 'p-1',
        name: 'Panjabi',
        quantity: 3,
        maxQuantity: 3,
      }),
    ]);
  });

  it('execute forwards confirmed quantities and receive damage to the guarded restore', async () => {
    await build({ returns: [activeReturn()] });
    await purpose.execute(
      {
        identifier: 'ORD-260930-0001',
        returnId: 'ret-1',
        items: [
          { productId: 'p-1', variantId: null, quantity: 3, damagedQuantity: 1 },
        ],
      },
      actor,
    );
    expect(returns.restoreStockForReturn).toHaveBeenCalledWith(
      'ret-1',
      expect.objectContaining({
        items: [
          { productId: 'p-1', variantId: null, quantity: 3, damagedQuantity: 1 },
        ],
      }),
    );
  });

  it('reports good units restored and damaged units NOT restocked in the feed result', async () => {
    await build({ returns: [activeReturn()] });
    returns.restoreStockForReturn.mockResolvedValue({
      id: 'ret-1',
      displayId: 'RTN-260930-0001',
      status: 'RESTOCKED',
      stockReconciled: true,
      items: [
        { productId: 'p-1', variantId: null, quantity: 3, damagedQuantity: 1 },
      ],
    });
    const result = await purpose.execute(
      {
        identifier: 'ORD-260930-0001',
        returnId: 'ret-1',
        items: [{ productId: 'p-1', variantId: null, quantity: 3, damagedQuantity: 1 }],
      },
      actor,
    );
    expect(result.status).toBe('success');
    expect(result.message).toBe('Return received — 2 restored · 1 damaged (not restocked).');
    expect(result.details).toMatchObject({ receivedUnits: 3, damagedUnits: 1 });
  });

  it('a customer-report-free (unknown-split) return leg carries an empty items list', async () => {
    await build({ returns: [activeReturn({ items: [] })] });
    const leg = (await purpose.resolve('ORD-260930-0001').then((o) => o.linked ?? []))[0] as any;
    expect(leg.items).toEqual([]);
    expect(leg.image).toBeNull();
    expect(leg.coversUnits).toBe(0);
    expect(leg.processable).toBe(true);
    // Nothing to restore while the split is unconfirmed — still stageable.
  });

  it('an already-received return leg is stageable but NOT processable — operator sees the reason', async () => {
    await build({
      returns: [activeReturn({ status: 'RESTOCKED', stockReconciled: true, items: [{ productId: 'p-1', quantity: 1 }] })],
      products: [{ id: 'p-1', name: 'Panjabi', sku: 'PNJ', images: [] }],
    });
    const leg = (await purpose.resolve('ORD-260930-0001').then((o) => o.linked ?? []))[0] as any;
    expect(leg.processable).toBe(false);
    expect(String(leg.reason)).toContain('Already received');
  });

  it('exchange legs carry the exchange order items from the SAME fetch and process as info-only', async () => {
    await build({
      exchanges: [
        {
          id: 'ex-1',
          displayId: 'EX-260930-0001',
          status: { name: 'Confirmed' },
          items: [
            {
              productId: 'p-2',
              variantId: null,
              quantity: 1,
              price: 750,
              product: { id: 'p-2', name: 'New Panjabi', sku: 'PNJ2', images: ['/uploads/new.jpg'] },
            },
          ],
        },
      ],
    });
    const leg = (await purpose.resolve('ORD-260930-0001').then((o) => o.linked ?? []))[0] as any;
    expect(leg.kind).toBe('exchange');
    expect(leg.items).toEqual([
      { productId: 'p-2', variantId: null, name: 'New Panjabi', variantLabel: undefined, sku: 'PNJ2', image: '/uploads/new.jpg', quantity: 1, maxQuantity: 1, price: 750 },
    ]);
    expect(leg.processable).toBe(true);
    expect(leg.reason).toBeNull();
  });

  it('exchange legs fall back to the exchange order-line product when the variant has no own image/sku', async () => {
    await build({
      exchanges: [
        {
          id: 'ex-2',
          displayId: 'EX-260930-0002',
          status: { name: 'Confirmed' },
          items: [
            {
              productId: 'p-4',
              variantId: 'v-4',
              quantity: 1,
              price: 800,
              // production include shape: top-level product carries images+sku
              product: { id: 'p-4', name: 'Kurti', sku: 'KRT', images: ['/uploads/k1.jpg'] },
              variant: {
                id: 'v-4', sku: null, image: null, images: [],
                product: { id: 'p-4', name: 'Kurti' }, // thin nested select
                attributeValues: [],
              },
            },
          ],
        },
      ],
    });
    const leg = (await purpose.resolve('ORD-260930-0001').then((o) => o.linked ?? []))[0] as any;
    expect(leg.items).toEqual([
      { productId: 'p-4', variantId: 'v-4', name: 'Kurti', variantLabel: undefined, sku: 'KRT', image: '/uploads/k1.jpg', quantity: 1, maxQuantity: 1, price: 800 },
    ]);
  });

  it('caps linked-leg item previews at 50 lines (payload stays bounded on huge exchanges)', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      productId: `p-${i}`,
      variantId: null,
      quantity: 1,
      price: 100,
      product: { id: `p-${i}`, name: `Item ${i}`, sku: `SKU-${i}`, images: [] },
    }));
    await build({
      exchanges: [{ id: 'ex-3', displayId: 'EX-260930-0003', status: { name: 'Confirmed' }, items: many }],
    });
    const leg = (await purpose.resolve('ORD-260930-0001').then((o) => o.linked ?? []))[0] as any;
    expect(leg.items.length).toBe(50);
    expect(leg.coversUnits).toBe(60); // units stay truthful — only the PREVIEWS are capped
  });
});
