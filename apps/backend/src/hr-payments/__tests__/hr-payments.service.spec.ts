import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { HrPaymentsService } from '../hr-payments.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('HrPaymentsService', () => {
  let service: HrPaymentsService;
  let prisma: PrismaService;

  const mockPayslip = (status: string, netPay = '47000') => ({
    id: 'ps-1',
    employeeId: 'emp-1',
    status,
    netPay,
  });

  const prismaMock = {
    $transaction: jest.fn((cb: any) => cb(prismaMock)),
    payslip: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    payrollPayment: {
      aggregate: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrPaymentsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<HrPaymentsService>(HrPaymentsService);
    prisma = module.get<PrismaService>(PrismaService);

    prismaMock.payslip.findUnique.mockReset();
    prismaMock.payslip.update.mockReset();
    prismaMock.payrollPayment.aggregate.mockReset();
    prismaMock.payrollPayment.create.mockReset();
    prismaMock.payrollPayment.findMany.mockReset();
    prismaMock.payrollPayment.findUnique.mockReset();
    prismaMock.payrollPayment.update.mockReset();
  });

  describe('createPayment', () => {
    it('rejects payment for a non-approved payslip', async () => {
      prismaMock.payslip.findUnique.mockResolvedValue(mockPayslip('draft'));
      await expect(
        service.createPayment(
          { payslipId: 'ps-1', amount: 1000 },
          'actor-1',
        ),
      ).rejects.toThrow('Payslip must be approved before payment');
    });

    it('rejects payment that exceeds net pay', async () => {
      prismaMock.payslip.findUnique.mockResolvedValue(mockPayslip('approved'));
      prismaMock.payrollPayment.aggregate.mockResolvedValue({
        _sum: { amount: null },
      });
      await expect(
        service.createPayment(
          { payslipId: 'ps-1', amount: 50000 },
          'actor-1',
        ),
      ).rejects.toThrow('Payment exceeds net pay');
    });

    it('marks the payslip paid when the full net pay is covered', async () => {
      prismaMock.payslip.findUnique.mockResolvedValue(mockPayslip('approved'));
      prismaMock.payrollPayment.aggregate.mockResolvedValue({
        _sum: { amount: '0' },
      });
      prismaMock.payrollPayment.create.mockResolvedValue({
        id: 'pay-1',
        amount: '47000',
      });
      const update = jest
        .spyOn(prismaMock.payslip, 'update')
        .mockResolvedValue(mockPayslip('paid'));
      await prismaMock.$transaction.mockImplementationOnce((cb: any) =>
        cb(prismaMock),
      );

      const res = await service.createPayment(
        { payslipId: 'ps-1', amount: 47000 },
        'actor-1',
      );
      expect(res.payslip.status).toBe('paid');
      expect(update.mock.calls[0][0].data).toHaveProperty('paidAt');
    });

    it('marks the payslip partially_paid for a partial payment', async () => {
      prismaMock.payslip.findUnique.mockResolvedValue(mockPayslip('approved'));
      prismaMock.payrollPayment.aggregate.mockResolvedValue({
        _sum: { amount: '0' },
      });
      prismaMock.payrollPayment.create.mockResolvedValue({
        id: 'pay-1',
        amount: '20000',
      });
      const update = jest
        .spyOn(prismaMock.payslip, 'update')
        .mockResolvedValue(mockPayslip('partially_paid'));
      await prismaMock.$transaction.mockImplementationOnce((cb: any) =>
        cb(prismaMock),
      );

      const res = await service.createPayment(
        { payslipId: 'ps-1', amount: 20000 },
        'actor-1',
      );
      expect(res.payslip.status).toBe('partially_paid');
      expect(update.mock.calls[0][0].data).not.toHaveProperty('paidAt');
    });

    it('throws NotFound when the payslip is missing', async () => {
      prismaMock.payslip.findUnique.mockResolvedValue(null);
      await expect(
        service.createPayment({ payslipId: 'ps-x', amount: 1000 }, 'a'),
      ).rejects.toThrow(NotFoundException);
    });

    it('excludes VOIDED payments from the paid-so-far sum', async () => {
      prismaMock.payslip.findUnique.mockResolvedValue(mockPayslip('approved'));
      prismaMock.payrollPayment.aggregate.mockResolvedValue({
        _sum: { amount: '10000' },
      });
      prismaMock.payrollPayment.create.mockResolvedValue({
        id: 'pay-2',
        amount: '5000',
      });
      jest
        .spyOn(prismaMock.payslip, 'update')
        .mockResolvedValue(mockPayslip('partially_paid'));

      await service.createPayment(
        { payslipId: 'ps-1', amount: 5000 },
        'actor-1',
      );

      expect(prismaMock.payrollPayment.aggregate).toHaveBeenCalledWith({
        where: { payslipId: 'ps-1', voidedAt: null },
        _sum: { amount: true },
      });
    });
  });

  describe('voidPayment (G-20)', () => {
    const payment = (overrides: any = {}) => ({
      id: 'pay-1',
      payslipId: 'ps-1',
      amount: '47000',
      voidedAt: null,
      voidedById: null,
      voidReason: null,
      ...overrides,
    });

    it('voids a payment and records reason + actor', async () => {
      prismaMock.payslip.findUnique.mockResolvedValue(mockPayslip('paid'));
      prismaMock.payrollPayment.findUnique.mockResolvedValue(payment());
      prismaMock.payrollPayment.update.mockResolvedValue({
        ...payment(),
        voidedAt: new Date(),
        voidedById: 'actor-9',
        voidReason: 'Duplicate entry',
      });
      prismaMock.payrollPayment.aggregate.mockResolvedValue({
        _sum: { amount: null },
      });
      const update = jest
        .spyOn(prismaMock.payslip, 'update')
        .mockResolvedValue(mockPayslip('approved'));

      const res = await service.voidPayment(
        'ps-1',
        'pay-1',
        'Duplicate entry',
        'actor-9',
      );

      expect(prismaMock.payrollPayment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: expect.objectContaining({
          voidedAt: expect.any(Date),
          voidedById: 'actor-9',
          voidReason: 'Duplicate entry',
        }),
      });
      expect(res.payslip.status).toBe('approved');
      expect(update.mock.calls[0][0].data.paidAt).toBeNull();
    });

    it('downgrades paid → partially_paid when some valid payment remains', async () => {
      prismaMock.payslip.findUnique.mockResolvedValue(mockPayslip('paid'));
      prismaMock.payrollPayment.findUnique.mockResolvedValue(payment());
      prismaMock.payrollPayment.aggregate.mockResolvedValue({
        _sum: { amount: '20000' },
      });
      const update = jest
        .spyOn(prismaMock.payslip, 'update')
        .mockResolvedValue(mockPayslip('partially_paid'));

      const res = await service.voidPayment('ps-1', 'pay-1', 'Refund noted');

      expect(res.payslip.status).toBe('partially_paid');
      expect(update.mock.calls[0][0].data.status).toBe('partially_paid');
      expect(update.mock.calls[0][0].data.paidAt).toBeNull();
    });

    it('requires a reason (400)', async () => {
      prismaMock.payslip.findUnique.mockResolvedValue(mockPayslip('paid'));
      prismaMock.payrollPayment.findUnique.mockResolvedValue(payment());
      await expect(
        service.voidPayment('ps-1', 'pay-1', '  '),
      ).rejects.toThrow('reason is required to void a payment');
    });

    it('rejects a double void (400)', async () => {
      prismaMock.payslip.findUnique.mockResolvedValue(mockPayslip('paid'));
      prismaMock.payrollPayment.findUnique.mockResolvedValue(
        payment({ voidedAt: new Date() }),
      );
      await expect(
        service.voidPayment('ps-1', 'pay-1', 'again'),
      ).rejects.toThrow('Payment is already voided');
    });

    it('throws NotFound for a missing payslip or foreign payment', async () => {
      prismaMock.payslip.findUnique.mockResolvedValue(null);
      await expect(
        service.voidPayment('ps-x', 'pay-1', 'why'),
      ).rejects.toThrow(NotFoundException);

      prismaMock.payslip.findUnique.mockResolvedValue(mockPayslip('paid'));
      prismaMock.payrollPayment.findUnique.mockResolvedValue(null);
      await expect(
        service.voidPayment('ps-1', 'pay-nope', 'why'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
