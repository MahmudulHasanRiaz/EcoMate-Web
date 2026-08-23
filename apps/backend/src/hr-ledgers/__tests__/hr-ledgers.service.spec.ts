import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { HrLedgersService } from '../hr-ledgers.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerStatus } from '@prisma/client';

describe('HrLedgersService', () => {
  let service: HrLedgersService;
  let prisma: PrismaService;

  const mockEmployee = { id: 'emp-1', employeeId: 'EMP-250624-0001' };
  const mockEarning = {
    id: 'earn-1',
    employeeId: 'emp-1',
    type: 'bonus',
    amount: '5000',
    reason: 'annual',
    applicableFrom: null,
    applicableTo: null,
    status: 'draft',
    payslipId: null,
    createdById: null,
    approvedById: null,
    approvedAt: null,
  };
  const mockDeduction = {
    id: 'ded-1',
    employeeId: 'emp-1',
    type: 'fine',
    amount: '500',
    reason: 'late',
    applicableFrom: null,
    applicableTo: null,
    status: 'draft',
    payslipId: null,
    createdById: null,
    approvedById: null,
    approvedAt: null,
  };

  const prismaMock = {
    employee: {
      findUnique: jest.fn().mockResolvedValue(mockEmployee),
    },
    employeeEarning: {
      create: jest.fn().mockResolvedValue(mockEarning),
      findMany: jest.fn().mockResolvedValue([mockEarning]),
      count: jest.fn().mockResolvedValue(1),
      findUnique: jest.fn().mockResolvedValue(mockEarning),
      update: jest.fn().mockResolvedValue({
        ...mockEarning,
        status: 'approved',
        approvedById: 'actor-1',
        approvedAt: new Date(),
      }),
    },
    employeeDeduction: {
      create: jest.fn().mockResolvedValue(mockDeduction),
      findMany: jest.fn().mockResolvedValue([mockDeduction]),
      count: jest.fn().mockResolvedValue(1),
      findUnique: jest.fn().mockResolvedValue(mockDeduction),
      update: jest.fn().mockResolvedValue({
        ...mockDeduction,
        status: 'approved',
        approvedById: 'actor-1',
        approvedAt: new Date(),
      }),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrLedgersService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get<HrLedgersService>(HrLedgersService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
    prismaMock.employee.findUnique.mockResolvedValue(mockEmployee);
  });

  describe('earnings', () => {
    it('createEarning persists a draft row with actor id', async () => {
      const result = await service.createEarning(
        {
          employeeId: 'emp-1',
          type: 'bonus' as any,
          amount: 5000,
          reason: 'annual',
        },
        'actor-1',
      );
      expect(result).toEqual(mockEarning);
      expect(prisma.employeeEarning.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: LedgerStatus.draft,
            createdById: 'actor-1',
          }),
        }),
      );
    });

    it('createEarning throws NotFound for missing employee', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(null);
      await expect(
        service.createEarning({
          employeeId: 'nope',
          type: 'bonus' as any,
          amount: 5000,
          reason: 'annual',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('findEarnings returns paginated rows with meta', async () => {
      const result = await service.findEarnings({ employeeId: 'emp-1' }, 1, 10);
      expect(result.data).toEqual([mockEarning]);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        perPage: 10,
        totalPages: 1,
      });
      expect(prisma.employeeEarning.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { employeeId: 'emp-1' } }),
      );
    });

    it('findEarnings passes status filter', async () => {
      await service.findEarnings({ status: LedgerStatus.approved }, 1, 10);
      expect(prisma.employeeEarning.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: LedgerStatus.approved } }),
      );
    });

    it('approveEarning transitions draft to approved', async () => {
      const result = await service.approveEarning('earn-1', 'actor-1');
      expect(result.status).toBe(LedgerStatus.approved);
      expect(prisma.employeeEarning.update).toHaveBeenCalledWith({
        where: { id: 'earn-1' },
        data: {
          status: LedgerStatus.approved,
          approvedById: 'actor-1',
          approvedAt: expect.any(Date),
        },
      });
    });

    it('approveEarning throws NotFound for missing row', async () => {
      prismaMock.employeeEarning.findUnique.mockResolvedValue(null);
      await expect(service.approveEarning('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('approveEarning throws BadRequest for non-draft status', async () => {
      prismaMock.employeeEarning.findUnique.mockResolvedValue({
        ...mockEarning,
        status: 'approved',
      });
      await expect(service.approveEarning('earn-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('deductions', () => {
    it('createDeduction persists a draft row with actor id', async () => {
      const result = await service.createDeduction(
        {
          employeeId: 'emp-1',
          type: 'fine' as any,
          amount: 500,
          reason: 'late',
        },
        'actor-1',
      );
      expect(result).toEqual(mockDeduction);
      expect(prisma.employeeDeduction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: LedgerStatus.draft,
            createdById: 'actor-1',
          }),
        }),
      );
    });

    it('createDeduction throws NotFound for missing employee', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(null);
      await expect(
        service.createDeduction({
          employeeId: 'nope',
          type: 'fine' as any,
          amount: 500,
          reason: 'late',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('findDeductions returns paginated rows with meta', async () => {
      const result = await service.findDeductions({}, 1, 10);
      expect(result.data).toEqual([mockDeduction]);
      expect(result.meta.total).toBe(1);
    });

    it('approveDeduction transitions draft to approved', async () => {
      const result = await service.approveDeduction('ded-1', 'actor-1');
      expect(result.status).toBe(LedgerStatus.approved);
    });

    it('approveDeduction throws NotFound for missing row', async () => {
      prismaMock.employeeDeduction.findUnique.mockResolvedValue(null);
      await expect(service.approveDeduction('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('approveDeduction throws BadRequest for non-draft status', async () => {
      prismaMock.employeeDeduction.findUnique.mockResolvedValue({
        ...mockDeduction,
        status: 'approved',
      });
      await expect(service.approveDeduction('ded-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
