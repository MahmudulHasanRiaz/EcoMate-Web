import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { HrAttendanceService } from '../hr-attendance.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('HrAttendanceService', () => {
  let service: HrAttendanceService;
  let prisma: any;

  const prismaMock = {
    employee: {
      findUnique: jest.fn(),
    },
    attendanceRecord: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
  };

  const EMPLOYEE_ACTIVE = { id: 'emp-1', status: 'active' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrAttendanceService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get<HrAttendanceService>(HrAttendanceService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  describe('createRecord', () => {
    const baseDto = { employeeId: 'emp-1', date: '2026-08-28', status: 'PRESENT' as const };

    it('creates a PRESENT record with check-in, actor and normalized date', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(EMPLOYEE_ACTIVE);
      prismaMock.attendanceRecord.findUnique.mockResolvedValue(null);
      prismaMock.attendanceRecord.create.mockResolvedValue({ id: 'att-1' });

      const res = await service.createRecord(
        { ...baseDto, checkInTime: '2026-08-28T09:05:00Z' },
        'actor-1',
      );
      expect(res).toEqual({ id: 'att-1' });

      const data = prismaMock.attendanceRecord.create.mock.calls[0][0].data;
      expect(data.status).toBe('PRESENT');
      expect(data.recordedById).toBe('actor-1');
      expect(data.employeeId).toBe('emp-1');
      expect(data.date).toEqual(new Date('2026-08-28T00:00:00.000Z'));
      expect(data.checkInTime).toEqual(new Date('2026-08-28T09:05:00Z'));
      expect(prismaMock.attendanceRecord.findUnique).toHaveBeenCalledWith({
        where: {
          employeeId_date: {
            employeeId: 'emp-1',
            date: new Date('2026-08-28T00:00:00.000Z'),
          },
        },
      });
    });

    it('throws 409 when a record already exists for the employee on the date', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(EMPLOYEE_ACTIVE);
      prismaMock.attendanceRecord.findUnique.mockResolvedValue({ id: 'att-x' });

      await expect(service.createRecord(baseDto, 'actor-1')).rejects.toThrow(
        ConflictException,
      );
      await expect(
        service.createRecord(baseDto, 'actor-1'),
      ).rejects.toThrow(/already exists/i);
      expect(prismaMock.attendanceRecord.create).not.toHaveBeenCalled();
    });

    it('converts a concurrent P2002 race on (employeeId, date) into 409', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(EMPLOYEE_ACTIVE);
      prismaMock.attendanceRecord.findUnique.mockResolvedValue(null);
      prismaMock.attendanceRecord.create.mockRejectedValue({
        code: 'P2002',
        meta: { target: ['employeeId', 'date'] },
      });

      await expect(service.createRecord(baseDto, 'actor-1')).rejects.toThrow(
        ConflictException,
      );
      await expect(
        service.createRecord(baseDto, 'actor-1'),
      ).rejects.toThrow(/already exists for this employee on this date/i);
    });

    it('rethrows non-unique failures from the create', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(EMPLOYEE_ACTIVE);
      prismaMock.attendanceRecord.findUnique.mockResolvedValue(null);
      prismaMock.attendanceRecord.create.mockRejectedValue(new Error('boom'));

      await expect(service.createRecord(baseDto, 'actor-1')).rejects.toThrow(
        'boom',
      );
    });

    it('throws 404 when the employee is missing', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(null);
      await expect(service.createRecord(baseDto, 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws 400 when the employee is terminated', async () => {
      prismaMock.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: 'terminated',
      });
      await expect(service.createRecord(baseDto, 'actor-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws 400 when the employee is inactive', async () => {
      prismaMock.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: 'inactive',
      });
      await expect(service.createRecord(baseDto, 'actor-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws 400 when checkOut is before checkIn', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(EMPLOYEE_ACTIVE);
      prismaMock.attendanceRecord.findUnique.mockResolvedValue(null);

      await expect(
        service.createRecord(
          {
            ...baseDto,
            checkInTime: '2026-08-28T10:00:00Z',
            checkOutTime: '2026-08-28T09:00:00Z',
          },
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prismaMock.attendanceRecord.create).not.toHaveBeenCalled();
    });

    it('normalizes a non-midnight date string to UTC midnight for the unique key', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(EMPLOYEE_ACTIVE);
      prismaMock.attendanceRecord.findUnique.mockResolvedValue(null);
      prismaMock.attendanceRecord.create.mockResolvedValue({ id: 'att-1' });

      await service.createRecord(
        { ...baseDto, date: '2026-08-28T15:30:00Z' },
        'actor-1',
      );
      const uniqueArg =
        prismaMock.attendanceRecord.findUnique.mock.calls[0][0].where
          .employeeId_date;
      expect(uniqueArg.date).toEqual(new Date('2026-08-28T00:00:00.000Z'));
    });
  });

  describe('updateRecord', () => {
    const existing = {
      id: 'att-1',
      employeeId: 'emp-1',
      date: new Date('2026-08-28T00:00:00.000Z'),
      status: 'PRESENT',
      checkInTime: new Date('2026-08-28T09:00:00Z'),
      checkOutTime: null,
    };

    it('updates only the provided subset (date/employeeId immutable)', async () => {
      prismaMock.attendanceRecord.findUnique.mockResolvedValue(existing);
      prismaMock.attendanceRecord.update.mockResolvedValue({
        ...existing,
        status: 'LATE',
      });

      await service.updateRecord(
        'att-1',
        { status: 'LATE' as const, note: 'late by bus' },
        'actor-1',
      );
      const updateArg = prismaMock.attendanceRecord.update.mock.calls[0][0];
      expect(updateArg.where).toEqual({ id: 'att-1' });
      expect(updateArg.data).toEqual(
        expect.objectContaining({ status: 'LATE', note: 'late by bus' }),
      );
      expect(updateArg.data).not.toHaveProperty('employeeId');
      expect(updateArg.data).not.toHaveProperty('date');
    });

    it('validates checkOut >= checkIn using merged values on update', async () => {
      prismaMock.attendanceRecord.findUnique.mockResolvedValue(existing);
      await expect(
        service.updateRecord('att-1', {
          checkOutTime: '2026-08-28T08:00:00Z',
        } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prismaMock.attendanceRecord.update).not.toHaveBeenCalled();
    });

    it('throws 404 when the record is missing', async () => {
      prismaMock.attendanceRecord.findUnique.mockResolvedValue(null);
      await expect(
        service.updateRecord('missing', { note: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('applies date range + employee/status/department filters with pagination', async () => {
      prismaMock.attendanceRecord.count.mockResolvedValue(3);
      prismaMock.attendanceRecord.findMany.mockResolvedValue([
        { id: 'att-1', employee: {} },
      ]);

      const res = await service.findAll(
        {
          date: '2026-08-28',
          employeeId: 'emp-1',
          status: 'PRESENT',
          departmentId: 'dept-1',
        },
        2,
        10,
      );

      expect(prismaMock.attendanceRecord.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          employeeId: 'emp-1',
          status: 'PRESENT',
        }),
      });
      const where = prismaMock.attendanceRecord.findMany.mock.calls[0][0].where;
      expect(where.employeeId).toBe('emp-1');
      expect(where.status).toBe('PRESENT');
      expect(where.employee).toEqual({ departmentId: 'dept-1' });
      expect(where.date).toEqual({
        gte: new Date('2026-08-28T00:00:00.000Z'),
        lt: new Date('2026-08-29T00:00:00.000Z'),
      });
      const call = prismaMock.attendanceRecord.findMany.mock.calls[0][0];
      expect(call.skip).toBe(10);
      expect(call.take).toBe(10);
      expect(call.orderBy).toEqual({ date: 'desc' });
      expect(call.include.employee).toEqual(
        expect.objectContaining({
          select: expect.objectContaining({
            employeeId: true,
            status: true,
            department: { select: { name: true } },
            designation: { select: { name: true } },
            betterAuthUser: { select: { name: true } },
          }),
        }),
      );
      expect(res).toEqual({
        data: [{ id: 'att-1', employee: {} }],
        meta: { total: 3, page: 2, perPage: 10, totalPages: 1 },
      });
    });

    it('omits date filter when absent', async () => {
      prismaMock.attendanceRecord.count.mockResolvedValue(0);
      prismaMock.attendanceRecord.findMany.mockResolvedValue([]);
      await service.findAll({ employeeId: 'emp-1' }, 1, 20);
      const where = prismaMock.attendanceRecord.findMany.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('date');
    });
  });

  describe('findOne', () => {
    it('returns the record with employee details', async () => {
      prismaMock.attendanceRecord.findUnique.mockResolvedValue({
        id: 'att-1',
        employee: {},
      });
      const res = await service.findOne('att-1');
      expect(res).toEqual({ id: 'att-1', employee: {} });
      expect(prismaMock.attendanceRecord.findUnique).toHaveBeenCalledWith({
        where: { id: 'att-1' },
        include: { employee: expect.anything() },
      });
    });

    it('throws 404 when missing', async () => {
      prismaMock.attendanceRecord.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('dailyOverview', () => {
    it('returns per-status counts with zeros for missing statuses', async () => {
      prismaMock.attendanceRecord.groupBy.mockResolvedValue([
        { status: 'PRESENT', _count: { _all: 5 } },
        { status: 'LATE', _count: { _all: 2 } },
      ]);

      const res = await service.dailyOverview('2026-08-28');

      expect(prismaMock.attendanceRecord.groupBy).toHaveBeenCalledWith({
        by: ['status'],
        where: { date: new Date('2026-08-28T00:00:00.000Z') },
        _count: { _all: true },
      });
      expect(res).toEqual({
        date: new Date('2026-08-28T00:00:00.000Z'),
        total: 7,
        counts: {
          PRESENT: 5,
          ABSENT: 0,
          LATE: 2,
          HALF_DAY: 0,
          ON_LEAVE: 0,
          WEEKLY_OFF: 0,
        },
      });
    });
  });

  describe('history', () => {
    it('filters by employee and optional inclusive range, ordered date desc', async () => {
      prismaMock.attendanceRecord.findMany.mockResolvedValue([
        { id: 'att-3' },
        { id: 'att-1' },
      ]);
      const res = await service.history('emp-1', '2026-08-01', '2026-08-31');
      const call = prismaMock.attendanceRecord.findMany.mock.calls[0][0];
      expect(call.where).toEqual({
        employeeId: 'emp-1',
        date: {
          gte: new Date('2026-08-01T00:00:00.000Z'),
          lte: new Date('2026-08-31T00:00:00.000Z'),
        },
      });
      expect(call.orderBy).toEqual({ date: 'desc' });
      expect(res).toEqual([{ id: 'att-3' }, { id: 'att-1' }]);
    });

    it('omits date bounds when not provided', async () => {
      prismaMock.attendanceRecord.findMany.mockResolvedValue([]);
      await service.history('emp-1');
      const call = prismaMock.attendanceRecord.findMany.mock.calls[0][0];
      expect(call.where).toEqual({ employeeId: 'emp-1' });
    });
  });
});