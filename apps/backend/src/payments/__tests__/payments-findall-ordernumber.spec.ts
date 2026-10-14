import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PaymentsService } from '../payments.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * D-B: staff find payments by ORDER NUMBER (displayId, e.g. ORD-260818-0013),
 * not by raw UUID. The service resolves displayId→orderId via the existing
 * order lookup and 404s on an unknown number.
 */
describe('PaymentsService.findAll — orderNumber (D-B)', () => {
  let service: PaymentsService;
  const mockPrisma: any = {
    payment: { findMany: jest.fn(), count: jest.fn() },
    order: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(PaymentsService);
  });

  it('resolves orderNumber (displayId) to the order rows', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({ id: 'order-1' });
    mockPrisma.payment.findMany.mockResolvedValue([
      { id: 'pay-1', orderId: 'order-1' },
    ]);
    mockPrisma.payment.count.mockResolvedValue(1);

    const result = await service.findAll({ orderNumber: 'ORD-001' });

    expect(mockPrisma.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { displayId: 'ORD-001' } }),
    );
    expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orderId: 'order-1' }),
      }),
    );
    expect(result.data).toHaveLength(1);
  });

  it('404s on an unknown orderNumber without touching the ledger', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(null);

    await expect(service.findAll({ orderNumber: 'ORD-NOPE' })).rejects.toThrow(
      NotFoundException,
    );
    expect(mockPrisma.payment.findMany).not.toHaveBeenCalled();
  });

  it('keeps exact-orderId filtering when orderNumber is absent', async () => {
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.payment.count.mockResolvedValue(0);

    await service.findAll({ orderId: 'order-9' });

    expect(mockPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orderId: 'order-9' }),
      }),
    );
  });
});
