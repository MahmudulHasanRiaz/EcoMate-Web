import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SetScheduleDto } from './dto/set-schedule.dto';

@Injectable()
export class HrScheduleService {
  constructor(private prisma: PrismaService) {}

  private async ensureEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  async getSchedule(employeeId: string) {
    await this.ensureEmployee(employeeId);
    const rows = await this.prisma.weeklyOff.findMany({
      where: { employeeId, effectiveTo: null },
      select: { dayOfWeek: true },
    });
    const days = [...new Set(rows.map((r) => r.dayOfWeek))].sort(
      (a, b) => a - b,
    );
    return { days };
  }

  async setSchedule(
    employeeId: string,
    dto: SetScheduleDto,
    actorId?: string | null,
  ) {
    await this.ensureEmployee(employeeId);
    this.validateDays(dto.days);
    const newDays = [...new Set(dto.days)].sort((a, b) => a - b);

    return this.prisma.$transaction(async (tx) => {
      const open = await tx.weeklyOff.findMany({
        where: { employeeId, effectiveTo: null },
        select: { dayOfWeek: true },
      });
      const oldDays = [...new Set(open.map((r) => r.dayOfWeek))].sort(
        (a, b) => a - b,
      );
      const now = new Date();

      if (open.length > 0) {
        await tx.weeklyOff.updateMany({
          where: { employeeId, effectiveTo: null },
          data: { effectiveTo: now },
        });
      }

      if (
        newDays.length > 0 &&
        JSON.stringify(oldDays) !== JSON.stringify(newDays)
      ) {
        await tx.weeklyOff.createMany({
          data: newDays.map((day) => ({
            employeeId,
            dayOfWeek: day,
            effectiveFrom: now,
            createdById: actorId ?? null,
            note: dto.note ?? null,
          })),
        });
        await tx.employmentHistory.createMany({
          data: [
            {
              employeeId,
              field: 'weekly_off',
              oldValue: JSON.stringify(oldDays),
              newValue: JSON.stringify(newDays),
              effectiveFrom: now,
              changedById: actorId ?? null,
            },
          ],
        });
      }

      return { days: newDays };
    });
  }

  async getHistory(employeeId: string, page = 1, perPage = 20) {
    await this.ensureEmployee(employeeId);
    const [data, total] = await Promise.all([
      this.prisma.employmentHistory.findMany({
        where: { employeeId },
        orderBy: { effectiveFrom: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          field: true,
          oldValue: true,
          newValue: true,
          effectiveFrom: true,
          changedBy: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.employmentHistory.count({ where: { employeeId } }),
    ]);
    return {
      data,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  private validateDays(days: number[]) {
    if (days.length > 7) {
      throw new BadRequestException('days must not exceed 7 entries');
    }
    for (const day of days) {
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        throw new BadRequestException(
          'days must be integers between 0 and 6',
        );
      }
    }
    if (new Set(days).size !== days.length) {
      throw new BadRequestException('days must be unique');
    }
  }
}