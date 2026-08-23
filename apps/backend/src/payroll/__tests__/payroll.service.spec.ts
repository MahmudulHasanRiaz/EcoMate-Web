import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
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
            periodKey: null,
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
      expect(createData).not.toHaveProperty('periodKey');
      expect(result).toMatchObject({
        status: 'draft',
        reviewedAt: null,
        approvedAt: null,
        periodKey: null,
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
});
