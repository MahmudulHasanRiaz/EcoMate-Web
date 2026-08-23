import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PayrollService } from '../payroll.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PayrollService', () => {
  let service: PayrollService;
  let prisma: PrismaService;

  const mockEmployee = {
    id: 'emp-1',
    employeeId: 'EMP-250624-0001',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    salary: '50000',
    status: 'active',
    joiningDate: new Date('2025-01-01'),
  };

  const mockSalaryStructure = {
    id: 'ss-1',
    employeeId: 'emp-1',
    basicSalary: '30000',
    houseAllowance: '10000',
    medicalAllowance: '5000',
    transportAllowance: '3000',
    otherAllowance: '2000',
    taxDeduction: '2000',
    insuranceDeduction: '1000',
    otherDeduction: '0',
    totalEarnings: '50000',
    totalDeductions: '3000',
    netSalary: '47000',
    effectiveFrom: new Date('2025-01-01'),
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPayslip = {
    id: 'ps-1',
    employeeId: 'emp-1',
    periodStart: new Date('2025-06-01'),
    periodEnd: new Date('2025-06-30'),
    totalEarnings: '50000',
    totalDeductions: '3000',
    netPay: '47000',
    status: 'draft',
    generatedAt: new Date(),
    paidAt: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [
      {
        id: 'psi-1',
        payslipId: 'ps-1',
        type: 'earnings',
        label: 'Basic Salary',
        amount: '30000',
      },
      {
        id: 'psi-2',
        payslipId: 'ps-1',
        type: 'earnings',
        label: 'House Allowance',
        amount: '10000',
      },
      {
        id: 'psi-3',
        payslipId: 'ps-1',
        type: 'deductions',
        label: 'Tax',
        amount: '2000',
      },
    ],
    employee: mockEmployee,
  };

  const prismaMock = {
    $transaction: jest.fn((cb: any) => cb(prismaMock)),
    employee: {
      findUnique: jest.fn().mockResolvedValue(mockEmployee),
      update: jest.fn().mockResolvedValue({ ...mockEmployee, salary: '47000' }),
    },
    salaryStructure: {
      findFirst: jest.fn().mockResolvedValue(mockSalaryStructure),
      findMany: jest.fn().mockResolvedValue([mockSalaryStructure]),
      create: jest.fn().mockResolvedValue(mockSalaryStructure),
      update: jest.fn().mockResolvedValue(mockSalaryStructure),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    payslip: {
      findMany: jest.fn().mockResolvedValue([mockPayslip]),
      findUnique: jest.fn().mockResolvedValue(mockPayslip),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(mockPayslip),
      update: jest.fn().mockResolvedValue({
        ...mockPayslip,
        status: 'paid',
        paidAt: new Date(),
      }),
      count: jest.fn().mockResolvedValue(1),
    },
    payslipItem: {
      createMany: jest.fn().mockResolvedValue({ count: 3 }),
    },
    employeeEarning: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    employeeDeduction: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    payrollPayment: {
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
      create: jest.fn().mockResolvedValue({ id: 'pay-1' }),
      delete: jest.fn().mockResolvedValue({ id: 'pay-1' }),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<PayrollService>(PayrollService);
    prisma = module.get<PrismaService>(PrismaService);

    prismaMock.employee.findUnique.mockResolvedValue(mockEmployee);
    prismaMock.employee.update.mockResolvedValue({
      ...mockEmployee,
      salary: '47000',
    });
    prismaMock.salaryStructure.findFirst.mockResolvedValue(mockSalaryStructure);
    prismaMock.salaryStructure.findMany.mockResolvedValue([
      mockSalaryStructure,
    ]);
    prismaMock.salaryStructure.create.mockResolvedValue(mockSalaryStructure);
    prismaMock.salaryStructure.update.mockResolvedValue(mockSalaryStructure);
    prismaMock.salaryStructure.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.payslip.findMany.mockResolvedValue([mockPayslip]);
    prismaMock.payslip.findUnique.mockResolvedValue(mockPayslip);
    prismaMock.payslip.findFirst.mockResolvedValue(null);
    prismaMock.payslip.create.mockResolvedValue(mockPayslip);
    prismaMock.payslip.update.mockResolvedValue({
      ...mockPayslip,
      status: 'paid',
      paidAt: new Date(),
    });
    prismaMock.payslip.count.mockResolvedValue(1);
    prismaMock.payslipItem.createMany.mockResolvedValue({ count: 3 });
    prismaMock.employeeEarning.findMany.mockResolvedValue([]);
    prismaMock.employeeDeduction.findMany.mockResolvedValue([]);
    prismaMock.payrollPayment.findMany.mockResolvedValue([]);
    prismaMock.payrollPayment.aggregate.mockResolvedValue({
      _sum: { amount: null },
    });
  });

  describe('setSalaryStructure', () => {
    const dto = {
      employeeId: 'emp-1',
      basicSalary: 30000,
      houseAllowance: 10000,
      medicalAllowance: 5000,
      transportAllowance: 3000,
      otherAllowance: 2000,
      taxDeduction: 2000,
      insuranceDeduction: 1000,
      effectiveFrom: '2025-06-01',
    };

    it('should create salary structure for an employee', async () => {
      const result = await service.setSalaryStructure(dto);
      expect(result).toBeDefined();
      expect(prisma.salaryStructure.create).toHaveBeenCalled();
    });

    it('should mirror the net salary onto Employee.salary (decision #7)', async () => {
      await service.setSalaryStructure(dto);
      expect(prisma.salaryStructure.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { employeeId: 'emp-1', isActive: true },
          data: expect.objectContaining({
            isActive: false,
            effectiveTo: expect.any(Date),
          }),
        }),
      );
      expect(prisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { salary: expect.anything() },
      });
      const updateCall = (prisma.employee.update as jest.Mock).mock.calls[0][0];
      expect(Number(updateCall.data.salary)).toBe(47000);
    });

    it('should throw if employee not found', async () => {
      jest.spyOn(prisma.employee, 'findUnique').mockResolvedValue(null);
      await expect(service.setSalaryStructure(dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects effectiveFrom before the joining date', async () => {
      await expect(
        service.setSalaryStructure({ ...dto, effectiveFrom: '2024-06-01' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a missing effectiveFrom', async () => {
      const { effectiveFrom: _ef, ...rest } = dto as any;
      await expect(service.setSalaryStructure(rest)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('closes the active structure with effectiveTo = effectiveFrom - 1 day', async () => {
      await service.setSalaryStructure({ ...dto, effectiveFrom: '2025-06-01' });
      const call = (
        prisma.salaryStructure.updateMany as jest.Mock
      ).mock.lastCall[0];
      const effTo = new Date(call.data.effectiveTo) as Date;
      expect(effTo.toISOString().slice(0, 10)).toBe('2025-05-31');
    });

    it('creates the new structure with an open-ended active window', async () => {
      await service.setSalaryStructure({ ...dto, effectiveFrom: '2025-06-01' });
      const call = (
        prisma.salaryStructure.create as jest.Mock
      ).mock.lastCall[0];
      expect(call.data.effectiveFrom.toISOString().slice(0, 10)).toBe(
        '2025-06-01',
      );
      expect(call.data.effectiveTo).toBeNull();
      expect(call.data.isActive).toBe(true);
    });
  });

  describe('getSalaryStructure', () => {
    it('should return active salary structure', async () => {
      const result = await service.getSalaryStructure('emp-1');
      expect(result).toEqual(mockSalaryStructure);
    });
  });

  describe('generatePayslip', () => {
    it('should generate payslip for an employee', async () => {
      const result = await service.generatePayslip(
        'emp-1',
        new Date('2025-06-01'),
        new Date('2025-06-30'),
      );
      expect(result).toBeDefined();
    });

    it('should throw if no active salary structure', async () => {
      jest.spyOn(prisma.salaryStructure, 'findFirst').mockResolvedValue(null);
      jest.spyOn(prisma.payslip, 'findFirst').mockResolvedValue(null);
      await expect(
        service.generatePayslip(
          'emp-1',
          new Date('2025-06-01'),
          new Date('2025-06-30'),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a draft payslip without forcing the lifecycle groundwork columns', async () => {
      const txCreate = jest.fn().mockReturnValue({ id: 'ps-1' });
      const tx = {
        payslip: {
          create: txCreate,
          findUnique: jest.fn().mockResolvedValue({
            ...mockPayslip,
            status: 'draft',
            reviewedAt: null,
            approvedAt: null,
            periodKey: '2025-06',
          }),
        },
        payslipItem: { createMany: jest.fn().mockResolvedValue({ count: 8 }) },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb: any) =>
        cb(tx),
      );

      const result = await service.generatePayslip(
        'emp-1',
        new Date('2025-06-01'),
        new Date('2025-06-30'),
      );

      const createData = txCreate.mock.calls[0][0].data;
      expect(createData.status).toBe('draft');
      expect(createData).not.toHaveProperty('reviewedAt');
      expect(createData).not.toHaveProperty('approvedAt');
      expect(createData.periodKey).toBe('2025-06');
      expect(result).toMatchObject({
        status: 'draft',
        reviewedAt: null,
        approvedAt: null,
        periodKey: '2025-06',
      });
    });
  });

  describe('findAllPayslips', () => {
    it('should return paginated payslips', async () => {
      const result = await service.findAllPayslips(1, 10);
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('passes an empty where when no period filter is provided', async () => {
      await service.findAllPayslips(1, 10);

      expect(prisma.payslip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
      expect(prisma.payslip.count).toHaveBeenCalledWith({ where: {} });
    });

    it('passes the periodKey filter to findMany and count', async () => {
      await service.findAllPayslips(1, 10, '2026-08');

      expect(prisma.payslip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { periodKey: '2026-08' } }),
      );
      expect(prisma.payslip.count).toHaveBeenCalledWith({
        where: { periodKey: '2026-08' },
      });
    });

    it('keeps pagination applied alongside the period filter', async () => {
      await service.findAllPayslips(2, 10, '2026-08');

      expect(prisma.payslip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });
  });

  describe('approvePayslip', () => {
    it('should approve a draft payslip', async () => {
      const result = await service.approvePayslip('ps-1');
      expect(result.status).toBe('paid');
    });

    it('should throw if payslip not found', async () => {
      jest.spyOn(prisma.payslip, 'findUnique').mockResolvedValue(null);
      await expect(service.approvePayslip('invalid')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('generatePayslip — pro-ration (§5.4)', () => {
    it('reduces earnings when the employee joins mid-period', async () => {
      const midPeriodEmployee = {
        ...mockEmployee,
        joiningDate: new Date('2025-06-16'),
      };
      jest
        .spyOn(prisma.employee, 'findUnique')
        .mockResolvedValue(midPeriodEmployee);

      const txCreate = jest.fn().mockReturnValue({ id: 'ps-new' });
      const tx = {
        payslip: {
          create: txCreate,
          findUnique: jest.fn().mockResolvedValue({
            ...mockPayslip,
            status: 'draft',
            periodKey: '2025-06',
          }),
        },
        payslipItem: { createMany: jest.fn().mockResolvedValue({ count: 8 }) },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb: any) =>
        cb(tx),
      );

      await service.generatePayslip(
        'emp-1',
        new Date('2025-06-01'),
        new Date('2025-06-30'),
      );

      const data = txCreate.mock.calls[0][0].data;
      // Full structure earnings = 50000; ~14/29 of the period elapsed.
      expect(data.totalEarnings).toBeLessThan(50000);
      expect(data.totalEarnings).toBeGreaterThan(0);
      // Deductions stay full.
      expect(data.totalDeductions).toBe(3000);
    });
  });

  describe('generatePayslip — ledger sums (§5.4)', () => {
    it('includes approved earnings and deductions in the totals', async () => {
      jest.spyOn(prisma.employeeEarning, 'findMany').mockResolvedValue([
        {
          id: 'earn-1',
          employeeId: 'emp-1',
          type: 'bonus',
          amount: '5000',
          reason: 'Retention bonus',
          applicableFrom: null,
          applicableTo: null,
          status: 'approved',
        } as any,
      ]);
      jest.spyOn(prisma.employeeDeduction, 'findMany').mockResolvedValue([
        {
          id: 'ded-1',
          employeeId: 'emp-1',
          type: 'fine',
          amount: '1000',
          reason: 'Late',
          applicableFrom: null,
          applicableTo: null,
          status: 'approved',
        } as any,
      ]);

      const txCreate = jest.fn().mockReturnValue({ id: 'ps-new' });
      const tx = {
        payslip: {
          create: txCreate,
          findUnique: jest.fn().mockResolvedValue({
            ...mockPayslip,
            status: 'draft',
            periodKey: '2025-06',
          }),
        },
        payslipItem: { createMany: jest.fn().mockResolvedValue({ count: 10 }) },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb: any) =>
        cb(tx),
      );

      await service.generatePayslip(
        'emp-1',
        new Date('2025-06-01'),
        new Date('2025-06-30'),
      );

      const data = txCreate.mock.calls[0][0].data;
      // 50000 earnings + 5000 ledger earning; 3000 deductions + 1000 ledger.
      expect(data.totalEarnings).toBe(55000);
      expect(data.totalDeductions).toBe(4000);
      expect(data.netPay).toBe(51000);
    });

    it('scopes ledger lookups to the period window', async () => {
      const findMany = jest
        .spyOn(prisma.employeeEarning, 'findMany')
        .mockResolvedValue([]);

      const txCreate = jest.fn().mockReturnValue({ id: 'ps-new' });
      const tx = {
        payslip: {
          create: txCreate,
          findUnique: jest.fn().mockResolvedValue({
            ...mockPayslip,
            status: 'draft',
            periodKey: '2025-06',
          }),
        },
        payslipItem: { createMany: jest.fn().mockResolvedValue({ count: 8 }) },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb: any) =>
        cb(tx),
      );

      await service.generatePayslip(
        'emp-1',
        new Date('2025-06-01'),
        new Date('2025-06-30'),
      );

      // The ledger query must constrain earnings to the applicable-from/to
      // window so out-of-period entries are excluded at the DB layer.
      const where = findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        employeeId: 'emp-1',
        status: 'approved',
        AND: expect.any(Array),
      });
      const and = where.AND;
      expect(and[0].OR).toContainEqual({ applicableFrom: null });
      expect(and[0].OR).toContainEqual({
        applicableFrom: { lte: new Date('2025-06-30') },
      });
      expect(and[1].OR).toContainEqual({ applicableTo: null });
      expect(and[1].OR).toContainEqual({
        applicableTo: { gte: new Date('2025-06-01') },
      });
    });
  });

  describe('generatePayslip — duplicate periodKey (§5.1)', () => {
    it('throws ConflictException when a payslip exists for the period', async () => {
      jest
        .spyOn(prisma.payslip, 'findFirst')
        .mockResolvedValue({ ...mockPayslip, periodKey: '2025-06' });
      await expect(
        service.generatePayslip(
          'emp-1',
          new Date('2025-06-01'),
          new Date('2025-06-30'),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('converts a concurrent P2002 race on (employeeId, periodKey) into 409', async () => {
      const tx = {
        payslip: {
          create: jest
            .fn()
            .mockRejectedValue({ code: 'P2002', meta: { target: ['employeeId', 'periodKey'] } }),
          findUnique: jest.fn(),
        },
        payslipItem: { createMany: jest.fn() },
      };
      (prisma.$transaction as jest.Mock)
        .mockImplementationOnce((cb: any) => cb(tx))
        .mockImplementationOnce((cb: any) => cb(tx));

      await expect(
        service.generatePayslip(
          'emp-1',
          new Date('2025-06-01'),
          new Date('2025-06-30'),
        ),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.generatePayslip(
          'emp-1',
          new Date('2025-06-01'),
          new Date('2025-06-30'),
        ),
      ).rejects.toThrow(/already exists for this period/i);
    });

    it('rethrows non-unique failures from the create', async () => {
      const tx = {
        payslip: {
          create: jest.fn().mockRejectedValue(new Error('boom')),
          findUnique: jest.fn(),
        },
        payslipItem: { createMany: jest.fn() },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb: any) =>
        cb(tx),
      );

      await expect(
        service.generatePayslip(
          'emp-1',
          new Date('2025-06-01'),
          new Date('2025-06-30'),
        ),
      ).rejects.toThrow('boom');
    });
  });

  describe('setStatus (§5.1 lifecycle)', () => {
    const setup = (status: string) =>
      jest
        .spyOn(prisma.payslip, 'findUnique')
        .mockResolvedValue({ ...mockPayslip, status });

    it('allows draft → reviewed', async () => {
      setup('draft');
      const update = jest
        .spyOn(prisma.payslip, 'update')
        .mockResolvedValue({ ...mockPayslip, status: 'reviewed' });
      const res = await service.setStatus('ps-1', 'reviewed');
      expect(res.status).toBe('reviewed');
      expect(update.mock.lastCall[0].data).toHaveProperty('reviewedAt');
    });

    it('allows reviewed → approved', async () => {
      setup('reviewed');
      const update = jest
        .spyOn(prisma.payslip, 'update')
        .mockResolvedValue({ ...mockPayslip, status: 'approved' });
      const res = await service.setStatus('ps-1', 'approved');
      expect(res.status).toBe('approved');
      expect(update.mock.lastCall[0].data).toHaveProperty('approvedAt');
    });

    it('allows reviewed → cancelled', async () => {
      setup('reviewed');
      const update = jest
        .spyOn(prisma.payslip, 'update')
        .mockResolvedValue({ ...mockPayslip, status: 'cancelled' });
      const res = await service.setStatus('ps-1', 'cancelled');
      expect(res.status).toBe('cancelled');
    });

    it('rejects draft → approved (invalid transition)', async () => {
      setup('draft');
      await expect(service.setStatus('ps-1', 'approved')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects approved → draft (locked)', async () => {
      setup('approved');
      await expect(service.setStatus('ps-1', 'draft')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFound when the payslip is missing', async () => {
      jest.spyOn(prisma.payslip, 'findUnique').mockResolvedValue(null);
      await expect(service.setStatus('missing', 'reviewed')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('generatePayslip — effective-dating resolution', () => {
    it('scopes the active-structure lookup to the payslip window', async () => {
      jest.spyOn(prisma.payslip, 'findFirst').mockResolvedValue(null);
      const findFirst = jest.spyOn(prisma.salaryStructure, 'findFirst');

      const tx = {
        payslip: {
          create: jest.fn().mockReturnValue({ id: 'ps-win' }),
          findUnique: jest
            .fn()
            .mockResolvedValue({ ...mockPayslip, status: 'draft' }),
        },
        payslipItem: { createMany: jest.fn().mockResolvedValue({ count: 8 }) },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb: any) =>
        cb(tx),
      );

      await service.generatePayslip(
        'emp-1',
        new Date('2025-06-01'),
        new Date('2025-06-30'),
      );

      expect(findFirst.mock.lastCall[0].where).toMatchObject({
        employeeId: 'emp-1',
        isActive: true,
        effectiveFrom: { lte: new Date('2025-06-01') },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: new Date('2025-06-30') } },
        ],
      });
    });

    it('throws the friendly 400 when no structure covers the period', async () => {
      jest.spyOn(prisma.salaryStructure, 'findFirst').mockResolvedValue(null);
      jest.spyOn(prisma.payslip, 'findFirst').mockResolvedValue(null);
      await expect(
        service.generatePayslip(
          'emp-1',
          new Date('2024-01-01'),
          new Date('2024-01-31'),
        ),
      ).rejects.toThrow('No active salary structure for this period');
    });

    it('resolves the structure whose window covers the period (new vs old)', async () => {
      const findFirst = jest.spyOn(prisma.salaryStructure, 'findFirst');
      findFirst.mockResolvedValue({
        ...mockSalaryStructure,
        id: 'ss-2',
        effectiveFrom: new Date('2025-06-01'),
        effectiveTo: null,
        isActive: true,
      });
      jest.spyOn(prisma.payslip, 'findFirst').mockResolvedValue(null);

      const tx = {
        payslip: {
          create: jest.fn().mockReturnValue({ id: 'ps-win' }),
          findUnique: jest
            .fn()
            .mockResolvedValue({ ...mockPayslip, status: 'draft' }),
        },
        payslipItem: { createMany: jest.fn().mockResolvedValue({ count: 8 }) },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb: any) =>
        cb(tx),
      );

      await service.generatePayslip(
        'emp-1',
        new Date('2025-06-01'),
        new Date('2025-06-30'),
      );

      const data = (
        tx.payslip.create as jest.Mock
      ).mock.calls[0][0].data;
      expect(data).toBeDefined();
    });
  });

  describe('getSalaryStructureHistory', () => {
    it('returns all structures ordered by effectiveFrom desc', async () => {
      const result = await service.getSalaryStructureHistory('emp-1');
      expect(prisma.salaryStructure.findMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1' },
        orderBy: { effectiveFrom: 'desc' },
      });
      expect(result).toEqual([mockSalaryStructure]);
    });

    it('throws NotFound for a missing employee', async () => {
      jest.spyOn(prisma.employee, 'findUnique').mockResolvedValue(null);
      await expect(
        service.getSalaryStructureHistory('ghost'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getSummary', () => {
    it('computes totals from payslips and payments', async () => {
      jest
        .spyOn(prisma.payslip, 'findMany')
        .mockResolvedValueOnce([
          {
            id: 'ps-2',
            periodKey: '2025-05',
            netPay: '10000',
            status: 'approved' as const,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'ps-2',
            netPay: '10000',
            payments: [{ amount: '4000' }],
          },
        ]);
      jest.spyOn(prisma.payrollPayment, 'aggregate').mockResolvedValue({
        _sum: { amount: 4000 },
      } as any);

      const result = await service.getSummary('emp-1');

      expect(result).toMatchObject({
        currentStructure: mockSalaryStructure,
        mirrorSalary: 50000,
        structures: [mockSalaryStructure],
        totalPaid: 4000,
        outstanding: 6000,
      });
      expect(result.payslips).toEqual([
        {
          id: 'ps-2',
          periodKey: '2025-05',
          netPay: expect.anything(),
          status: 'approved',
        },
      ]);
    });

    it('limits recent payslips to the last six', async () => {
      (prisma.payslip.findMany as jest.Mock).mockClear();
      (prisma.payslip.findMany as jest.Mock)
        .mockResolvedValueOnce(
          Array.from({ length: 6 }, (_, i) => ({
            id: `ps-${i}`,
            periodKey: '2025-05',
            netPay: '10000',
            status: 'paid' as const,
          })),
        )
        .mockResolvedValueOnce([]);
      jest.spyOn(prisma.payrollPayment, 'aggregate').mockResolvedValue({
        _sum: { amount: null },
      } as any);

      const result = await service.getSummary('emp-1');
      const recentCall = (prisma.payslip.findMany as jest.Mock).mock
        .calls[0][0];
      expect(recentCall).toMatchObject({
        where: { employeeId: 'emp-1' },
        orderBy: { createdAt: 'desc' },
        take: 6,
      });
      expect(result.payslips).toHaveLength(6);
      expect(result.outstanding).toBe(0);
    });

    it('throws NotFound for a missing employee', async () => {
      jest.spyOn(prisma.employee, 'findUnique').mockResolvedValue(null);
      await expect(service.getSummary('ghost')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
