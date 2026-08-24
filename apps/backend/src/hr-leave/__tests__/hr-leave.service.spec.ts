import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
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
      findFirst: jest.fn(),
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
      prismaMock.leaveType.findUnique.mockResolvedValue(null);
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

    it('createType rejects a duplicate name', async () => {
      prismaMock.leaveType.findUnique.mockResolvedValueOnce({ id: 'lt-x' });
      await expect(
        service.createType({ name: 'Casual Leave', code: 'x', daysPerYear: 1 }),
      ).rejects.toThrow(ConflictException);
    });

    it('createType rejects a duplicate code', async () => {
      prismaMock.leaveType.findUnique.mockResolvedValueOnce(null);
      prismaMock.leaveType.findUnique.mockResolvedValueOnce({ id: 'lt-x' });
      await expect(
        service.createType({ name: 'New Leave', code: 'casual', daysPerYear: 1 }),
      ).rejects.toThrow(ConflictException);
    });

    it('converts a concurrent P2002 race on name/code into 409', async () => {
      prismaMock.leaveType.findUnique.mockResolvedValue(null);
      prismaMock.leaveType.create.mockRejectedValue({
        code: 'P2002',
        meta: { target: ['name'] },
      });
      await expect(
        service.createType({ name: 'Casual Leave', code: 'casual', daysPerYear: 10 }),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.createType({ name: 'Casual Leave', code: 'casual', daysPerYear: 10 }),
      ).rejects.toThrow(/already exists/i);
    });

    it('updateType rejects moving onto another type name/code', async () => {
      prismaMock.leaveType.findUnique.mockResolvedValueOnce({ id: 'lt-1', name: 'A', code: 'a' });
      prismaMock.leaveType.findUnique.mockResolvedValueOnce({ id: 'lt-2', name: 'Casual Leave' });
      await expect(
        service.updateType('lt-1', { name: 'Casual Leave' }),
      ).rejects.toThrow(ConflictException);
    });

    it('deleteType rejects a type that has leave requests', async () => {
      prismaMock.leaveType.findUnique.mockResolvedValue({ id: 'lt-1' });
      prismaMock.leaveRequest.count.mockResolvedValue(2);
      await expect(service.deleteType('lt-1')).rejects.toThrow(ConflictException);
      expect(prismaMock.leaveType.delete).not.toHaveBeenCalled();
    });

    it('deleteType converts a concurrent P2003 FK-restrict into 409', async () => {
      prismaMock.leaveType.findUnique.mockResolvedValue({ id: 'lt-1' });
      prismaMock.leaveRequest.count.mockResolvedValue(0);
      prismaMock.leaveType.delete.mockRejectedValue({
        code: 'P2003',
        meta: { field_name: 'LeaveRequest_typeId_fkey' },
      });
      await expect(service.deleteType('lt-1')).rejects.toThrow(ConflictException);
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

  describe('overlapping leave guard (G-14)', () => {
    const reqDto = {
      employeeId: 'emp-1',
      typeId: 'lt-1',
      startDate: '2026-01-02',
      endDate: '2026-01-04',
      reason: 'vacation',
    };

    it('blocks a create that overlaps an existing pending/approved request (409) and queries exactly the overlap statuses', async () => {
      prismaMock.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
      prismaMock.leaveType.findUnique.mockResolvedValue({ id: 'lt-1' });
      prismaMock.leaveRequest.findFirst.mockResolvedValue({ id: 'lr-existing' });

      await expect(service.createRequest(reqDto)).rejects.toThrow(
        ConflictException,
      );
      expect(prismaMock.leaveRequest.create).not.toHaveBeenCalled();
      expect(prismaMock.leaveRequest.findFirst).toHaveBeenCalledWith({
        where: {
          employeeId: 'emp-1',
          status: { in: ['pending', 'approved'] },
          startDate: { lte: new Date('2026-01-04') },
          endDate: { gte: new Date('2026-01-02') },
        },
        select: { id: true },
      });
    });

    it('blocks a create that overlaps an approved request too (status filter covers approved)', async () => {
      prismaMock.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
      prismaMock.leaveType.findUnique.mockResolvedValue({ id: 'lt-1' });
      prismaMock.leaveRequest.findFirst.mockResolvedValue({ id: 'lr-approved' });

      await expect(service.createRequest(reqDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('allows a create adjacent to an existing request (end +1 day, no overlap)', async () => {
      prismaMock.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
      prismaMock.leaveType.findUnique.mockResolvedValue({ id: 'lt-1' });
      prismaMock.leaveRequest.findFirst.mockResolvedValue(null);
      prismaMock.leaveRequest.create.mockResolvedValue({ id: 'lr-new' });

      const res = await service.createRequest({
        ...reqDto,
        startDate: '2026-01-05',
        endDate: '2026-01-06',
      });
      expect(res).toEqual({ id: 'lr-new' });
      expect(prismaMock.leaveRequest.create).toHaveBeenCalledTimes(1);
    });

    it('blocks approving a pending request that overlaps another approved one (re-check, excluding itself)', async () => {
      prismaMock.leaveRequest.findUnique.mockResolvedValue({
        id: 'lr-2',
        status: 'pending',
        employeeId: 'emp-1',
        startDate: new Date('2026-01-02'),
        endDate: new Date('2026-01-04'),
      });
      prismaMock.leaveRequest.findFirst.mockResolvedValue({ id: 'lr-approved' });

      await expect(service.approveRequest('lr-2', {})).rejects.toThrow(
        ConflictException,
      );
      expect(prismaMock.leaveRequest.update).not.toHaveBeenCalled();
      expect(prismaMock.leaveRequest.findFirst).toHaveBeenCalledWith({
        where: {
          employeeId: 'emp-1',
          status: { in: ['pending', 'approved'] },
          startDate: { lte: new Date('2026-01-04') },
          endDate: { gte: new Date('2026-01-02') },
          id: { not: 'lr-2' },
        },
        select: { id: true },
      });
    });

    it('approves when no overlapping pending/approved request exists', async () => {
      prismaMock.leaveRequest.findUnique.mockResolvedValue({
        id: 'lr-2',
        status: 'pending',
        employeeId: 'emp-1',
        startDate: new Date('2026-01-02'),
        endDate: new Date('2026-01-04'),
      });
      prismaMock.leaveRequest.findFirst.mockResolvedValue(null);
      prismaMock.leaveRequest.update.mockResolvedValue({ id: 'lr-2', status: 'approved' });

      const res = await service.approveRequest('lr-2', {});
      expect(res.status).toBe('approved');
      expect(prismaMock.leaveRequest.update).toHaveBeenCalledTimes(1);
    });

    it('cancelling an approved request restores the balance (cancelled excluded from derived balance)', async () => {
      prismaMock.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
      prismaMock.leaveType.findMany.mockResolvedValue([
        { id: 'lt-1', name: 'Casual Leave', isPaid: true, daysPerYear: 10 },
      ]);
      // Before cancel: the approved request is counted → used 5 / remaining 5.
      prismaMock.leaveRequest.aggregate.mockResolvedValue({ _sum: { days: 5 } });
      const before = await service.leaveBalances('emp-1');
      expect(before[0].used).toBe(5);
      expect(before[0].remaining).toBe(5);

      // Cancel the approved request (status → cancelled).
      prismaMock.leaveRequest.findUnique.mockResolvedValue({
        id: 'lr-1',
        status: 'approved',
        createdById: 'actor-1',
      });
      prismaMock.leaveRequest.update.mockResolvedValue({ id: 'lr-1', status: 'cancelled' });
      await service.cancelRequest('lr-1', 'actor-1');
      expect(prismaMock.leaveRequest.update).toHaveBeenCalledWith({
        where: { id: 'lr-1' },
        data: { status: 'cancelled' },
      });

      // After cancel: cancelled is excluded from approved-only aggregate → restored.
      prismaMock.leaveRequest.aggregate.mockResolvedValue({ _sum: { days: 0 } });
      prismaMock.leaveType.findMany.mockResolvedValue([
        { id: 'lt-1', name: 'Casual Leave', isPaid: true, daysPerYear: 10 },
      ]);
      const after = await service.leaveBalances('emp-1');
      expect(after[0].used).toBe(0);
      expect(after[0].remaining).toBe(10);
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
