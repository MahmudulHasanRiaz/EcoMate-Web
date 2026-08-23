import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { HrLeaveService } from '../hr-leave.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('HrLeaveService', () => {
  let service: HrLeaveService;
  let prisma: any;

  const prismaMock = {
    leaveType: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn().mockResolvedValue({ id: 'lt-1' }),
      update: jest.fn(),
      delete: jest.fn(),
    },
    leaveRequest: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrLeaveService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get<HrLeaveService>(HrLeaveService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  describe('leave type CRUD', () => {
    it('createType persists with defaults', async () => {
      prismaMock.leaveType.create.mockResolvedValue({ id: 'lt-1' });
      const res = await service.createType({
        name: 'Casual Leave',
        code: 'casual',
        daysPerYear: 10,
      });
      expect(res).toEqual({ id: 'lt-1' });
      expect(prismaMock.leaveType.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Casual Leave',
          code: 'casual',
          daysPerYear: 10,
          isPaid: true,
          isActive: true,
        }),
      });
    });

    it('listTypes filters by isActive', async () => {
      prismaMock.leaveType.findMany.mockResolvedValue([]);
      await service.listTypes({ isActive: true });
      expect(prismaMock.leaveType.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('updateType updates only provided fields', async () => {
      prismaMock.leaveType.findUnique.mockResolvedValue({ id: 'lt-1' });
      prismaMock.leaveType.update.mockResolvedValue({ id: 'lt-1' });
      await service.updateType('lt-1', { daysPerYear: 12 });
      expect(prismaMock.leaveType.update).toHaveBeenCalledWith({
        where: { id: 'lt-1' },
        data: { daysPerYear: 12 },
      });
    });

    it('updateType throws for missing type', async () => {
      prismaMock.leaveType.findUnique.mockResolvedValue(null);
      await expect(service.updateType('x', { daysPerYear: 1 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deleteType throws for missing type', async () => {
      prismaMock.leaveType.findUnique.mockResolvedValue(null);
      await expect(service.deleteType('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('leave requests', () => {
    it('createRequest validates employee exists', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(null);
      await expect(
        service.createRequest({
          employeeId: 'emp-1',
          typeId: 'lt-1',
          startDate: '2026-01-01',
          endDate: '2026-01-03',
          reason: 'vacation',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('createRequest validates type exists', async () => {
      prismaMock.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
      prismaMock.leaveType.findUnique.mockResolvedValue(null);
      await expect(
        service.createRequest({
          employeeId: 'emp-1',
          typeId: 'lt-1',
          startDate: '2026-01-01',
          endDate: '2026-01-03',
          reason: 'vacation',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('createRequest computes inclusive day count when days omitted', async () => {
      prismaMock.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
      prismaMock.leaveType.findUnique.mockResolvedValue({ id: 'lt-1' });
      prismaMock.leaveRequest.create.mockResolvedValue({ id: 'lr-1', days: 3 });
      const res = await service.createRequest(
        {
          employeeId: 'emp-1',
          typeId: 'lt-1',
          startDate: '2026-01-01',
          endDate: '2026-01-03',
          reason: 'vacation',
        },
        'actor-1',
      );
      expect(res.days).toBe(3);
      expect(prismaMock.leaveRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          days: 3,
          status: 'pending',
          createdById: 'actor-1',
        }),
      });
    });

    it('createRequest rejects endDate before startDate', async () => {
      prismaMock.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
      prismaMock.leaveType.findUnique.mockResolvedValue({ id: 'lt-1' });
      await expect(
        service.createRequest({
          employeeId: 'emp-1',
          typeId: 'lt-1',
          startDate: '2026-01-05',
          endDate: '2026-01-03',
          reason: 'vacation',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('approveRequest rejects non-pending request', async () => {
      prismaMock.leaveRequest.findUnique.mockResolvedValue({
        id: 'lr-1',
        status: 'approved',
      });
      await expect(
        service.approveRequest('lr-1', {}, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejectRequest requires decisionNote', async () => {
      prismaMock.leaveRequest.findUnique.mockResolvedValue({
        id: 'lr-1',
        status: 'pending',
      });
      await expect(
        service.rejectRequest('lr-1', { decisionNote: '' }, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('cancelRequest only allows pending/approved', async () => {
      prismaMock.leaveRequest.findUnique.mockResolvedValue({
        id: 'lr-1',
        status: 'rejected',
      });
      await expect(
        service.cancelRequest('lr-1', 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('leave balances', () => {
    it('computes remaining = entitlement - used for current year', async () => {
      prismaMock.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
      prismaMock.leaveType.findMany.mockResolvedValue([
        { id: 'lt-1', name: 'Casual Leave', isPaid: true, daysPerYear: 10 },
        { id: 'lt-2', name: 'Sick Leave', isPaid: true, daysPerYear: 14 },
      ]);
      prismaMock.leaveRequest.aggregate
        .mockResolvedValueOnce({ _sum: { days: 4 } })
        .mockResolvedValueOnce({ _sum: { days: 0 } });
      const res = await service.leaveBalances('emp-1');
      expect(res).toEqual([
        {
          typeId: 'lt-1',
          typeName: 'Casual Leave',
          isPaid: true,
          entitlement: 10,
          used: 4,
          remaining: 6,
        },
        {
          typeId: 'lt-2',
          typeName: 'Sick Leave',
          isPaid: true,
          entitlement: 14,
          used: 0,
          remaining: 14,
        },
      ]);
    });

    it('throws when employee missing', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(null);
      await expect(service.leaveBalances('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('leave calendar', () => {
    it('returns approved requests only', async () => {
      prismaMock.leaveRequest.findMany.mockResolvedValue([
        {
          id: 'lr-1',
          employeeId: 'emp-1',
          type: { name: 'Sick Leave' },
          startDate: new Date('2026-02-01'),
          endDate: new Date('2026-02-03'),
        },
      ]);
      const res = await service.leaveCalendar({ employeeId: 'emp-1' });
      expect(prismaMock.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'approved', employeeId: 'emp-1' },
        }),
      );
      expect(res[0]).toEqual({
        id: 'lr-1',
        employeeId: 'emp-1',
        typeName: 'Sick Leave',
        startDate: new Date('2026-02-01'),
        endDate: new Date('2026-02-03'),
      });
    });
  });
});
