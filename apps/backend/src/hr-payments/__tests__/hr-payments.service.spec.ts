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
      delete: jest.fn(),
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
    prismaMock.payrollPayment.delete.mockReset();
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
  });
});
