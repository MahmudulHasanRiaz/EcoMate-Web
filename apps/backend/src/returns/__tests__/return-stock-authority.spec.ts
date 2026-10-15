import { Test, TestingModule } from '@nestjs/testing';
import { ReturnsService } from '../returns.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';

/**
 * Return/Exchange hardening (2): STOCK AUTHORITY (ReturnsService level).
 *
 * ALL restore callers funnel through the guarded core
 * (restoreStockForReturnTx — flag + status set in the SAME tx as the
 * movement). Double calls are no-ops; the ORDER is never written here.
 *
 * RED phase: restoreStockForReturn does not exist yet.
 */
describe('ReturnsService — stock authority funnel (hardening 2)', () => {
  let service: ReturnsService;
  let prisma: any;
  let cancelReturnStock: any;

  const stored = {
    id: 'ret-1',
    orderId: 'order-1',
    displayId: 'RTN-260101-0001',
    type: 'FULL',
    status: 'REQUESTED',
    source: 'STAFF',
    courier: null,
    items: [{ productId: 'prod-1', variantId: null, quantity: 2 }],
    stockReconciled: false,
    stockReconciledAt: null,
  };

  beforeEach(async () => {
    const tx = {
      return: {
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'ret-1', ...data }),
        ),
        update: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'ret-1', ...stored, ...data }),
        ),
        findUnique: jest.fn().mockResolvedValue({ ...stored }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          displayId: 'ORD-260101-0001',
          trashedAt: null,
          status: { name: 'Shipping' },
          items: [],
        }),
      },
      return: {
        create: tx.return.create,
        update: tx.return.update,
        findUnique: jest.fn().mockResolvedValue({ ...stored }),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      refund: { findUnique: jest.fn().mockResolvedValue({ id: 'refund-1' }) },
      dispatch: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
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

  it('receive twice → exactly one restore (second is a no-op)', async () => {
    const first = await service.markReceived('ret-1', { performedBy: 'staff@x.com' });
    expect(first).toMatchObject({ status: 'RESTOCKED', stockReconciled: true });
    expect(cancelReturnStock.restoreForReturnItems).toHaveBeenCalledTimes(1);

    // The stored row is now reconciled — a repeat receive restores nothing.
    prisma.return.findUnique.mockResolvedValue({
      ...stored,
      status: 'RESTOCKED',
      stockReconciled: true,
    });
    const second = await service.markReceived('ret-1', { performedBy: 'staff@x.com' });
    expect(second).toMatchObject({ status: 'RESTOCKED' });
    expect(cancelReturnStock.restoreForReturnItems).toHaveBeenCalledTimes(1);
  });

  it('restoreStockForReturn funnel: double call → one restore, order untouched', async () => {
    await service.restoreStockForReturn('ret-1', { performedBy: 'staff@x.com' });
    expect(cancelReturnStock.restoreForReturnItems).toHaveBeenCalledTimes(1);

    prisma.return.findUnique.mockResolvedValue({
      ...stored,
      status: 'RESTOCKED',
      stockReconciled: true,
    });
    await service.restoreStockForReturn('ret-1', { performedBy: 'staff@x.com' });
    expect(cancelReturnStock.restoreForReturnItems).toHaveBeenCalledTimes(1);
    // Stock authority never writes the order — status changes are status-only.
    expect(prisma.order.update).toBeUndefined();
  });

  it('double-scan of the same return (order barcode + return id) is idempotent', async () => {
    // First scan: REQUESTED → RESTOCKED via the funnel.
    await service.restoreStockForReturn('ret-1', { performedBy: 'scanner' });
    expect(cancelReturnStock.restoreForReturnItems).toHaveBeenCalledTimes(1);

    // Second scan of the same return id: flag-guarded no-op.
    prisma.return.findUnique.mockResolvedValue({
      ...stored,
      status: 'RESTOCKED',
      stockReconciled: true,
    });
    const again = await service.restoreStockForReturn('ret-1', { performedBy: 'scanner' });
    expect(again).toMatchObject({ status: 'RESTOCKED', stockReconciled: true });
    expect(cancelReturnStock.restoreForReturnItems).toHaveBeenCalledTimes(1);
  });
});
