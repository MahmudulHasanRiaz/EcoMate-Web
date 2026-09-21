/**
 * P2 cost-capture tests — per-payment-row gateway fees (§3.2, F3-safe).
 *
 * feeAmount is written on the payment row inside the verify transaction;
 * P&L counts it only while the row is PAID (reversal drops it structurally).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PaymentStatus } from '@prisma/client';
import { PaymentsService } from '../payments.service';
import { VerifyPaymentDto } from '../../orders/dto/order.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';

describe('VerifyPaymentDto feeAmount', () => {
  it('accepts a non-negative fee', async () => {
    const dto = plainToInstance(VerifyPaymentDto, {
      status: PaymentStatus.PAID,
      feeAmount: 12.5,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects negative fees', async () => {
    const dto = plainToInstance(VerifyPaymentDto, {
      status: PaymentStatus.PAID,
      feeAmount: -1,
    });
    expect((await validate(dto)).length).toBeGreaterThanOrEqual(1);
  });
});

describe('PaymentsService.verify fee capture', () => {
  let service: PaymentsService;
  const txMocks: any = {
    payment: { findUnique: jest.fn(), update: jest.fn(), aggregate: jest.fn() },
    order: { findUnique: jest.fn(), update: jest.fn() },
    $queryRawUnsafe: jest.fn(),
  };
  const mockPrisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(txMocks)),
  };
  const mockCache: any = {
    invalidateByPrefix: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();
    service = module.get(PaymentsService);
    txMocks.payment.findUnique.mockResolvedValue({
      id: 'pay1',
      orderId: 'o1',
      notes: null,
    });
    txMocks.payment.update.mockImplementation(async (args: any) => ({
      id: 'pay1',
      ...args.data,
    }));
    txMocks.payment.aggregate.mockResolvedValue({ _sum: { amount: 100 } });
    txMocks.order.findUnique.mockResolvedValue({ total: 100 });
    txMocks.order.update.mockResolvedValue({});
  });

  it('persists feeAmount on the verified payment row', async () => {
    const updated = await service.verify(
      'pay1',
      { status: PaymentStatus.PAID, feeAmount: 12 } as any,
      'staff-1',
    );
    expect(txMocks.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay1' },
      data: expect.objectContaining({ feeAmount: 12 }),
    });
    expect(updated).toMatchObject({ feeAmount: 12 });
  });

  it('leaves feeAmount untouched when not provided', async () => {
    await service.verify(
      'pay1',
      { status: PaymentStatus.PAID } as any,
      'staff-1',
    );
    const data = txMocks.payment.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('feeAmount');
  });

  it('drops analytics:* after verify (P2 §6)', async () => {
    await service.verify(
      'pay1',
      { status: PaymentStatus.PAID, feeAmount: 12 } as any,
      'staff-1',
    );
    expect(mockCache.invalidateByPrefix).toHaveBeenCalledWith('analytics:');
  });
});
