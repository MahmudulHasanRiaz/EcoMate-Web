import { Test, TestingModule } from '@nestjs/testing';
import { ReturnPurpose } from '../return.purpose';
import { PrismaService } from '../../../prisma/prisma.service';
import { RtnService } from '../../../rtn/rtn.service';
import { resolveScanIdentifier } from '../../scanner-resolver';
import { withSchemaValidation } from '../../../testing/prisma-schema-guard';

/**
 * Regression: the scanner "Process return" resolve used to 500 in production
 * (2026-10-21) because the shared item include selected a scalar `image` from
 * Product — the model only has `images`. Prisma rejects the query with
 * "Unknown field `image` for select statement on model `Product`" and the
 * whole resolve blew up (the include feeds BOTH the order fetch and the
 * `returnOfOrderId` exchange fetch inside one Promise.all).
 *
 * The mocked Prisma never validated the query shape, so the unit tests were
 * green while production was down. These tests run the REAL query shapes
 * through a schema-aware mock (see testing/prisma-schema-guard.ts): an
 * invalid select now fails here instead of in production.
 */

jest.mock('../../scanner-resolver', () => {
  const actual = jest.requireActual('../../scanner-resolver');
  return { ...actual, resolveScanIdentifier: jest.fn() };
});

const mockedResolve = resolveScanIdentifier as jest.MockedFunction<
  typeof resolveScanIdentifier
>;

describe('ReturnPurpose — DISPATCH_RETURN resolve (real query shapes)', () => {
  let purpose: ReturnPurpose;
  let prisma: any;

  const orderItem = (over: any = {}) => ({
    productId: 'p1',
    variantId: 'v1',
    quantity: 1,
    price: 1250,
    product: { id: 'p1', name: 'Panjabi', sku: 'PNJ', images: ['/uploads/p1.jpg'] },
    variant: {
      id: 'v1',
      sku: 'PNJ-BLUE',
      image: null,
      images: [],
      product: { id: 'p1', name: 'Panjabi' },
      attributeValues: [],
    },
    ...over,
  });

  const order = (over: any = {}) => ({
    id: 'o1',
    displayId: 'ORD-260811-0004',
    kind: 'SALE',
    status: { id: 's-del', name: 'Delivered' },
    items: [orderItem()],
    returns: [],
    ...over,
  });

  beforeEach(async () => {
    prisma = withSchemaValidation({
      orderStatus: { findMany: async () => [{ id: 's-del', name: 'Delivered' }] },
      order: {
        findMany: jest.fn(async ({ where }: any) => {
          // The EXCHANGE leg (returnOfOrderId) — the second findMany of the
          // shared include. It must not break the resolve either.
          if (where.returnOfOrderId) {
            return [
              order({
                id: 'o1-exch',
                displayId: 'ORD-260811-0004-EX',
                kind: 'EXCHANGE',
                items: [orderItem({ productId: 'p2', product: { id: 'p2', name: 'Lungi', sku: 'LNG', images: ['/uploads/p2.jpg'] } })],
              }),
            ];
          }
          if (where.exchangeOfOrderId) return [];
          return [order()];
        }),
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 'o1' ? order() : null,
        ),
      },
      return: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      productVariant: { findMany: jest.fn().mockResolvedValue([]) },
      dispatch: {
        findUnique: jest.fn(async () => ({
          consignmentId: 'CONS-1',
          courier: 'pathao',
          status: 'RETURN_PENDING',
        })),
      },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReturnPurpose,
        { provide: PrismaService, useValue: prisma },
        { provide: RtnService, useValue: { finalizeDispatchReturn: jest.fn() } },
      ],
    }).compile();
    purpose = module.get(ReturnPurpose);
  });

  it('resolves a dispatch whose order has an exchange leg (no invalid select)', async () => {
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'CONS-1',
      dispatches: [
        { id: 'dsp-1', orderId: 'o1', courier: 'pathao', consignmentId: 'CONS-1', trackingCode: null, status: 'RETURN_PENDING' },
      ] as any,
      order: null,
    });

    // Before the fix this threw
    // "Unknown field `image` for select statement on model `Product`".
    const outcome = await purpose.resolve('CONS-1');

    const d = outcome.dispatches[0] as any;
    expect(d).toBeDefined();
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({
      productId: 'p1',
      name: 'Panjabi',
      sku: 'PNJ-BLUE',
    });
  });

  it('derives the item image from images[0] (Product has no scalar image)', async () => {
    mockedResolve.mockResolvedValue({
      status: 'resolved',
      identifier: 'CONS-1',
      dispatches: [
        { id: 'dsp-1', orderId: 'o1', courier: 'pathao', consignmentId: 'CONS-1', trackingCode: null, status: 'RETURN_PENDING' },
      ] as any,
      order: null,
    });

    const outcome = await purpose.resolve('CONS-1');
    const d = outcome.dispatches[0] as any;
    expect(d.items[0].image).toBe('/uploads/p1.jpg');
  });
});
