import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceModeSetting } from '@prisma/client';

@Injectable()
export class AttendanceSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings() {
    const settings = await this.prisma.attendanceSettings.findUnique({
      where: { id: 'global' },
    });
    if (!settings) {
      return { id: 'global', mode: 'APP' as const };
    }
    return settings;
  }

  async updateSettings(mode: AttendanceModeSetting, updatedById?: string) {
    return this.prisma.attendanceSettings.upsert({
      where: { id: 'global' },
      update: { mode, updatedById },
      create: { id: 'global', mode, updatedById },
    });
  }
}