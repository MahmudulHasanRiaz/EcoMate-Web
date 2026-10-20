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

  beforeEach(async () => {
    prisma = {
      orderStatus: { findMany: async () => [] },
      order: {
        findMany: jest.fn(async ({ where }: any) =>
          where.returnOfOrderId ? [] : [order()],
        ),
      },
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
});
