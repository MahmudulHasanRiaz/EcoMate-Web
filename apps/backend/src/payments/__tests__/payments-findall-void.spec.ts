import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from '../payments.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * D-C actuals-only ledger: legacy cash/UNPAID placeholders are VOID-marked
 * by migration (never deleted). The payment list shows real rows only —
 * VOID is excluded by default; an explicit status=VOID filter still audits
 * them. All money sums were already ΣPAID-only, so VOID changes nothing
 * there — this locks the list contract.
 */
describe('PaymentsService.findAll — VOID exclusion (D-C)', () => {
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

  it('excludes VOID rows by default', async () => {
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.payment.count.mockResolvedValue(0);

    await service.findAll({});

    expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: 'VOID' } }),
      }),
    );
    expect(mockPrisma.payment.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: 'VOID' } }),
      }),
    );
  });

  it('keeps the VOID exclusion alongside other filters', async () => {
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.payment.count.mockResolvedValue(0);

    await service.findAll({ orderId: 'order-9', gatewayCode: 'cash' });

    expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orderId: 'order-9',
          gatewayCode: 'cash',
          status: { not: 'VOID' },
        }),
      }),
    );
  });

  it('honours an explicit status filter (VOID auditable on demand)', async () => {
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.payment.count.mockResolvedValue(0);

    await service.findAll({ status: 'VOID' });

    expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'VOID' }) }),
    );
  });
});
