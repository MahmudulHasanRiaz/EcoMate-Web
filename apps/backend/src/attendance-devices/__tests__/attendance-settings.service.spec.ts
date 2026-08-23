import { Test } from '@nestjs/testing';
import { AttendanceSettingsService } from '../attendance-settings.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AttendanceSettingsService', () => {
  let service: AttendanceSettingsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      attendanceSettings: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        AttendanceSettingsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(AttendanceSettingsService);
  });

  describe('getSettings', () => {
    it('returns the seeded mode row', async () => {
      prisma.attendanceSettings.findUnique.mockResolvedValue({
        id: 'global',
        mode: 'MACHINE',
        updatedAt: new Date('2026-08-24T10:00:00.000Z'),
      });
      const res = await service.getSettings();
      expect(prisma.attendanceSettings.findUnique).toHaveBeenCalledWith({
        where: { id: 'global' },
      });
      expect(res.mode).toBe('MACHINE');
    });

    it('defaults to APP when no row exists yet', async () => {
      prisma.attendanceSettings.findUnique.mockResolvedValue(null);
      const res = await service.getSettings();
      expect(res).toMatchObject({ id: 'global', mode: 'APP' });
    });
  });

  describe('updateSettings', () => {
    it('upserts mode and records updatedById', async () => {
      prisma.attendanceSettings.upsert.mockResolvedValue({
        id: 'global',
        mode: 'BOTH',
        updatedById: 'user-1',
        updatedAt: new Date(),
      });
      const res = await service.updateSettings('BOTH', 'user-1');
      expect(prisma.attendanceSettings.upsert).toHaveBeenCalledWith({
        where: { id: 'global' },
        update: { mode: 'BOTH', updatedById: 'user-1' },
        create: { id: 'global', mode: 'BOTH', updatedById: 'user-1' },
      });
      expect(res.mode).toBe('BOTH');
      expect(res.updatedById).toBe('user-1');
    });

    it('persists updatedAt on the row', async () => {
      const stamp = new Date('2026-08-24T11:00:00.000Z');
      prisma.attendanceSettings.upsert.mockResolvedValue({
        id: 'global',
        mode: 'APP',
        updatedById: 'user-1',
        updatedAt: stamp,
      });
      const res = await service.updateSettings('APP', 'user-1');
      expect(res.updatedAt).toEqual(stamp);
    });
  });
});