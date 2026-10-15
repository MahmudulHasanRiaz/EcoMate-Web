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

  function setup(opts: { order?: any; returns?: any[]; exchanges?: any[] }) {
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
});
