import { Test, TestingModule } from '@nestjs/testing';
import { ReturnsService } from '../returns.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';

describe('ReturnsService — damaged after receive', () => {
  let service: ReturnsService;
  let prisma: any;
  let cancelReturnStock: any;
  let tx: any;

  const restocked = {
    id: 'ret-1',
    orderId: 'order-1',
    displayId: 'RTN-260101-0001',
    type: 'PARTIAL',
    status: 'RESTOCKED',
    source: 'COURIER',
    items: [
      {
        productId: 'p1',
        variantId: null,
        quantity: 3,
        damagedQuantity: 0,
        damageLog: [],
        warehouseId: 'wh-1',
      },
    ],
    stockReconciled: true,
    stockReconciledAt: new Date('2026-10-10T00:00:00Z'),
    receivedAt: new Date('2026-10-10T00:00:00Z'),
  };

  beforeEach(async () => {
    tx = {
      return: {
        update: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ ...restocked, ...data }),
        ),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({ status: { name: 'Delivered' } }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          displayId: 'ORD-260101-0001',
          status: { name: 'Delivered' },
          items: [],
        }),
      },
      return: {
        findUnique: jest.fn().mockResolvedValue({ ...restocked }),
        update: tx.return.update,
      },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    cancelReturnStock = {
      damageWriteOff: jest.fn().mockResolvedValue({ managed: false, warehouseId: 'wh-1' }),
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

  it('writes off stock and appends a later damage event in the same transaction', async () => {
    const updated = await service.markDamaged(
      'ret-1',
      [{ productId: 'p1', quantity: 1 }],
      'staff@x.com',
    );

    expect(cancelReturnStock.damageWriteOff).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'p1',
        quantity: 1,
        warehouseId: 'wh-1',
        tx,
      }),
    );
    const items = tx.return.update.mock.calls[0][0].data.items as any[];
    expect(items[0].damagedQuantity).toBe(1);
    expect(items[0].damageLog).toEqual([
      expect.objectContaining({ qty: 1, phase: 'later', by: 'staff@x.com' }),
    ]);
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(updated).toMatchObject({ id: 'ret-1' });
  });

  it('rejects quantities above the remaining good quantity — nothing is written', async () => {
    await expect(
      service.markDamaged('ret-1', [{ productId: 'p1', quantity: 4 }], 'staff@x.com'),
    ).rejects.toThrow(/only 3 good unit/i);
    expect(cancelReturnStock.damageWriteOff).not.toHaveBeenCalled();
    expect(tx.return.update).not.toHaveBeenCalled();
  });

  it('rejects damage on a line whose only unit arrived damaged (0 restocked good)', async () => {
    prisma.return.findUnique.mockResolvedValue({
      ...restocked,
      items: [
        {
          productId: 'p1',
          variantId: null,
          quantity: 1,
          damagedQuantity: 1,
          damageLog: [
            {
              qty: 1,
              at: '2026-10-10T00:00:00.000Z',
              phase: 'receive',
              by: 'staff@x.com',
            },
          ],
          warehouseId: 'wh-1',
        },
      ],
    });

    await expect(
      service.markDamaged('ret-1', [{ productId: 'p1', quantity: 1 }], 'staff@x.com'),
    ).rejects.toThrow(/only 0 good unit/i);
    expect(cancelReturnStock.damageWriteOff).not.toHaveBeenCalled();
    expect(tx.return.update).not.toHaveBeenCalled();
  });

  it('refuses damage before the return is received', async () => {
    prisma.return.findUnique.mockResolvedValue({
      ...restocked,
      status: 'REQUESTED',
      stockReconciled: false,
    });
    await expect(
      service.markDamaged('ret-1', [{ productId: 'p1', quantity: 1 }], 'staff@x.com'),
    ).rejects.toThrow(/receive this return/i);
  });

  it('refuses a CLOSED return', async () => {
    prisma.return.findUnique.mockResolvedValue({
      ...restocked,
      status: 'CLOSED',
    });
    await expect(
      service.markDamaged('ret-1', [{ productId: 'p1', quantity: 1 }], 'staff@x.com'),
    ).rejects.toThrow(/closed/i);
    expect(cancelReturnStock.damageWriteOff).not.toHaveBeenCalled();
  });

  it('propagates the stock authority failure and writes nothing', async () => {
    cancelReturnStock.damageWriteOff.mockRejectedValue(
      new Error('Only 0 unit(s) available at this warehouse — cannot mark 1 damaged.'),
    );
    await expect(
      service.markDamaged('ret-1', [{ productId: 'p1', quantity: 1 }], 'staff@x.com'),
    ).rejects.toThrow(/available/i);
    expect(tx.return.update).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
