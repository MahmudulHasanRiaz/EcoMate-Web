import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SuppliersService } from '../suppliers.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('SuppliersService — Part 5 payment destination', () => {
  let service: SuppliersService;
  const prisma: any = {
    supplier: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    paymentGateway: {
      findUnique: jest.fn(),
    },
    account: {
      findUnique: jest.fn(),
    },
    supplierPaymentInvoice: {
      findFirst: jest.fn(),
    },
    supplierPayment: {
      create: jest.fn(),
    },
    $transaction: jest.fn((cb: any) => cb(prisma)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.supplier.findUnique.mockResolvedValue({
      id: 'sup-1',
      balance: 5000,
    });
    prisma.paymentGateway.findUnique.mockResolvedValue({
      id: 'gw-bkash',
      code: 'bkash',
      name: 'bKash',
      enabled: true,
      type: 'manual',
      accountId: 'acc-bkash',
    });
    prisma.supplierPaymentInvoice.findFirst.mockResolvedValue(null);
    prisma.supplierPayment.create.mockResolvedValue({ id: 'sp-1' });
    prisma.supplier.update.mockResolvedValue({ id: 'sup-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppliersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(SuppliersService);
  });

  it('stamps the configured gateway account on supplier payments', async () => {
    await service.createPayment('sup-1', {
      amount: 1000,
      paymentMethod: 'bkash',
    } as any);

    expect(prisma.supplierPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentMethod: 'bkash',
          accountId: 'acc-bkash',
        }),
      }),
    );
  });

  it('rejects an unknown supplier-payment gateway code', async () => {
    prisma.paymentGateway.findUnique.mockResolvedValue(null);

    await expect(
      service.createPayment('sup-1', {
        amount: 1000,
        paymentMethod: 'made_up',
      } as any),
    ).rejects.toThrow(/Unknown payment gateway/i);
    expect(prisma.supplierPayment.create).not.toHaveBeenCalled();
  });

  it('rejects a supplier-payment account that is not an eligible asset leaf', async () => {
    prisma.account.findUnique.mockResolvedValue({
      id: 'acc-expense',
      code: '5001',
      name: 'Expense',
      type: 'expense',
      isGroup: false,
      isActive: true,
    });

    await expect(
      service.createPayment('sup-1', {
        amount: 1000,
        accountId: 'acc-expense',
      } as any),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.supplierPayment.create).not.toHaveBeenCalled();
  });
});
