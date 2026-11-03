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

  it('order number with a dispatch AND an open return resolves to the leg only (dispatch suppressed)', async () => {
    // 2026-10-28: a dispatch and a Return row for one order are two faces of
    // ONE return. Dispatch finalize restores per order/RTN-order lines and
    // never touches Return rows, while leg receive restores per Return-row
    // quantities guarded only by that row's stockReconciled flag — neither
    // guard sees the other path, so processing both faces double-restores in
    // either order. The leg path (manual receive, WHO + WHEN, damage split)
    // owns the return once a Return row exists; the dispatch option is
    // suppressed, so the single leg auto-stages instead of opening a picker.
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'ORD-260930-0001',
      dispatches: [dispatch()] as any,
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
    });
  });

  it('duplicate linked legs (same return row twice) dedupe to one and auto-stage', async () => {
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'ORD-260930-0001',
      dispatches: [] as any,
      order: orderPreview() as any,
    });
    const ret = activeReturn({ items: [] });
    prisma.return.findMany.mockResolvedValue([ret, ret]);

    const outcome = await purpose.resolve('ORD-260930-0001');

    expect(outcome.status).toBe('resolved');
    expect(outcome.linked).toHaveLength(1);
    expect(outcome.linked?.[0]).toMatchObject({ id: 'ret-1' });
  });

  it('two rows sharing a displayId dedupe to one (same leg, data anomaly)', async () => {
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'ORD-260930-0001',
      dispatches: [] as any,
      order: orderPreview() as any,
    });
    prisma.return.findMany.mockResolvedValue([
      activeReturn({ id: 'ret-1', displayId: 'RTN-260930-0001', items: [] }),
      activeReturn({ id: 'ret-2', displayId: 'RTN-260930-0001', items: [] }),
    ]);

    const outcome = await purpose.resolve('ORD-260930-0001');

    expect(outcome.status).toBe('resolved');
    expect(outcome.linked).toHaveLength(1);
    expect(outcome.linked?.[0]).toMatchObject({ id: 'ret-1' });
  });

  it('two distinct open returns + a dispatch → picker with legs only', async () => {
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'ORD-260930-0001',
      dispatches: [dispatch()] as any,
      order: orderPreview() as any,
    });
    prisma.return.findMany.mockResolvedValue([
      activeReturn({ id: 'ret-1', displayId: 'RTN-260930-0001', items: [] }),
      activeReturn({ id: 'ret-2', displayId: 'RTN-260930-0002', items: [] }),
    ]);

    const outcome = await purpose.resolve('ORD-260930-0001');

    expect(outcome.status).toBe('selection_required');
    expect(outcome.dispatches).toHaveLength(0);
    expect(outcome.linked).toHaveLength(2);
    expect(outcome.message).toMatch(/select/i);
  });

  it('dispatch kept when no Return row covers the order (dispatch-only return)', async () => {
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'ORD-260930-0001',
      dispatches: [dispatch()] as any,
      order: orderPreview() as any,
    });
    prisma.return.findMany.mockResolvedValue([]);

    const outcome = await purpose.resolve('ORD-260930-0001');

    expect(outcome.status).toBe('resolved');
    expect(outcome.dispatches).toHaveLength(1);
    expect(outcome.dispatches[0]).toMatchObject({ id: 'dsp-1' });
    expect(outcome.linked).toHaveLength(0);
  });

  it('duplicate dispatches for one consignment dedupe to one and auto-stage', async () => {
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'ORD-260930-0001',
      dispatches: [
        dispatch({ id: 'dsp-1', consignmentId: 'CONS-1' }),
        dispatch({ id: 'dsp-2', consignmentId: 'CONS-1' }),
      ] as any,
      order: orderPreview() as any,
    });
    prisma.return.findMany.mockResolvedValue([]);

    const outcome = await purpose.resolve('ORD-260930-0001');

    expect(outcome.status).toBe('resolved');
    expect(outcome.dispatches).toHaveLength(1);
    expect(outcome.dispatches[0]).toMatchObject({ id: 'dsp-1' });
  });

  it('two distinct consignments → picker with both dispatches (genuinely ambiguous)', async () => {
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'ORD-260930-0001',
      dispatches: [
        dispatch({ id: 'dsp-1', consignmentId: 'CONS-1' }),
        dispatch({ id: 'dsp-2', consignmentId: 'CONS-2' }),
      ] as any,
      order: orderPreview() as any,
    });
    prisma.return.findMany.mockResolvedValue([]);

    const outcome = await purpose.resolve('ORD-260930-0001');

    expect(outcome.status).toBe('selection_required');
    expect(outcome.dispatches).toHaveLength(2);
    expect(outcome.linked).toHaveLength(0);
  });

  it('a lone exchange child is NOT a Process-return candidate — the dispatch auto-stages (owner rule 2026-11-04)', async () => {
    // Supersedes the pre-2026-11-04 expectation (picker with the exchange
    // face listed): an exchange ORDER is not a return, so it can never be
    // offered as a return option — in any order, in any case. With no
    // Return row covering the order, the returnable dispatch is the single
    // candidate and stages without a picker.
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'ORD-260930-0001',
      dispatches: [dispatch()] as any,
      order: orderPreview() as any,
    });
    prisma.return.findMany.mockResolvedValue([]);
    prisma.order.findMany.mockImplementation(async ({ where }: any) => {
      if (where.returnOfOrderId) return [];
      if (where.exchangeOfOrderId) {
        return [
          {
            id: 'o1-ex',
            displayId: 'ORD-260930-0009',
            status: { name: 'Delivered' },
            items: [],
          },
        ];
      }
      return [order()];
    });

    const outcome = await purpose.resolve('ORD-260930-0001');

    expect(outcome.status).toBe('resolved');
    expect(outcome.dispatches).toHaveLength(1);
    expect(outcome.linked).toHaveLength(0);
  });

  // ── Owner rule 2026-11-04: one exchange = ONE return option ─────────────

  const exchangeLeg = (over: any = {}) => ({
    id: 'ret-ex1',
    displayId: 'RTN-261104-0001',
    orderId: 'o1',
    type: 'EXCHANGE',
    status: 'REQUESTED',
    stockReconciled: false,
    exchangeOrderId: 'o1-ex',
    createdAt: new Date('2026-11-04T00:00:00Z'),
    items: [],
    ...over,
  });

  const exchangeChild = (over: any = {}) => ({
    id: 'o1-ex',
    displayId: 'Ex-261104-0003',
    status: { name: 'Delivered' },
    items: [],
    ...over,
  });

  function mockExchangeWorld(opts: { returns?: any[]; scannedId?: string } = {}) {
    const returns = opts.returns ?? [exchangeLeg()];
    prisma.return.findMany.mockImplementation(async ({ where }: any) =>
      returns.filter((r: any) => !where?.orderId || r.orderId === where.orderId),
    );
    prisma.order.findMany.mockImplementation(async ({ where }: any) => {
      if (where.returnOfOrderId) return [];
      if (where.exchangeOfOrderId) {
        return where.exchangeOfOrderId === 'o1' ? [exchangeChild()] : [];
      }
      return [order()];
    });
    prisma.order.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 'o1') return order();
      if (where.id === 'o1-ex') {
        return {
          id: 'o1-ex',
          displayId: 'Ex-261104-0003',
          exchangeOfOrderId: 'o1',
          items: [],
          status: { name: 'Delivered' },
        };
      }
      return null;
    });
  }

  it("the owner's exact case: original scan with an exchange return shows ONE option — the RTN leg, never the Ex- order", async () => {
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'ORD-261030-0017',
      dispatches: [],
      order: orderPreview({ displayId: 'ORD-261030-0017' }) as any,
    });
    mockExchangeWorld();

    const outcome = await purpose.resolve('ORD-261030-0017');

    expect(outcome.status).toBe('resolved');
    expect(outcome.dispatches).toHaveLength(0);
    expect(outcome.linked).toHaveLength(1);
    expect(outcome.linked?.[0]).toMatchObject({
      kind: 'return',
      labelKind: 'exchange',
      displayId: 'RTN-261104-0001',
      exchangeDisplayId: 'Ex-261104-0003',
    });
  });

  it('scanning the EXCHANGE order number finds that exchange’s return leg (scan-alias normalization)', async () => {
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'EX-261104-0003',
      dispatches: [],
      order: orderPreview({ id: 'o1-ex', displayId: 'Ex-261104-0003' }) as any,
    });
    mockExchangeWorld();

    const outcome = await purpose.resolve('Ex-261104-0003');

    expect(outcome.status).toBe('resolved');
    expect(outcome.linked).toHaveLength(1);
    expect(outcome.linked?.[0]).toMatchObject({
      kind: 'return',
      displayId: 'RTN-261104-0001',
    });
  });

  it('an exchange scan does NOT widen to the original’s other returns', async () => {
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'EX-261104-0003',
      dispatches: [],
      order: orderPreview({ id: 'o1-ex', displayId: 'Ex-261104-0003' }) as any,
    });
    mockExchangeWorld({
      returns: [
        exchangeLeg(),
        {
          id: 'ret-staff',
          displayId: 'RTN-261104-0002',
          orderId: 'o1',
          type: 'PARTIAL',
          status: 'REQUESTED',
          stockReconciled: false,
          exchangeOrderId: null,
          createdAt: new Date('2026-11-04T01:00:00Z'),
          items: [],
        },
      ],
    });

    const outcome = await purpose.resolve('Ex-261104-0003');

    expect(outcome.status).toBe('resolved');
    expect(outcome.linked).toHaveLength(1);
    expect(outcome.linked?.[0]).toMatchObject({ id: 'ret-ex1' });
  });

  it('two distinct exchanges on one original → picker with the two RTN legs ONLY (no Ex- faces)', async () => {
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'ORD-260930-0001',
      dispatches: [],
      order: orderPreview() as any,
    });
    const leg2 = exchangeLeg({
      id: 'ret-ex2',
      displayId: 'RTN-261104-0005',
      exchangeOrderId: 'o1-ex2',
    });
    prisma.return.findMany.mockResolvedValue([exchangeLeg(), leg2]);
    prisma.order.findMany.mockImplementation(async ({ where }: any) => {
      if (where.returnOfOrderId) return [];
      if (where.exchangeOfOrderId) {
        return [
          exchangeChild(),
          exchangeChild({ id: 'o1-ex2', displayId: 'Ex-261104-0007' }),
        ];
      }
      return [order()];
    });

    const outcome = await purpose.resolve('ORD-260930-0001');

    expect(outcome.status).toBe('selection_required');
    expect(outcome.linked).toHaveLength(2);
    expect(outcome.linked?.every((c: any) => c.kind === 'return')).toBe(true);
    expect(outcome.linked?.map((c: any) => c.displayId).sort()).toEqual([
      'RTN-261104-0001',
      'RTN-261104-0005',
    ]);
  });

  it('a lone exchange with no return leg and no dispatch → not_found that says no return was created', async () => {
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'ORD-260930-0001',
      dispatches: [],
      order: orderPreview() as any,
    });
    mockExchangeWorld({ returns: [] });

    const outcome = await purpose.resolve('ORD-260930-0001');

    expect(outcome.status).toBe('not_found');
    expect(outcome.linked).toHaveLength(0);
    expect(outcome.message).toMatch(/no return was created/i);
  });

  it('a return-order (RTN order) scan falls back to the parent original’s dispatch when nothing else matches', async () => {
    mockedResolve.mockImplementation(async (_prisma: any, id: string) => {
      if (String(id).toUpperCase().startsWith('ORD-')) {
        return {
          status: 'resolved',
          identifier: id,
          dispatches: [dispatch()] as any,
          order: orderPreview() as any,
        };
      }
      return {
        status: 'resolved',
        identifier: id,
        dispatches: [] as any,
        order: orderPreview({ id: 'o1-rtn', displayId: 'RTN-260930-0001' }) as any,
      };
    });
    prisma.return.findMany.mockResolvedValue([]);
    prisma.order.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 'o1-rtn') {
        return { id: 'o1-rtn', displayId: 'RTN-260930-0001', returnOfOrderId: 'o1' };
      }
      if (where.id === 'o1') return order();
      return null;
    });
    prisma.order.findMany.mockImplementation(async ({ where }: any) => {
      if (where.returnOfOrderId) return [];
      if (where.exchangeOfOrderId) return [];
      return [order()];
    });

    const outcome = await purpose.resolve('RTN-260930-0001');

    expect(outcome.status).toBe('resolved');
    expect(outcome.linked).toHaveLength(0);
    expect(outcome.dispatches).toHaveLength(1);
    expect(outcome.dispatches[0]).toMatchObject({ id: 'dsp-1' });
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
