import { Test, TestingModule } from '@nestjs/testing';
import { ReturnPurpose } from '../return.purpose';
import { PrismaService } from '../../../prisma/prisma.service';
import { RtnService } from '../../../rtn/rtn.service';
import { resolveScanIdentifier } from '../../scanner-resolver';

jest.mock('../../scanner-resolver', () => {
  const actual = jest.requireActual('../../scanner-resolver');
  return { ...actual, resolveScanIdentifier: jest.fn() };
});

const mockedResolve = resolveScanIdentifier as jest.MockedFunction<
  typeof resolveScanIdentifier
>;

describe('ReturnPurpose — DISPATCH_RETURN stage-time truth', () => {
  let purpose: ReturnPurpose;
  let prisma: any;
  let rtnService: any;

  const dispatch = (over: any = {}) => ({
    id: 'dsp-1',
    orderId: 'o1',
    courier: 'pathao',
    consignmentId: 'CONS-1',
    trackingCode: null,
    status: 'RETURN_PENDING',
    ...over,
  });

  const order = (over: any = {}) => ({
    id: 'o1',
    displayId: 'ORD-1',
    kind: 'SALE',
    status: { id: 's-del', name: 'Delivered' },
    items: [
      {
        productId: 'p1',
        variantId: null,
        quantity: 2,
        price: 100,
        product: { id: 'p1', name: 'Panjabi', sku: 'PNJ', images: [] },
      },
    ],
    returns: [],
    ...over,
  });

  const activeReturn = (over: any = {}) => ({
    id: 'ret-1',
    displayId: 'RTN-260930-0001',
    orderId: 'o1',
    type: 'PARTIAL',
    status: 'REQUESTED',
    stockReconciled: false,
    createdAt: new Date('2026-10-14T00:00:00Z'),
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      orderStatus: { findMany: async () => [{ id: 's-del', name: 'Delivered' }] },
      order: {
        findMany: jest.fn(async ({ where }: any) => {
          if (where.returnOfOrderId) return [];
          if (where.exchangeOfOrderId) return [];
          return [order()];
        }),
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 'o1' ? order() : null,
        ),
      },
      return: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      productVariant: { findMany: jest.fn().mockResolvedValue([]) },
      dispatch: {
        findUnique: jest.fn(async () => ({
          consignmentId: 'CONS-1',
          courier: 'pathao',
          status: 'RETURN_PENDING',
        })),
      },
    };
    rtnService = { finalizeDispatchReturn: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReturnPurpose,
        { provide: PrismaService, useValue: prisma },
        { provide: RtnService, useValue: rtnService },
      ],
    }).compile();
    purpose = module.get(ReturnPurpose);
  });

  it('returns the exact returning items + processability (no mutation)', async () => {
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'CONS-1',
      dispatches: [dispatch()] as any,
      order: null,
    });

    const outcome = await purpose.resolve('CONS-1');
    const d = outcome.dispatches[0] as any;
    expect(d.processable).toBe(true);
    expect(d.reason).toBeNull();
    expect(d.items).toEqual([
      expect.objectContaining({
        productId: 'p1',
        name: 'Panjabi',
        quantity: 2,
        maxQuantity: 2,
      }),
    ]);
  });

  it('does NOT flag a normal courier-webhook Return Pending scan for status alone', async () => {
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'CONS-1',
      dispatches: [dispatch()] as any,
      order: null,
    });
    prisma.order.findMany.mockImplementation(async ({ where }: any) =>
      where.returnOfOrderId
        ? []
        : [order({ status: { id: 's-rp', name: 'Return Pending' } })],
    );

    const outcome = await purpose.resolve('CONS-1');
    const d = outcome.dispatches[0] as any;
    expect(d.processable).toBe(true);
    expect(d.reason).toBeNull();
    expect(d.items[0]).toMatchObject({ productId: 'p1', quantity: 2 });
  });

  it('marks an already-settled dispatch as needs-attention with the reason', async () => {
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'CONS-1',
      dispatches: [dispatch({ status: 'RETURNED' })] as any,
      order: null,
    });
    prisma.order.findMany.mockImplementation(async ({ where }: any) =>
      where.returnOfOrderId
        ? []
        : [order({ status: { id: 's-returned', name: 'Returned' } })],
    );

    const outcome = await purpose.resolve('CONS-1');
    const d = outcome.dispatches[0] as any;
    expect(d.processable).toBe(false);
    expect(String(d.reason)).toMatch(/already returned/i);
  });

  it('forwards confirmed damage lines to the single finalize execution', async () => {
    rtnService.finalizeDispatchReturn.mockResolvedValue({
      outcome: 'returned',
      dispatch: {
        id: 'dsp-1',
        consignmentId: 'CONS-1',
        courier: 'pathao',
        status: 'RETURNED',
        oldStatus: 'RETURN_PENDING',
      },
      order: { id: 'o1', displayId: 'ORD-1', status: 'Returned' },
      rtn: null,
      restoredItems: [
        { productId: 'p1', variantId: null, quantity: 1, damagedQuantity: 1 },
      ],
    });

    const result = await purpose.execute(
      {
        identifier: 'CONS-1',
        dispatchId: 'dsp-1',
        items: [
          { productId: 'p1', variantId: null, quantity: 2, damagedQuantity: 1 },
        ],
      },
      { userId: 'u1', email: 'staff@x.com' },
    );

    expect(rtnService.finalizeDispatchReturn).toHaveBeenCalledTimes(1);
    expect(rtnService.finalizeDispatchReturn).toHaveBeenCalledWith(
      'dsp-1',
      { userId: 'u1', email: 'staff@x.com' },
      [{ productId: 'p1', variantId: null, quantity: 2, damagedQuantity: 1 }],
    );
    expect(result.status).toBe('success');
    expect(result.message).toMatch(/damaged/i);
  });

  // ── Merged "Process return" task: cross-kind resolve ────────────────────

  const orderPreview = (over: any = {}) => ({
    id: 'o1',
    displayId: 'ORD-260930-0001',
    status: 'Delivered',
    kind: 'SALE',
    allowedStatuses: [],
    customerName: 'Md. Rahim',
    customerPhone: '01700000001',
    itemCount: 2,
    orderTotal: 200,
    ...over,
  });

  it('tracking-code scan resolves the dispatch only — linked returns are never loaded', async () => {
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'TRK-9001',
      dispatches: [dispatch({ id: 'dsp-trk', consignmentId: null, trackingCode: 'TRK-9001' })] as any,
      order: null,
    });

    const outcome = await purpose.resolve('TRK-9001');

    expect(outcome.status).toBe('resolved');
    expect(outcome.dispatches).toHaveLength(1);
    expect(outcome.linked ?? []).toHaveLength(0);
    expect(prisma.return.findMany).not.toHaveBeenCalled();
  });

  it('order number with only an open return resolves to the linked leg (no dispatch)', async () => {
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'ORD-260930-0001',
      dispatches: [],
      order: orderPreview() as any,
    });
    prisma.return.findMany.mockResolvedValue([activeReturn({ items: [] })]);

    const outcome = await purpose.resolve('ORD-260930-0001');

    expect(outcome.status).toBe('resolved');
    expect(outcome.dispatches).toHaveLength(0);
    expect(outcome.linked).toHaveLength(1);
    expect(outcome.linked?.[0]).toMatchObject({
      kind: 'return',
      id: 'ret-1',
      displayId: 'RTN-260930-0001',
      labelKind: 'return',
    });
  });

  it('order number matching BOTH a dispatch and an open return → one picker with both kinds', async () => {
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'ORD-260930-0001',
      dispatches: [dispatch()] as any,
      order: orderPreview() as any,
    });
    prisma.return.findMany.mockResolvedValue([activeReturn({ items: [] })]);

    const outcome = await purpose.resolve('ORD-260930-0001');

    expect(outcome.status).toBe('selection_required');
    expect(outcome.dispatches).toHaveLength(1);
    expect(outcome.linked).toHaveLength(1);
    expect(outcome.message).toMatch(/select/i);
  });

  it('a staff Return RTN display id resolves to exactly that leg', async () => {
    const ret = activeReturn({ items: [] });
    prisma.return.findFirst.mockResolvedValue(ret);
    prisma.return.findMany.mockResolvedValue([ret]);
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'ORD-260930-0001',
      dispatches: [],
      order: orderPreview() as any,
    });

    const outcome = await purpose.resolve('RTN-260930-0001');

    expect(outcome.status).toBe('resolved');
    expect(outcome.dispatches).toHaveLength(0);
    expect(outcome.linked).toHaveLength(1);
    expect(outcome.linked?.[0]).toMatchObject({ id: 'ret-1', kind: 'return' });
  });

  it('an EXCHANGE Return RTN resolves to the return-receive leg labelled Exchange', async () => {
    const ret = activeReturn({
      id: 'ret-ex',
      displayId: 'RTN-260930-0009',
      type: 'EXCHANGE',
      items: [],
    });
    prisma.return.findFirst.mockResolvedValue(ret);
    prisma.return.findMany.mockResolvedValue([ret]);
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'ORD-260930-0001',
      dispatches: [],
      order: orderPreview() as any,
    });

    const outcome = await purpose.resolve('RTN-260930-0009');

    expect(outcome.status).toBe('resolved');
    // Internal kind stays 'return' (receive path with damaged controls) while
    // the plain operator label says Exchange.
    expect(outcome.linked?.[0]).toMatchObject({
      kind: 'return',
      labelKind: 'exchange',
      displayId: 'RTN-260930-0009',
    });
  });
});
