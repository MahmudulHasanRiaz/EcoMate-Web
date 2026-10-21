import { Test, TestingModule } from '@nestjs/testing';
import { ReturnsService } from '../returns.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';

/**
 * Who received a return (owner rule, 2026-10-21).
 *
 * Receiving is ALWAYS a manual act by an employee — the scanner "Process
 * return", the detail page's "Mark received", or any other manual path. No
 * automated flow, courier webhook or status sync may EVER mark a return
 * received, so the receiver is never "system".
 *
 * `Return.receivedById` mirrors `Refund.processedBy`: a plain id column plus a
 * relation to UserProfile, so the "Received by" log always names a person.
 */
describe('ReturnsService — who received the return', () => {
  let service: ReturnsService;
  let prisma: any;
  let cancelReturnStock: any;
  let tx: any;

  const storedRow = {
    id: 'ret-1',
    displayId: 'RTN-261021-0001',
    orderId: 'order-1',
    type: 'FULL',
    status: 'REQUESTED',
    items: [{ productId: 'p-1', variantId: null, quantity: 2 }],
    stockReconciled: false,
    receivedAt: null,
    receivedById: null,
    courierStatus: null,
  };

  beforeEach(async () => {
    tx = {
      return: {
        findUnique: jest.fn().mockResolvedValue({ ...storedRow }),
        update: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'ret-1', ...data }),
        ),
      },
      orderItem: { findMany: jest.fn().mockResolvedValue([]) },
      // The staff actor resolves to a UserProfile id (like Refund.processedBy).
      userProfile: {
        findUnique: jest.fn().mockResolvedValue({ id: 'staff-profile-1' }),
      },
    };
    prisma = {
      return: {
        findUnique: jest.fn().mockResolvedValue({ ...storedRow }),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'ret-1', ...data }),
        ),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          displayId: 'ORD-1',
          trashedAt: null,
          status: { id: 'st', name: 'Return Pending' },
          items: [],
        }),
      },
      dispatch: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      userProfile: {
        findUnique: jest.fn().mockResolvedValue({ id: 'staff-profile-1' }),
      },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    cancelReturnStock = {
      restoreForReturnItems: jest.fn().mockResolvedValue({ restored: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReturnsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CancelReturnStockService, useValue: cancelReturnStock },
      ],
    }).compile();
    service = module.get<ReturnsService>(ReturnsService);
  });

  it('the staff receive stamps receivedById + receivedAt and moves the lifecycle status', async () => {
    await service.markReceived('ret-1', { performedBy: 'staff@ecomate.com' });

    // The final (RESTOCKED) write carries the receiver + the event date.
    const writes = tx.return.update.mock.calls.map((c: any[]) => c[0].data);
    const restocked = writes[writes.length - 1];
    expect(restocked.status).toBe('RESTOCKED');
    expect(restocked.receivedAt).toBeInstanceOf(Date);
    expect(restocked.receivedById).toBe('staff-profile-1');
    // The RECEIVED transition carries the same actor.
    expect(writes[0]).toMatchObject({
      status: 'RECEIVED',
      receivedById: 'staff-profile-1',
    });
  });

  it('an automated actor never becomes the receiver (null, never "system")', async () => {
    await service.markReceived('ret-1', { performedBy: 'system' });
    const writes = tx.return.update.mock.calls.map((c: any[]) => c[0].data);
    expect(writes[writes.length - 1].receivedById).toBeNull();
    // The automated actor is not even looked up as a staff profile.
    expect(tx.userProfile.findUnique).not.toHaveBeenCalled();
  });

  it('a staff member without a staff profile still receives (actor null, date kept)', async () => {
    tx.userProfile.findUnique.mockResolvedValue(null);
    await service.markReceived('ret-1', { performedBy: 'unknown@ecomate.com' });
    const writes = tx.return.update.mock.calls.map((c: any[]) => c[0].data);
    expect(writes[writes.length - 1].receivedById).toBeNull();
    expect(writes[writes.length - 1].receivedAt).toBeInstanceOf(Date);
  });

  it('the courier parcel-back signal records ONLY the courier status', async () => {
    await service.recordCourierParcelBack('ret-1', 'cancelled_return_received');

    expect(prisma.return.update).toHaveBeenCalledTimes(1);
    const data = prisma.return.update.mock.calls[0][0].data;
    expect(data).toEqual({ courierStatus: 'cancelled_return_received' });
    // NEVER a received state, never an actor, never a date.
    expect(data.status).toBeUndefined();
    expect(data.receivedAt).toBeUndefined();
    expect(data.receivedById).toBeUndefined();
  });
});
