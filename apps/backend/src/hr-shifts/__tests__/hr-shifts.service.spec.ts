import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ShiftService } from '../hr-shifts.service';

describe('ShiftService', () => {
  let service: ShiftService;
  let prisma: any;

  const preset = (over: Record<string, any> = {}) => ({
    id: 'sp-1',
    name: 'General',
    code: 'GENERAL',
    startTime: '09:00',
    endTime: '17:00',
    graceMinutes: 10,
    breakMinutes: 60,
    standardMinutes: 420,
    overnight: false,
    isActive: true,
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      shiftPreset: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(preset()),
        update: jest.fn().mockResolvedValue(preset()),
      },
      shiftAssignment: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'sa-1' }),
        update: jest.fn().mockResolvedValue({ id: 'sa-1' }),
      },
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 'emp-1' }) },
      employmentHistory: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ShiftService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ShiftService);
    jest.clearAllMocks();
    prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
    prisma.shiftAssignment.count.mockResolvedValue(0);
    prisma.shiftAssignment.findFirst.mockResolvedValue(null);
    prisma.shiftPreset.findUnique.mockResolvedValue(preset());
  });

  describe('standard minutes', () => {
    const base = { name: 'General', code: 'GENERAL', graceMinutes: 10 };

    it('is the span minus the break', async () => {
      await service.createPreset({
        ...base,
        startTime: '09:00',
        endTime: '17:00',
        breakMinutes: 60,
      });
      const data = prisma.shiftPreset.create.mock.calls[0][0].data;
      expect(data.standardMinutes).toBe(420);
      expect(data.overnight).toBe(false);
    });

    it('handles an overnight span by counting through midnight', async () => {
      await service.createPreset({
        ...base,
        startTime: '22:00',
        endTime: '06:00',
        breakMinutes: 60,
      });
      const data = prisma.shiftPreset.create.mock.calls[0][0].data;
      expect(data.standardMinutes).toBe(420);
      expect(data.overnight).toBe(true);
    });

    it('rejects a zero-length shift', async () => {
      await expect(
        service.createPreset({
          ...base,
          startTime: '09:00',
          endTime: '09:00',
          breakMinutes: 0,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a break that consumes the whole shift', async () => {
      await expect(
        service.createPreset({
          ...base,
          startTime: '09:00',
          endTime: '17:00',
          breakMinutes: 480,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('deactivate', () => {
    it('soft-deletes an unassigned preset', async () => {
      await service.deactivatePreset('sp-1');
      expect(prisma.shiftPreset.update).toHaveBeenCalledWith({
        where: { id: 'sp-1' },
        data: { isActive: false },
      });
    });

    it('refuses while a live rotation still uses it, and says how many', async () => {
      prisma.shiftAssignment.count.mockResolvedValue(3);
      await expect(service.deactivatePreset('sp-1')).rejects.toThrow(/3 employee rotations/);
      expect(prisma.shiftPreset.update).not.toHaveBeenCalled();
    });

    it('uses the singular form for exactly one rotation', async () => {
      prisma.shiftAssignment.count.mockResolvedValue(1);
      await expect(service.deactivatePreset('sp-1')).rejects.toThrow(
        /1 employee rotation still uses it/,
      );
    });
  });

  describe('rotation', () => {
    it('returns the current weekday assignments in order', async () => {
      prisma.shiftAssignment.findMany.mockResolvedValue([
        { dayOfWeek: 1, shiftPreset: preset({ id: 'sp-a', name: 'Morning' }) },
        { dayOfWeek: 0, shiftPreset: preset({ id: 'sp-b', name: 'Night' }) },
      ]);
      const res = await service.getRotation('emp-1');
      expect(res.rotation.map((r) => r.dayOfWeek)).toEqual([0, 1]);
      expect(res.rotation[1].shift.name).toBe('Morning');
    });

    it('throws when the employee does not exist', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      await expect(service.getRotation('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('closes the open row and opens a new one when a weekday changes', async () => {
      prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
      prisma.shiftAssignment.findFirst.mockResolvedValue({
        id: 'sa-old',
        shiftPresetId: 'sp-old',
        dayOfWeek: 1,
        shiftPreset: preset({ id: 'sp-old', name: 'Old' }),
      });

      const res = await service.setRotationDay('emp-1', 1, 'sp-1', 'admin-1');

      expect(res.changed).toBe(true);
      expect(prisma.shiftAssignment.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'sa-old' } }),
      );
      expect(prisma.shiftAssignment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ dayOfWeek: 1, shiftPresetId: 'sp-1', createdById: 'admin-1' }),
        }),
      );
      expect(prisma.employmentHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ field: 'shift', oldValue: '1:Old', newValue: '1:General' }),
        }),
      );
    });

    it('is a no-op when the same preset is already in force', async () => {
      prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
      prisma.shiftAssignment.findFirst.mockResolvedValue({
        id: 'sa-1',
        shiftPresetId: 'sp-1',
        dayOfWeek: 1,
        shiftPreset: preset(),
      });

      const res = await service.setRotationDay('emp-1', 1, 'sp-1');

      expect(res.changed).toBe(false);
      // No churn: an unchanged assignment must not close and reopen its row.
      expect(prisma.shiftAssignment.create).not.toHaveBeenCalled();
      expect(prisma.shiftAssignment.update).not.toHaveBeenCalled();
      expect(prisma.employmentHistory.create).not.toHaveBeenCalled();
    });

    it('refuses to assign a retired preset', async () => {
      prisma.shiftPreset.findUnique.mockResolvedValue(preset({ isActive: false }));
      await expect(service.setRotationDay('emp-1', 1, 'sp-1')).rejects.toThrow(/retired/);
    });

    it('throws when the preset does not exist', async () => {
      prisma.shiftPreset.findUnique.mockResolvedValue(null);
      await expect(service.setRotationDay('emp-1', 1, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('clearing a weekday closes the row and records the removal', async () => {
      prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
      prisma.shiftAssignment.findFirst.mockResolvedValue({
        id: 'sa-1',
        dayOfWeek: 6,
        shiftPreset: preset({ name: 'Morning' }),
      });

      const res = await service.clearRotationDay('emp-1', 6, 'admin-1');

      expect(res.changed).toBe(true);
      expect(prisma.employmentHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ oldValue: '6:Morning', newValue: null }),
        }),
      );
    });

    it('clearing an empty weekday is a no-op', async () => {
      prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
      const res = await service.clearRotationDay('emp-1', 6);
      expect(res.changed).toBe(false);
      expect(prisma.employmentHistory.create).not.toHaveBeenCalled();
    });
  });

  describe('resolveFor', () => {
    // resolveFor uses findMany + orderBy so the newest effective row wins even
    // when a rotation was reassigned mid-day.
    const resolveWhere = () =>
      prisma.shiftAssignment.findMany.mock.calls[0][0];

    it('returns the assignment in force on that weekday', async () => {
      prisma.shiftAssignment.findMany.mockResolvedValue([
        { shiftPreset: preset() },
      ]);
      const res = await service.resolveFor('emp-1', new Date('2026-08-24T00:00:00.000Z'));
      expect(res).toMatchObject({ startTime: '09:00', standardMinutes: 420 });
    });

    it('returns null when that weekday has no shift', async () => {
      prisma.shiftAssignment.findMany.mockResolvedValue([]);
      await expect(
        service.resolveFor('emp-1', new Date('2026-08-24T00:00:00.000Z')),
      ).resolves.toBeNull();
    });

    it('matches on the Dhaka weekday of the business day', async () => {
      prisma.shiftAssignment.findMany.mockResolvedValue([]);
      // 2026-08-24 is a Monday (weekday 1).
      await service.resolveFor('emp-1', new Date('2026-08-24T00:00:00.000Z'));
      expect(resolveWhere().where.dayOfWeek).toBe(1);
    });

    it('ignores assignments that were not yet effective or have expired', async () => {
      prisma.shiftAssignment.findMany.mockResolvedValue([]);
      await service.resolveFor('emp-1', new Date('2026-08-24T00:00:00.000Z'));
      const where = resolveWhere().where;
      expect(where.effectiveFrom).toEqual({ lt: new Date('2026-08-25T00:00:00.000Z') });
      expect(where.OR).toEqual([
        { effectiveTo: null },
        { effectiveTo: { gt: new Date('2026-08-24T00:00:00.000Z') } },
      ]);
    });

    it('takes only the newest effective row so a mid-day reassignment wins', async () => {
      // findFirst without an orderBy has no defined result and could return the
      // closed (old) row, silently resolving yesterday's shift.
      prisma.shiftAssignment.findMany.mockResolvedValue([
        { shiftPreset: preset({ name: 'New' }) },
      ]);
      await service.resolveFor('emp-1', new Date('2026-08-24T00:00:00.000Z'));
      const args = prisma.shiftAssignment.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual({ effectiveFrom: 'desc' });
      expect(args.take).toBe(1);
    });

    it('resolves on the very day the shift was assigned', async () => {
      // A shift saved at 09:34 must still govern that day. Filtering on
      // effectiveFrom <= day would miss it, because the row timestamp is later
      // than the day boundary — this is the regression guard for that.
      prisma.shiftAssignment.findMany.mockResolvedValue([
        { shiftPreset: preset() },
      ]);
      const day = new Date('2026-08-24T00:00:00.000Z');
      await service.resolveFor('emp-1', day);
      const where = resolveWhere().where;
      // The window is the whole business day, not "up to midnight".
      expect(where.effectiveFrom.lt.getTime()).toBe(day.getTime() + 86400000);
      expect(where.effectiveFrom.lt.getTime()).toBeGreaterThan(day.getTime());
    });

    it('keeps a row closed mid-day in force for that day', async () => {
      prisma.shiftAssignment.findMany.mockResolvedValue([]);
      const day = new Date('2026-08-24T00:00:00.000Z');
      await service.resolveFor('emp-1', day);
      expect(resolveWhere().where.OR[1].effectiveTo.gt.getTime()).toBe(day.getTime());
    });
  });

  describe('findOrCreateCustomPreset', () => {
    it('returns existing preset when times match an active one', async () => {
      const match = preset({ id: 'sp-matched', startTime: '10:00', endTime: '18:00' });
      prisma.shiftPreset.findFirst.mockResolvedValue(match);

      const res = await service.findOrCreateCustomPreset({
        startTime: '10:00',
        endTime: '18:00',
      });
      expect(res.id).toBe('sp-matched');
      expect(prisma.shiftPreset.create).not.toHaveBeenCalled();
    });

    it('creates a new custom preset when no match exists', async () => {
      prisma.shiftPreset.findFirst.mockResolvedValue(null);
      prisma.shiftPreset.findUnique.mockResolvedValue(null);
      prisma.shiftPreset.create.mockResolvedValue(
        preset({ id: 'sp-custom', name: 'Custom (11:00–19:00)', code: 'CUSTOM_1100_1900' }),
      );

      const res = await service.findOrCreateCustomPreset({
        startTime: '11:00',
        endTime: '19:00',
        graceMinutes: 15,
        breakMinutes: 45,
      });

      expect(res.id).toBe('sp-custom');
      expect(prisma.shiftPreset.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            startTime: '11:00',
            endTime: '19:00',
            graceMinutes: 15,
            breakMinutes: 45,
            standardMinutes: 435, // 8 hours (480) - 45 = 435
          }),
        }),
      );
    });
  });

  describe('bulkSetRotation & quickAssignPreset', () => {
    beforeEach(() => {
      prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
    });

    it('applies assignments across multiple weekdays atomically', async () => {
      prisma.shiftAssignment.findFirst.mockResolvedValue(null);
      prisma.shiftPreset.findUnique.mockResolvedValue(preset());

      const res = await service.bulkSetRotation('emp-1', [
        { dayOfWeek: 0, shiftPresetId: 'sp-1' },
        { dayOfWeek: 1, shiftPresetId: 'sp-1' },
        { dayOfWeek: 2, shiftPresetId: null }, // clear
      ]);

      expect(res.total).toBe(3);
      expect(prisma.shiftAssignment.create).toHaveBeenCalledTimes(2);
    });

    it('quickAssignPreset targets workdays (Sun-Thu by default)', async () => {
      prisma.shiftAssignment.findFirst.mockResolvedValue(null);
      prisma.shiftPreset.findUnique.mockResolvedValue(preset());

      const res = await service.quickAssignPreset('emp-1', 'sp-1');
      expect(res.total).toBe(5);
      expect(prisma.shiftAssignment.create).toHaveBeenCalledTimes(5);
    });
  });
});