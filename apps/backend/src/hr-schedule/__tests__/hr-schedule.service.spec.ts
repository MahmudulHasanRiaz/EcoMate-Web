import { Test } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { HrScheduleService } from '../hr-schedule.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('HrScheduleService', () => {
  let service: HrScheduleService;
  let prisma: PrismaService;

  const mockEmployee = { id: 'emp-1', employeeId: 'EMP-250624-0001' };

  beforeEach(async () => {
    const prismaMock = {
      employee: {
        findUnique: jest.fn().mockResolvedValue(mockEmployee),
      },
      weeklyOff: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      employmentHistory: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(
      async (cb: (tx: typeof prismaMock) => Promise<unknown>) => cb(prismaMock),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrScheduleService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<HrScheduleService>(HrScheduleService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('getSchedule', () => {
    it('should return sorted deduped days from active rows', async () => {
      (prisma.weeklyOff.findMany as jest.Mock).mockResolvedValue([
        { dayOfWeek: 3 },
        { dayOfWeek: 0 },
        { dayOfWeek: 3 },
      ]);
      const result = await service.getSchedule('emp-1');
      expect(result).toEqual({ days: [0, 3] });
      expect(prisma.weeklyOff.findMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1', effectiveTo: null },
        select: { dayOfWeek: true },
      });
    });

    it('should return empty days when no schedule set', async () => {
      const result = await service.getSchedule('emp-1');
      expect(result).toEqual({ days: [] });
    });

    it('should throw NotFound when employee missing', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.getSchedule('nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('setSchedule', () => {
    it('should close open rows and create new rows + history on change', async () => {
      (prisma.weeklyOff.findMany as jest.Mock).mockResolvedValue([
        { dayOfWeek: 0 },
        { dayOfWeek: 1 },
      ]);
      const result = await service.setSchedule(
        'emp-1',
        { days: [1, 2], note: 'team day' },
        null,
      );
      expect(prisma.weeklyOff.updateMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1', effectiveTo: null },
        data: { effectiveTo: expect.any(Date) },
      });
      expect(prisma.weeklyOff.createMany).toHaveBeenCalledWith({
        data: [
          {
            employeeId: 'emp-1',
            dayOfWeek: 1,
            effectiveFrom: expect.any(Date),
            createdById: null,
            note: 'team day',
          },
          {
            employeeId: 'emp-1',
            dayOfWeek: 2,
            effectiveFrom: expect.any(Date),
            createdById: null,
            note: 'team day',
          },
        ],
      });
      expect(prisma.employmentHistory.createMany).toHaveBeenCalledWith({
        data: [
          {
            employeeId: 'emp-1',
            field: 'weekly_off',
            oldValue: '[0,1]',
            newValue: '[1,2]',
            effectiveFrom: expect.any(Date),
            changedById: null,
          },
        ],
      });
      expect(result).toEqual({ days: [1, 2] });
    });

    it('should clear open rows only when days empty', async () => {
      (prisma.weeklyOff.findMany as jest.Mock).mockResolvedValue([
        { dayOfWeek: 0 },
        { dayOfWeek: 1 },
      ]);
      const result = await service.setSchedule('emp-1', { days: [] });
      expect(prisma.weeklyOff.updateMany).toHaveBeenCalled();
      expect(prisma.weeklyOff.createMany).not.toHaveBeenCalled();
      expect(prisma.employmentHistory.createMany).not.toHaveBeenCalled();
      expect(result).toEqual({ days: [] });
    });

    it('should skip recreation when schedule identical', async () => {
      (prisma.weeklyOff.findMany as jest.Mock).mockResolvedValue([
        { dayOfWeek: 0 },
        { dayOfWeek: 2 },
      ]);
      const result = await service.setSchedule('emp-1', { days: [2, 0] });
      expect(prisma.weeklyOff.createMany).not.toHaveBeenCalled();
      expect(prisma.employmentHistory.createMany).not.toHaveBeenCalled();
      expect(result).toEqual({ days: [0, 2] });
    });

    it('should record actor as createdById and changedById', async () => {
      (prisma.weeklyOff.findMany as jest.Mock).mockResolvedValue([
        { dayOfWeek: 0 },
      ]);
      await service.setSchedule('emp-1', { days: [3] }, 'actor-1');
      expect(prisma.weeklyOff.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ createdById: 'actor-1' }),
          ]),
        }),
      );
      expect(prisma.employmentHistory.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ changedById: 'actor-1' }),
          ]),
        }),
      );
    });

    it('should throw BadRequest for out-of-range day', async () => {
      await expect(
        service.setSchedule('emp-1', { days: [7] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequest for negative day', async () => {
      await expect(
        service.setSchedule('emp-1', { days: [-1] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequest for duplicate days', async () => {
      await expect(
        service.setSchedule('emp-1', { days: [0, 0] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequest for more than 7 entries', async () => {
      await expect(
        service.setSchedule('emp-1', { days: [0, 1, 2, 3, 4, 5, 6, 0] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFound when employee missing', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.setSchedule('nope', { days: [0] }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getHistory', () => {
    it('should return paginated history with meta', async () => {
      const rows = [
        {
          id: 'h1',
          field: 'status',
          oldValue: 'active',
          newValue: 'on_leave',
          effectiveFrom: new Date(),
          changedBy: { firstName: 'Admin', lastName: 'Ops' },
        },
      ];
      (prisma.employmentHistory.findMany as jest.Mock).mockResolvedValue(rows);
      (prisma.employmentHistory.count as jest.Mock).mockResolvedValue(3);
      const result = await service.getHistory('emp-1', 2, 1);
      expect(prisma.employmentHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { employeeId: 'emp-1' },
          skip: 1,
          take: 1,
        }),
      );
      expect(result.data).toEqual(rows);
      expect(result.meta).toEqual({ total: 3, page: 2, perPage: 1, totalPages: 3 });
    });

    it('should default to page 1 perPage 20', async () => {
      await service.getHistory('emp-1');
      expect(prisma.employmentHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('should throw NotFound when employee missing', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.getHistory('nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});