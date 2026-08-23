import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, AttendanceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DAY_INCLUDE = {
  sessions: { include: { breaks: true }, orderBy: { checkInAt: 'asc' as const } },
} satisfies Prisma.AttendanceDayInclude;

type DayWithSessions = Prisma.AttendanceDayGetPayload<{ include: typeof DAY_INCLUDE }>;

const STATUS_VALUES: string[] = Object.values(AttendanceStatus);

type TransactionClient = Prisma.TransactionClient;

export interface MachineEventInput {
  employeeId: string;
  deviceId: string;
  eventType: 'CHECK_IN' | 'CHECK_OUT' | 'BREAK_START' | 'BREAK_END' | 'PUNCH';
  occurredAt: Date;
}

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

  /** Normalize any date value to UTC midnight so the (employeeId, date) unique key is stable. */
  private normalizeDate(value?: string | Date): Date {
    const d = value ? new Date(value) : new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  private async loadEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  // ------------------------------------------------------------------
  // Settings & mode enforcement
  // ------------------------------------------------------------------

  async getSettings(): Promise<{ mode: 'APP' | 'MACHINE' | 'BOTH' }> {
    const settings = await this.prisma.attendanceSettings.findUnique({
      where: { id: 'global' },
    });
    return { mode: settings?.mode ?? 'APP' };
  }

  /**
   * App-path permission for an employee given the global mode.
   * APP mode: app events authoritative (employee method ignored, NONE excepted).
   * MACHINE mode: app check-in blocked for ALL employees.
   * BOTH: per employee method.
   */
  async effectiveMethod(employee: {
    attendanceMethod?: string | null;
  }): Promise<{
    allowed: boolean;
    method: string;
    blockedReason?: string;
  }> {
    const { mode } = await this.getSettings();
    if (employee.attendanceMethod === 'NONE') {
      return {
        allowed: false,
        method: 'NONE',
        blockedReason: "This employee's attendance is disabled.",
      };
    }
    if (mode === 'MACHINE') {
      return {
        allowed: false,
        method: employee.attendanceMethod ?? 'APP',
        blockedReason: 'Application attendance is disabled in MACHINE mode.',
      };
    }
    if (mode === 'BOTH' && employee.attendanceMethod === 'MACHINE') {
      return {
        allowed: false,
        method: 'MACHINE',
        blockedReason:
          'This employee uses machine attendance. Application check-in is disabled.',
      };
    }
    return {
      allowed: true,
      method: mode === 'BOTH' ? (employee.attendanceMethod ?? 'APP') : 'APP',
    };
  }

  private async enforceAppPath(employee: {
    attendanceMethod?: string | null;
  }) {
    const res = await this.effectiveMethod(employee);
    if (!res.allowed) {
      throw new BadRequestException(res.blockedReason);
    }
  }

  private async enforceMachinePath(employee: {
    attendanceMethod?: string | null;
  }) {
    const { mode } = await this.getSettings();
    if (employee.attendanceMethod === 'NONE') {
      throw new BadRequestException("This employee's attendance is disabled.");
    }
    if (mode === 'APP') {
      throw new BadRequestException('Machine attendance is disabled in APP mode.');
    }
    if (mode === 'BOTH' && employee.attendanceMethod !== 'MACHINE') {
      throw new BadRequestException(
        'This employee uses application attendance. Machine events are disabled.',
      );
    }
  }

  // ------------------------------------------------------------------
  // Day lock + transaction helpers
  // ------------------------------------------------------------------

  private findDayById(tx: TransactionClient, id: string) {
    return tx.attendanceDay.findUnique({
      where: { id },
      include: DAY_INCLUDE,
    });
  }

  /**
   * Runs a state transition inside an interactive transaction that locks the
   * AttendanceDay row for (employeeId, date). Concurrent transitions for the
   * same day serialize on the lock; day creation races surface as P2002 and
   * are mapped to a friendly 409.
   */
  private async runDayTx<T>(
    employeeId: string,
    date: Date,
    fn: (tx: TransactionClient, day: DayWithSessions) => Promise<T>,
    opts: {
      createDay?: boolean;
      dayMethod?: string;
      note?: string;
      missingDayMessage?: string;
    } = {},
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked: { id: string }[] = await tx.$queryRaw`
          SELECT id FROM "AttendanceDay"
          WHERE "employeeId" = ${employeeId} AND date = ${date}::date
          FOR UPDATE
        `;
        let day: DayWithSessions | null =
          locked.length > 0 ? await this.findDayById(tx, locked[0].id) : null;
        if (!day) {
          if (!opts.createDay) {
            throw new BadRequestException(
              opts.missingDayMessage ?? 'Check In করার আগে Break শুরু করা যাবে না।',
            );
          }
          const created = await tx.attendanceDay.create({
            data: {
              employeeId,
              date,
              status: 'PRESENT',
              attendanceMethod: (opts.dayMethod as any) ?? 'APP',
              note: opts.note ?? null,
            },
          });
          day = { ...created, sessions: [] } as DayWithSessions;
        } else if (opts.note !== undefined) {
          day = await tx.attendanceDay.update({
            where: { id: day.id },
            data: { note: opts.note },
            include: DAY_INCLUDE,
          });
        }
        return fn(tx, day);
      });
    } catch (err) {
      // Concurrent day creation for the same (employeeId, date) — friendly 409.
      if ((err as { code?: string } | null)?.code === 'P2002') {
        throw new ConflictException(
          'এই Employee-এর জন্য আজকের Attendance ইতিমধ্যে শুরু হয়েছে।',
        );
      }
      throw err;
    }
  }

  private openSessionOf(day: DayWithSessions) {
    return day.sessions.find((s) => !s.checkOutAt);
  }

  private openBreakOf(session: DayWithSessions['sessions'][number]) {
    return session.breaks.find((b) => !b.endedAt);
  }

  /** worked = Σ(checkIn→checkOut per session, open counted to `at`) − Σ(break durations, running counted to `at`). */
  private computeMinutes(sessions: DayWithSessions['sessions'], at: Date) {
    let workedMs = 0;
    let breakMs = 0;
    for (const s of sessions) {
      const end = s.checkOutAt ?? at;
      workedMs += Math.max(0, end.getTime() - s.checkInAt.getTime());
      for (const b of s.breaks) {
        const bend = b.endedAt ?? at;
        const dur = Math.max(0, bend.getTime() - b.startedAt.getTime());
        breakMs += dur;
        workedMs -= dur;
      }
    }
    return {
      workedMinutes: Math.max(0, Math.floor(workedMs / 60000)),
      breakMinutes: Math.max(0, Math.floor(breakMs / 60000)),
    };
  }

  private async materializeDay(
    tx: TransactionClient,
    day: DayWithSessions,
    at: Date,
    note?: string,
  ) {
    const { workedMinutes, breakMinutes } = this.computeMinutes(day.sessions, at);
    const data: Prisma.AttendanceDayUpdateInput = { workedMinutes, breakMinutes };
    if (note !== undefined) data.note = note;
    await tx.attendanceDay.update({ where: { id: day.id }, data });
    day.workedMinutes = workedMinutes;
    day.breakMinutes = breakMinutes;
    return day;
  }

  // ------------------------------------------------------------------
  // State machine (APP flow)
  // ------------------------------------------------------------------

  async checkIn(
    employeeId: string,
    opts: { note?: string; date?: string | Date } = {},
  ) {
    const employee = await this.loadEmployee(employeeId);
    if (employee.status === 'terminated' || employee.status === 'inactive') {
      throw new BadRequestException(
        `Cannot record attendance for an ${employee.status} employee`,
      );
    }
    await this.enforceAppPath(employee);
    const date = this.normalizeDate(opts.date);
    return this.runDayTx(
      employeeId,
      date,
      async (tx, day) => {
        if (this.openSessionOf(day)) {
          throw new ConflictException(
            'এই Employee-এর জন্য আজকের Attendance ইতিমধ্যে শুরু হয়েছে।',
          );
        }
        return tx.attendanceSession.create({
          data: { dayId: day.id, source: 'APP', checkInAt: new Date() },
        });
      },
      { createDay: true, dayMethod: employee.attendanceMethod, note: opts.note },
    );
  }

  async breakStart(
    employeeId: string,
    opts: { date?: string | Date } = {},
  ) {
    const employee = await this.loadEmployee(employeeId);
    await this.enforceAppPath(employee);
    const date = this.normalizeDate(opts.date);
    return this.runDayTx(
      employeeId,
      date,
      async (tx, day) => {
        const session = this.openSessionOf(day);
        if (!session) {
          throw new BadRequestException(
            'Check In করার আগে Break শুরু করা যাবে না।',
          );
        }
        if (this.openBreakOf(session)) {
          throw new ConflictException('ইতিমধ্যে Break চলছে।');
        }
        return tx.attendanceBreak.create({
          data: { sessionId: session.id, startedAt: new Date() },
        });
      },
      {
        createDay: false,
        missingDayMessage: 'Check In করার আগে Break শুরু করা যাবে না।',
      },
    );
  }

  async breakEnd(
    employeeId: string,
    opts: { date?: string | Date } = {},
  ) {
    const employee = await this.loadEmployee(employeeId);
    await this.enforceAppPath(employee);
    const date = this.normalizeDate(opts.date);
    return this.runDayTx(
      employeeId,
      date,
      async (tx, day) => {
        const session = this.openSessionOf(day);
        if (!session) {
          throw new BadRequestException('কোনো চলমান Session নেই।');
        }
        const brk = this.openBreakOf(session);
        if (!brk) {
          throw new BadRequestException('কোনো চলমান Break নেই।');
        }
        return tx.attendanceBreak.update({
          where: { id: brk.id },
          data: { endedAt: new Date() },
        });
      },
      { createDay: false, missingDayMessage: 'কোনো চলমান Session নেই।' },
    );
  }

  async checkOut(
    employeeId: string,
    opts: { note?: string; date?: string | Date } = {},
  ) {
    const employee = await this.loadEmployee(employeeId);
    await this.enforceAppPath(employee);
    const date = this.normalizeDate(opts.date);
    return this.runDayTx(
      employeeId,
      date,
      async (tx, day) => {
        const session = this.openSessionOf(day);
        if (!session) {
          throw new BadRequestException('কোনো চলমান Session নেই।');
        }
        if (this.openBreakOf(session)) {
          throw new BadRequestException(
            'Check Out করার আগে active Break শেষ করুন।',
          );
        }
        const at = new Date();
        session.checkOutAt = at;
        return tx.attendanceSession
          .update({ where: { id: session.id }, data: { checkOutAt: at } })
          .then(() => this.materializeDay(tx, day, at, opts.note));
      },
      { createDay: false, missingDayMessage: 'কোনো চলমান Session নেই।' },
    );
  }

  // ------------------------------------------------------------------
  // Day state for the UI
  // ------------------------------------------------------------------

  async getDayState(employeeId: string, date?: string | Date) {
    const d = this.normalizeDate(date);
    const day = await this.prisma.attendanceDay.findUnique({
      where: { employeeId_date: { employeeId, date: d } },
      include: DAY_INCLUDE,
    });
    if (!day) {
      return { state: 'none', workedMinutes: 0, breakMinutes: 0 };
    }
    if (day.sessions.length === 0) {
      return { state: 'before_work', workedMinutes: 0, breakMinutes: 0 };
    }
    const now = new Date();
    const open = this.openSessionOf(day);
    if (open) {
      const { workedMinutes, breakMinutes } = this.computeMinutes(
        day.sessions,
        now,
      );
      return {
        state: this.openBreakOf(open) ? 'on_break' : 'working',
        checkInAt: open.checkInAt,
        workedMinutes,
        breakMinutes,
      };
    }
    const first = day.sessions[0];
    const last = day.sessions[day.sessions.length - 1];
    const { workedMinutes, breakMinutes } = this.computeMinutes(
      day.sessions,
      now,
    );
    return {
      state: 'checked_out',
      checkInAt: first.checkInAt,
      checkOutAt: last.checkOutAt ?? undefined,
      workedMinutes: day.workedMinutes ?? workedMinutes,
      breakMinutes: day.breakMinutes ?? breakMinutes,
    };
  }

  // ------------------------------------------------------------------
  // Manager adjustments (audit trail)
  // ------------------------------------------------------------------

  private serializeValue(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
  }

  async adjust(
    employeeId: string,
    dto: {
      field: string;
      originalValue?: string;
      correctedValue?: string;
      reason?: string;
      dayId?: string;
      sessionId?: string;
      breakId?: string;
    },
    actorId?: string,
  ) {
    await this.loadEmployee(employeeId);

    const FIELD_DAY = ['status', 'workedMinutes', 'breakMinutes'];
    const FIELD_SESSION = ['checkInAt', 'checkOutAt'];
    const FIELD_BREAK = ['startedAt', 'endedAt'];
    const ALL_FIELDS = [...FIELD_DAY, ...FIELD_SESSION, ...FIELD_BREAK];

    if (!dto.field || !ALL_FIELDS.includes(dto.field)) {
      throw new BadRequestException(
        `Unknown adjustment field '${dto.field}'. Allowed: ${ALL_FIELDS.join(', ')}`,
      );
    }
    if (!dto.reason) {
      throw new BadRequestException('Adjustment reason is required');
    }
    if (dto.correctedValue === undefined || dto.correctedValue === '') {
      throw new BadRequestException('correctedValue is required');
    }
    const reason = dto.reason;
    const correctedValue = dto.correctedValue;

    let originalValue: string | null;
    let apply: (tx: TransactionClient) => Promise<unknown>;

    if (FIELD_DAY.includes(dto.field)) {
      if (!dto.dayId) {
        throw new BadRequestException(
          `dayId is required to adjust field '${dto.field}'`,
        );
      }
      if (dto.field === 'status' && !STATUS_VALUES.includes(correctedValue)) {
        throw new BadRequestException(`Invalid status value '${correctedValue}'`);
      }
      if (dto.field === 'workedMinutes' || dto.field === 'breakMinutes') {
        const n = Number(correctedValue);
        if (!Number.isInteger(n) || n < 0) {
          throw new BadRequestException(
            `${dto.field} must be a non-negative integer`,
          );
        }
      }
      const day = await this.prisma.attendanceDay.findUnique({
        where: { id: dto.dayId },
      });
      if (!day) throw new NotFoundException('Attendance day not found');
      originalValue = dto.originalValue ?? this.serializeValue(day[dto.field]);
      apply = (tx) =>
        tx.attendanceDay.update({
          where: { id: day.id },
          data: {
            ...(dto.field === 'status'
              ? { status: correctedValue as AttendanceStatus }
              : { [dto.field]: Number(correctedValue) }),
          },
        });
    } else if (FIELD_SESSION.includes(dto.field)) {
      if (!dto.sessionId) {
        throw new BadRequestException(
          `sessionId is required to adjust field '${dto.field}'`,
        );
      }
      const corrected = new Date(correctedValue);
      if (Number.isNaN(corrected.getTime())) {
        throw new BadRequestException('correctedValue must be a valid date');
      }
      const session = await this.prisma.attendanceSession.findUnique({
        where: { id: dto.sessionId },
      });
      if (!session) throw new NotFoundException('Attendance session not found');
      if (
        dto.field === 'checkOutAt' &&
        corrected < session.checkInAt
      ) {
        throw new BadRequestException(
          'checkOutAt must be on or after the session check-in',
        );
      }
      originalValue = dto.originalValue ?? this.serializeValue(session[dto.field]);
      apply = (tx) =>
        tx.attendanceSession.update({
          where: { id: session.id },
          data: { [dto.field]: corrected },
        });
    } else {
      if (!dto.breakId) {
        throw new BadRequestException(
          `breakId is required to adjust field '${dto.field}'`,
        );
      }
      const corrected = new Date(correctedValue);
      if (Number.isNaN(corrected.getTime())) {
        throw new BadRequestException('correctedValue must be a valid date');
      }
      const brk = await this.prisma.attendanceBreak.findUnique({
        where: { id: dto.breakId },
      });
      if (!brk) throw new NotFoundException('Attendance break not found');
      if (dto.field === 'endedAt' && brk.startedAt > corrected) {
        throw new BadRequestException(
          'endedAt must be on or after the break start',
        );
      }
      originalValue = dto.originalValue ?? this.serializeValue(brk[dto.field]);
      apply = (tx) =>
        tx.attendanceBreak.update({
          where: { id: brk.id },
          data: { [dto.field]: corrected },
        });
    }

    return this.prisma.$transaction(async (tx) => {
      await apply(tx);
      return tx.attendanceAdjustment.create({
        data: {
          employeeId,
          dayId: dto.dayId ?? null,
          field: dto.field,
          originalValue,
          correctedValue: correctedValue,
          reason: reason,
          adjustedById: actorId ?? null,
        },
      });
    });
  }

  async listAdjustments(employeeId?: string, page = 1, perPage = 20) {
    page = Math.max(1, page);
    perPage = Math.max(1, Math.min(100, perPage));
    const where: Prisma.AttendanceAdjustmentWhereInput = employeeId
      ? { employeeId }
      : {};
    const [data, total] = await Promise.all([
      this.prisma.attendanceAdjustment.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { adjustedAt: 'desc' },
        include: {
          employee: {
            select: {
              employeeId: true,
              betterAuthUser: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.attendanceAdjustment.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  // ------------------------------------------------------------------
  // List / overview / history over the Day model
  // ------------------------------------------------------------------

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
    const where: Prisma.AttendanceDayWhereInput = {};
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
      this.prisma.attendanceDay.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { date: 'desc' },
        include: {
          employee: { select: EMPLOYEE_SELECT },
          sessions: { include: { breaks: true } },
          _count: { select: { sessions: true } },
        },
      }),
      this.prisma.attendanceDay.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async dailyOverview(dateStr: string) {
    const date = this.normalizeDate(dateStr);
    const rows = await this.prisma.attendanceDay.groupBy({
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
    const where: Prisma.AttendanceDayWhereInput = { employeeId };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = this.normalizeDate(from);
      if (to) where.date.lte = this.normalizeDate(to);
    }
    return this.prisma.attendanceDay.findMany({
      where,
      orderBy: { date: 'desc' },
      include: { sessions: { include: { breaks: true } } },
    });
  }

  // ------------------------------------------------------------------
  // Machine device ingestion (shared contract with the devices agent)
  // ------------------------------------------------------------------

  async ingestMachineEvent(
    employeeId: string,
    deviceId: string,
    eventType: 'CHECK_IN' | 'CHECK_OUT' | 'BREAK_START' | 'BREAK_END' | 'PUNCH',
    occurredAt: Date,
  ): Promise<{ dayId: string; sessionId?: string; breakId?: string }> {
    const EVENTS = ['CHECK_IN', 'CHECK_OUT', 'BREAK_START', 'BREAK_END', 'PUNCH'];
    if (!EVENTS.includes(eventType)) {
      throw new BadRequestException(`Unknown machine event type '${eventType}'`);
    }
    const employee = await this.loadEmployee(employeeId);
    await this.enforceMachinePath(employee);
    const date = this.normalizeDate(occurredAt);

    return this.runDayTx(
      employeeId,
      date,
      async (tx, day) => {
        if (eventType === 'CHECK_IN' || eventType === 'PUNCH') {
          const open = this.openSessionOf(day);
          if (open) {
            if (eventType === 'CHECK_IN') {
              throw new ConflictException(
                'এই Employee-এর জন্য আজকের Attendance ইতিমধ্যে শুরু হয়েছে।',
              );
            }
            // PUNCH with an open session = one-punch checkout toggle.
            if (this.openBreakOf(open)) {
              throw new BadRequestException(
                'Break শেষ না করে Punch Out করা যাবে না।',
              );
            }
            open.checkOutAt = occurredAt;
            await tx.attendanceSession.update({
              where: { id: open.id },
              data: { checkOutAt: occurredAt },
            });
            await this.materializeDay(tx, day, occurredAt);
            return { dayId: day.id, sessionId: open.id };
          }
          const session = await tx.attendanceSession.create({
            data: {
              dayId: day.id,
              source: 'MACHINE',
              deviceId,
              checkInAt: occurredAt,
            },
          });
          return { dayId: day.id, sessionId: session.id };
        }

        if (eventType === 'BREAK_START' || eventType === 'BREAK_END') {
          const open = this.openSessionOf(day);
          if (!open) {
            throw new BadRequestException('কোনো চলমান Session নেই।');
          }
          const brk = this.openBreakOf(open);
          if (eventType === 'BREAK_START') {
            if (brk) throw new ConflictException('ইতিমধ্যে Break চলছে।');
            const created = await tx.attendanceBreak.create({
              data: { sessionId: open.id, startedAt: occurredAt },
            });
            return { dayId: day.id, sessionId: open.id, breakId: created.id };
          }
          if (!brk) {
            throw new BadRequestException('কোনো চলমান Break নেই।');
          }
          await tx.attendanceBreak.update({
            where: { id: brk.id },
            data: { endedAt: occurredAt },
          });
          return { dayId: day.id, sessionId: open.id, breakId: brk.id };
        }

        // CHECK_OUT
        const open = this.openSessionOf(day);
        if (!open) {
          throw new BadRequestException('কোনো চলমান Session নেই।');
        }
        if (this.openBreakOf(open)) {
          throw new BadRequestException(
            'Check Out করার আগে active Break শেষ করুন।',
          );
        }
        open.checkOutAt = occurredAt;
        await tx.attendanceSession.update({
          where: { id: open.id },
          data: { checkOutAt: occurredAt },
        });
        await this.materializeDay(tx, day, occurredAt);
        return { dayId: day.id, sessionId: open.id };
      },
      { createDay: true, dayMethod: employee.attendanceMethod },
    );
  }
}