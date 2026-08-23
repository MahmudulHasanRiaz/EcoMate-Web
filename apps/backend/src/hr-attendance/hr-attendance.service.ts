import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, AttendanceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';

const EMPLOYEE_SELECT = {
  employeeId: true,
  status: true,
  department: { select: { name: true } },
  designation: { select: { name: true } },
  betterAuthUser: { select: { name: true } },
} satisfies Prisma.EmployeeSelect;

@Injectable()
export class HrAttendanceService {
  constructor(private prisma: PrismaService) {}

  /**
   * Normalize any date value to UTC midnight so the
   * (employeeId, date) unique key is stable regardless of input time.
   */
  private normalizeDate(value: string | Date): Date {
    const d = new Date(value);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  private validateTimes(checkIn: Date | null, checkOut: Date | null) {
    if (checkIn && checkOut && checkOut < checkIn) {
      throw new BadRequestException(
        'checkOutTime must be on or after checkInTime',
      );
    }
  }

  async createRecord(dto: CreateAttendanceDto, actorId?: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.status === 'terminated' || employee.status === 'inactive') {
      throw new BadRequestException(
        `Cannot record attendance for an ${employee.status} employee`,
      );
    }

    const date = this.normalizeDate(dto.date);
    const checkInTime = dto.checkInTime ? new Date(dto.checkInTime) : null;
    const checkOutTime = dto.checkOutTime ? new Date(dto.checkOutTime) : null;
    this.validateTimes(checkInTime, checkOutTime);

    const existing = await this.prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId: dto.employeeId, date } },
    });
    if (existing) {
      throw new ConflictException(
        'Attendance record already exists for this employee on this date',
      );
    }

    try {
      return await this.prisma.attendanceRecord.create({
        data: {
          employeeId: dto.employeeId,
          date,
          status: dto.status,
          checkInTime,
          checkOutTime,
          note: dto.note ?? null,
          recordedById: actorId ?? null,
        },
      });
    } catch (err) {
      // Race guard: two concurrent creates for the same (employeeId, date)
      // can both pass the pre-check above; the unique constraint then fires
      // P2002 — surface as a friendly 409, not a raw Prisma error.
      if ((err as { code?: string } | null)?.code === 'P2002') {
        throw new ConflictException(
          'Attendance record already exists for this employee on this date',
        );
      }
      throw err;
    }
  }

  async updateRecord(id: string, dto: UpdateAttendanceDto, actorId?: string) {
    const existing = await this.prisma.attendanceRecord.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Attendance record not found');

    const checkInTime =
      dto.checkInTime !== undefined ? new Date(dto.checkInTime) : existing.checkInTime;
    const checkOutTime =
      dto.checkOutTime !== undefined
        ? new Date(dto.checkOutTime)
        : existing.checkOutTime;
    this.validateTimes(checkInTime, checkOutTime);

    return this.prisma.attendanceRecord.update({
      where: { id },
      data: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.checkInTime !== undefined ? { checkInTime } : {}),
        ...(dto.checkOutTime !== undefined ? { checkOutTime } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
    });
  }

  async findOne(id: string) {
    const record = await this.prisma.attendanceRecord.findUnique({
      where: { id },
      include: { employee: { select: EMPLOYEE_SELECT } },
    });
    if (!record) throw new NotFoundException('Attendance record not found');
    return record;
  }

  async findAll(
    filter: {
      date?: string;
      employeeId?: string;
      status?: string;
      departmentId?: string;
    } = {},
    page = 1,
    perPage = 20,
  ) {
    page = Math.max(1, page);
    perPage = Math.max(1, Math.min(100, perPage));
    const where: Prisma.AttendanceRecordWhereInput = {};
    if (filter.employeeId) where.employeeId = filter.employeeId;
    if (filter.status) where.status = filter.status as AttendanceStatus;
    if (filter.date) {
      const start = this.normalizeDate(filter.date);
      where.date = { gte: start, lt: new Date(start.getTime() + 86400000) };
    }
    if (filter.departmentId) {
      where.employee = { departmentId: filter.departmentId };
    }

    const [data, total] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { date: 'desc' },
        include: { employee: { select: EMPLOYEE_SELECT } },
      }),
      this.prisma.attendanceRecord.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async dailyOverview(dateStr: string) {
    const date = this.normalizeDate(dateStr);
    const rows = await this.prisma.attendanceRecord.groupBy({
      by: ['status'],
      where: { date },
      _count: { _all: true },
    });
    const counts: Record<AttendanceStatus, number> = {
      PRESENT: 0,
      ABSENT: 0,
      LATE: 0,
      HALF_DAY: 0,
      ON_LEAVE: 0,
      WEEKLY_OFF: 0,
    };
    let total = 0;
    for (const row of rows) {
      counts[row.status] = row._count._all;
      total += row._count._all;
    }
    return { date, total, counts };
  }

  async history(employeeId: string, from?: string, to?: string) {
    const where: Prisma.AttendanceRecordWhereInput = { employeeId };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = this.normalizeDate(from);
      if (to) where.date.lte = this.normalizeDate(to);
    }
    return this.prisma.attendanceRecord.findMany({
      where,
      orderBy: { date: 'desc' },
    });
  }
}