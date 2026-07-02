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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollService,
        {
          provide: PrismaService,
          useValue: {
            employee: {
              findUnique: jest.fn().mockResolvedValue(mockEmployee),
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
          },
        },
      ],
    }).compile();

    service = module.get<PayrollService>(PayrollService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('setSalaryStructure', () => {
    it('should create salary structure for an employee', async () => {
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
      const result = await service.setSalaryStructure(dto);
      expect(result).toBeDefined();
      expect(prisma.salaryStructure.create).toHaveBeenCalled();
    });

    it('should throw if employee not found', async () => {
      jest.spyOn(prisma.employee, 'findUnique').mockResolvedValue(null);
      const dto = { employeeId: 'invalid', basicSalary: 30000 };
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
        '2025-06-01',
        '2025-06-30',
      );
      expect(result).toBeDefined();
      expect(prisma.payslip.create).toHaveBeenCalled();
    });

    it('should throw if no active salary structure', async () => {
      jest.spyOn(prisma.salaryStructure, 'findFirst').mockResolvedValue(null);
      await expect(
        service.generatePayslip('emp-1', '2025-06-01', '2025-06-30'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAllPayslips', () => {
    it('should return paginated payslips', async () => {
      const result = await service.findAllPayslips(1, 10);
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
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
