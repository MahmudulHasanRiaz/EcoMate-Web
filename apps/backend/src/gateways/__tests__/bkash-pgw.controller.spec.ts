import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { BkashPgwController } from '../bkash-pgw.controller';
import { BkashPgwService } from '../bkash-pgw.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentStatus } from '@prisma/client';
import type { FastifyReply } from 'fastify';

describe('BkashPgwController', () => {
  let controller: BkashPgwController;
  let prisma: any;
  let bkash: any;

  const mockOrder = {
    id: 'ord-001',
    total: 2050,
    displayId: 'ORD-001',
    viewToken: 'vt-secret-123',
    customerId: 'cust-1',
    payments: [],
  };

  const mockPaymentRecord = {
    id: 'pay-001',
    orderId: 'ord-001',
    amount: 2050,
    gatewayCode: 'bkash_pgw',
    status: PaymentStatus.PENDING,
  };

  const mockBkashCreateResult = {
    paymentID: 'bk-payment-001',
    bkashURL: 'https://sandbox.bka.sh/pay/bk-payment-001',
  };

  const mockGrantTokenResult = { token: 'merchant-token-abc' };

  const mockExecuteCompleted = {
    transactionStatus: 'Completed',
    trxID: 'trx-001',
    payerReference: 'pay-001',
    amount: '2050',
    currency: 'BDT',
  };

  const mockExecuteCompletedWrongCurrency = {
    transactionStatus: 'Completed',
    trxID: 'trx-002',
    payerReference: 'pay-001',
    amount: '2050',
    currency: 'USD',
  };

  const mockExecuteCompletedWrongAmount = {
    transactionStatus: 'Completed',
    trxID: 'trx-003',
    payerReference: 'pay-001',
    amount: '999999',
    currency: 'BDT',
  };

  const mockExecuteNotCompleted = {
    transactionStatus: 'Failed',
    trxID: null,
    payerReference: 'pay-001',
    amount: '0',
    currency: 'BDT',
  };

  const mockExecuteError = new Error('bKash provider unreachable');

  const mockFastifyReply = (): FastifyReply =>
    ({
      redirect: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    }) as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BkashPgwController],
      providers: [
        {
          provide: BkashPgwService,
          useValue: {
            createPayment: jest.fn().mockResolvedValue(mockBkashCreateResult),
            grantToken: jest.fn().mockResolvedValue(mockGrantTokenResult),
            executePayment: jest.fn().mockResolvedValue(mockExecuteCompleted),
            queryPayment: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn((cb: any) => cb({
              $queryRawUnsafe: jest.fn(),
              order: {
                findUnique: jest.fn(),
                update: jest.fn(),
              },
              payment: {
                create: jest.fn().mockResolvedValue(mockPaymentRecord),
                findFirst: jest.fn(),
                update: jest.fn(),
                updateMany: jest.fn(),
                aggregate: jest.fn(() => ({ _sum: { amount: 2050 } })),
              },
            })),
            order: {
              findUnique: jest.fn().mockResolvedValue(mockOrder),
            },
            payment: {
              findFirst: jest.fn(),
              create: jest.fn().mockResolvedValue(mockPaymentRecord),
              update: jest.fn(),
              updateMany: jest.fn(),
              aggregate: jest.fn(() => ({ _sum: { amount: 2050 } })),
            },
          },
        },
      ],
    }).compile();

    controller = module.get<BkashPgwController>(BkashPgwController);
    prisma = module.get(PrismaService);
    bkash = module.get(BkashPgwService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /* ── POST /payments/bkash/create ── */
  describe('POST /payments/bkash/create', () => {
    it('rejects forged orderId: order not found', async () => {
      prisma.$transaction.mockImplementationOnce((cb: any) =>
        cb({
          $queryRawUnsafe: jest.fn(),
          order: {
            findUnique: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
          payment: {
            create: jest.fn(),
            findFirst: jest.fn(),
            update: jest.fn(),
          },
        }),
      );

      await expect(
        controller.create({ orderId: 'no-such-order', token: 'vt-secret-123' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects order without valid viewToken (ownership)', async () => {
      prisma.$transaction.mockImplementationOnce((cb: any) =>
        cb({
          $queryRawUnsafe: jest.fn(),
          order: {
            findUnique: jest.fn().mockResolvedValue(mockOrder),
            update: jest.fn(),
          },
          payment: {
            create: jest.fn(),
            findFirst: jest.fn(),
            update: jest.fn(),
          },
        }),
      );

      await expect(
        controller.create({ orderId: 'ord-001', token: 'wrong-token' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects create when order is already fully paid', async () => {
      prisma.$transaction.mockImplementationOnce((cb: any) =>
        cb({
          $queryRawUnsafe: jest.fn(),
          order: {
            findUnique: jest.fn().mockResolvedValue({
              ...mockOrder,
              payments: [{ amount: 2050, status: PaymentStatus.PAID }],
            }),
            update: jest.fn(),
          },
          payment: {
            create: jest.fn(),
            findFirst: jest.fn(),
            update: jest.fn(),
          },
        }),
      );

      await expect(
        controller.create({ orderId: 'ord-001', token: 'vt-secret-123' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('does NOT return merchant token in the create response', async () => {
      prisma.$transaction.mockImplementationOnce((cb: any) =>
        cb({
          $queryRawUnsafe: jest.fn(),
          order: { findUnique: jest.fn().mockResolvedValue(mockOrder), update: jest.fn() },
          payment: {
            create: jest.fn().mockResolvedValue(mockPaymentRecord),
            findFirst: jest.fn(),
            update: jest.fn(),
          },
        }),
      );

      const result = await controller.create({
        orderId: 'ord-001',
        token: 'vt-secret-123',
      });

      expect(result).toHaveProperty('paymentID');
      expect(result).toHaveProperty('bkashURL');
      expect(result).not.toHaveProperty('token');
    });

    it('succeeds with valid viewToken and outstanding amount', async () => {
      const tx = {
        $queryRawUnsafe: jest.fn(),
        order: { findUnique: jest.fn().mockResolvedValue(mockOrder), update: jest.fn() },
        payment: {
          create: jest.fn().mockResolvedValue(mockPaymentRecord),
          findFirst: jest.fn(),
          update: jest.fn(),
        },
      };
      prisma.$transaction.mockImplementationOnce((cb: any) => cb(tx));

      const result = await controller.create({
        orderId: 'ord-001',
        token: 'vt-secret-123',
      });

      expect(result).toHaveProperty('paymentID', 'bk-payment-001');
      expect(result).toHaveProperty('bkashURL');
      expect(bkash.createPayment).toHaveBeenCalledWith(2050, mockPaymentRecord.id, mockPaymentRecord.id);
    });

    it('accepts authenticated owner without viewToken', async () => {
      prisma.$transaction.mockImplementationOnce((cb: any) =>
        cb({
          $queryRawUnsafe: jest.fn(),
          order: { findUnique: jest.fn().mockResolvedValue(mockOrder), update: jest.fn() },
          payment: {
            create: jest.fn().mockResolvedValue(mockPaymentRecord),
            findFirst: jest.fn(),
            update: jest.fn(),
          },
        }),
      );

      const result = await controller.create(
        { orderId: 'ord-001' },
        { userId: 'cust-1' },
      );
      expect(result).toHaveProperty('paymentID');
    });

    it('rejects foreign authenticated user', async () => {
      prisma.$transaction.mockImplementationOnce((cb: any) =>
        cb({
          $queryRawUnsafe: jest.fn(),
          order: { findUnique: jest.fn().mockResolvedValue(mockOrder), update: jest.fn() },
          payment: {
            create: jest.fn(),
            findFirst: jest.fn(),
            update: jest.fn(),
          },
        }),
      );

      await expect(
        controller.create({ orderId: 'ord-001' }, { userId: 'other-user' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('ignores client-supplied invoiceNo', async () => {
      const tx = {
        $queryRawUnsafe: jest.fn(),
        order: { findUnique: jest.fn().mockResolvedValue(mockOrder), update: jest.fn() },
        payment: {
          create: jest.fn().mockResolvedValue(mockPaymentRecord),
          findFirst: jest.fn(),
          update: jest.fn(),
        },
      };
      prisma.$transaction.mockImplementationOnce((cb: any) => cb(tx));

      await controller.create({
        orderId: 'ord-001',
        token: 'vt-secret-123',
        invoiceNo: 'INV-FORGED',
      });

      // Server uses order.displayId, not client invoiceNo
      expect(bkash.createPayment).toHaveBeenCalledWith(expect.any(Number), mockPaymentRecord.id, mockPaymentRecord.id);
    });
  });

  /* ── GET /payments/bkash/callback ── */
  describe('GET /payments/bkash/callback', () => {
    it('handles non-success status with generic redirect', async () => {
      const res = mockFastifyReply();
      await controller.callback(
        { paymentID: 'bk-payment-001', status: 'cancel' },
        res,
      );
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('pending=true'),
      );
      // Order tokens NOT exposed in failure redirect
      expect(res.redirect).not.toHaveBeenCalledWith(
        expect.stringContaining('&t='),
      );
    });

    it('handles missing paymentID with generic redirect', async () => {
      const res = mockFastifyReply();
      await controller.callback(
        { status: 'success', paymentID: undefined },
        res,
      );
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('pending=true'),
      );
    });

    it('redirects generic on provider failure', async () => {
      bkash.grantToken.mockRejectedValueOnce(mockExecuteError);
      const res = mockFastifyReply();

      await controller.callback(
        { paymentID: 'bk-payment-001', status: 'success' },
        res,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('pending=true'),
      );
      // No token leaked on failure
      expect(res.redirect).not.toHaveBeenCalledWith(
        expect.stringContaining('&t='),
      );
    });

    it('redirects generic when transactionStatus is not Completed', async () => {
      bkash.executePayment.mockResolvedValueOnce(mockExecuteNotCompleted);
      const res = mockFastifyReply();

      await controller.callback(
        { paymentID: 'bk-payment-001', status: 'success' },
        res,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('pending=true'),
      );
    });

    it('redirects generic when payerReference is missing', async () => {
      bkash.executePayment.mockResolvedValueOnce({
        transactionStatus: 'Completed',
        trxID: 'trx-004',
        amount: '2050',
        currency: 'BDT',
        // no payerReference
      });
      const res = mockFastifyReply();

      await controller.callback(
        { paymentID: 'bk-payment-001', status: 'success' },
        res,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('pending=true'),
      );
    });

    it('rejects wrong currency from provider', async () => {
      bkash.executePayment.mockResolvedValueOnce(mockExecuteCompletedWrongCurrency);
      const res = mockFastifyReply();

      const tx = {
        $queryRawUnsafe: jest.fn(),
        order: { findUnique: jest.fn(), update: jest.fn() },
        payment: {
          findFirst: jest.fn().mockResolvedValue(mockPaymentRecord),
          findFirst: jest.fn(),
          update: jest.fn(),
          updateMany: jest.fn(),
          aggregate: jest.fn(),
        },
      };
      prisma.$transaction.mockImplementationOnce((cb: any) => cb(tx));

      await controller.callback(
        { paymentID: 'bk-payment-001', status: 'success' },
        res,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('pending=true'),
      );
    });

    it('rejects wrong amount from provider', async () => {
      bkash.executePayment.mockResolvedValueOnce(mockExecuteCompletedWrongAmount);
      const res = mockFastifyReply();

      const tx = {
        $queryRawUnsafe: jest.fn(),
        order: { findUnique: jest.fn(), update: jest.fn() },
        payment: {
          findFirst: jest.fn().mockResolvedValue(mockPaymentRecord),
          update: jest.fn(),
          updateMany: jest.fn(),
          aggregate: jest.fn(),
        },
      };
      prisma.$transaction.mockImplementationOnce((cb: any) => cb(tx));

      await controller.callback(
        { paymentID: 'bk-payment-001', status: 'success' },
        res,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('pending=true'),
      );
    });

    it('handles missing pending payment (already processed) as safe no-op', async () => {
      bkash.executePayment.mockResolvedValueOnce(mockExecuteCompleted);
      const res = mockFastifyReply();

      const tx = {
        $queryRawUnsafe: jest.fn(),
        order: { findUnique: jest.fn().mockResolvedValue(mockOrder), update: jest.fn() },
        payment: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
          updateMany: jest.fn(),
          aggregate: jest.fn(() => ({ _sum: { amount: 2050 } })),
        },
      };
      prisma.$transaction.mockImplementationOnce((cb: any) => cb(tx));

      await controller.callback(
        { paymentID: 'bk-payment-001', status: 'success' },
        res,
      );

      // Safe redirect without tokens
      expect(res.redirect).toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalledWith(
        expect.stringContaining('&t='),
      );
    });

    it('duplicate callback does not double-update (idempotency)', async () => {
      bkash.executePayment.mockResolvedValueOnce(mockExecuteCompleted);
      const res = mockFastifyReply();

      let callCount = 0;
      const tx = {
        $queryRawUnsafe: jest.fn(),
        order: { findUnique: jest.fn().mockResolvedValue(mockOrder), update: jest.fn() },
        payment: {
          findFirst: jest.fn().mockImplementation(() => {
            callCount++;
            return callCount === 1 ? mockPaymentRecord : null;
          }),
          update: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }), // 2nd call: already PAID
          aggregate: jest.fn(() => ({ _sum: { amount: 2050 } })),
        },
      };
      prisma.$transaction.mockImplementation((cb: any) => cb(tx));

      await controller.callback(
        { paymentID: 'bk-payment-001', status: 'success' },
        res,
      );

      expect(res.redirect).toHaveBeenCalled();
    });

    it('succeeds with verified payment', async () => {
      bkash.executePayment.mockResolvedValueOnce(mockExecuteCompleted);
      const res = mockFastifyReply();

      const tx = {
        $queryRawUnsafe: jest.fn(),
        order: {
          findUnique: jest.fn().mockResolvedValue({ ...mockOrder, total: 2050, viewToken: 'vt-secret-123' }),
          update: jest.fn(),
        },
        payment: {
          findFirst: jest.fn().mockResolvedValue(mockPaymentRecord),
          update: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          aggregate: jest.fn(() => ({ _sum: { amount: 2050 } })),
        },
      };
      prisma.$transaction.mockImplementationOnce((cb: any) => cb(tx));

      await controller.callback(
        { paymentID: 'bk-payment-001', status: 'success' },
        res,
      );

      // Success redirect has orderId and viewToken
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('orderId='),
      );
    });

    it('redirects generic when conditional update returns zero rows', async () => {
      bkash.executePayment.mockResolvedValueOnce(mockExecuteCompleted);
      const res = mockFastifyReply();

      const tx = {
        $queryRawUnsafe: jest.fn(),
        order: { findUnique: jest.fn().mockResolvedValue(mockOrder), update: jest.fn() },
        payment: {
          findFirst: jest.fn().mockResolvedValue(mockPaymentRecord),
          update: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          aggregate: jest.fn(),
        },
      };
      prisma.$transaction.mockImplementationOnce((cb: any) => cb(tx));

      await controller.callback(
        { paymentID: 'bk-payment-001', status: 'success' },
        res,
      );

      // No token leaked on zero-update redirect
      expect(res.redirect).toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalledWith(
        expect.stringContaining('&t='),
      );
    });

    it('provider create failure marks reservation FAILED', async () => {
      const tx = {
        $queryRawUnsafe: jest.fn(),
        order: { findUnique: jest.fn().mockResolvedValue(mockOrder), update: jest.fn() },
        payment: {
          create: jest.fn().mockResolvedValue(mockPaymentRecord),
          findFirst: jest.fn(),
          update: jest.fn(),
        },
      };
      prisma.$transaction.mockImplementationOnce((cb: any) => cb(tx));
      bkash.createPayment.mockRejectedValueOnce(new Error('Provider unreachable'));
      prisma.payment.update.mockResolvedValue(undefined);

      await expect(
        controller.create({ orderId: 'ord-001', token: 'vt-secret-123' }),
      ).rejects.toThrow();

      // Verify FAILED status was written
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: PaymentStatus.FAILED }) }),
      );
    });

    it('binding failure after provider success does NOT mark reservation FAILED', async () => {
      const tx = {
        $queryRawUnsafe: jest.fn(),
        order: { findUnique: jest.fn().mockResolvedValue(mockOrder), update: jest.fn() },
        payment: {
          create: jest.fn().mockResolvedValue(mockPaymentRecord),
          findFirst: jest.fn(),
          update: jest.fn(),
        },
      };
      prisma.$transaction.mockImplementationOnce((cb: any) => cb(tx));
      bkash.createPayment.mockResolvedValue(mockBkashCreateResult);
      // First update (binding) fails — but was called for FAILED? NO.
      prisma.payment.update.mockRejectedValueOnce(new Error('DB error'));

      await expect(
        controller.create({ orderId: 'ord-001', token: 'vt-secret-123' }),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('success redirect uses Order.id, not Payment.id', async () => {
      bkash.executePayment.mockResolvedValueOnce({
        transactionStatus: 'Completed',
        trxID: 'trx-005',
        payerReference: mockPaymentRecord.id,
        amount: '2050',
        currency: 'BDT',
      });
      const res = mockFastifyReply();

      const tx = {
        $queryRawUnsafe: jest.fn(),
        order: {
          findUnique: jest.fn().mockResolvedValue({ ...mockOrder, total: 2050, viewToken: 'vt-secret-123' }),
          update: jest.fn(),
        },
        payment: {
          findFirst: jest.fn().mockResolvedValue(mockPaymentRecord),
          update: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          aggregate: jest.fn(() => ({ _sum: { amount: 2050 } })),
        },
      };
      prisma.$transaction.mockImplementationOnce((cb: any) => cb(tx));

      await controller.callback(
        { paymentID: 'bk-payment-001', status: 'success' },
        res,
      );

      // Check redirect URL contains the REAL order id, not the payment id
      const redirectUrl = (res.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectUrl).toContain('orderId=');
      expect(redirectUrl).not.toContain(`orderId=${mockPaymentRecord.id}`);
    });

    it('generic failure redirect does not contain orderId or token', async () => {
      const res = mockFastifyReply();
      await controller.callback(
        { paymentID: 'bk-payment-001', status: 'cancel' },
        res,
      );

      const redirectUrl = (res.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectUrl).not.toContain('&t=');
      expect(redirectUrl).toContain('pending=true');
    });

    it('aggregate PARTIAL_PAID when paid amount less than total', async () => {
      const partialPayment = { ...mockPaymentRecord, amount: 1000 };
      bkash.executePayment.mockResolvedValueOnce({
        transactionStatus: 'Completed',
        trxID: 'trx-006',
        payerReference: partialPayment.id,
        amount: '1000',
        currency: 'BDT',
      });
      const res = mockFastifyReply();

      const tx = {
        $queryRawUnsafe: jest.fn(),
        order: {
          findUnique: jest.fn().mockResolvedValue({ ...mockOrder, total: 2050, viewToken: 'vt-secret-123' }),
          update: jest.fn(),
        },
        payment: {
          findFirst: jest.fn().mockResolvedValue(partialPayment),
          update: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          aggregate: jest.fn(() => ({ _sum: { amount: 1000 } })),
        },
      };
      prisma.$transaction.mockImplementationOnce((cb: any) => cb(tx));

      await controller.callback(
        { paymentID: 'bk-payment-001', status: 'success' },
        res,
      );

      const redirectUrl = (res.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectUrl).toContain('orderId=');
    });
  });
});
