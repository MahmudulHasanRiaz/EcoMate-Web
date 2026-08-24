import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { HrAttendanceService } from '../hr-attendance.service';
import { PrismaService } from '../../prisma/prisma.service';

type BreakRow = {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
};

type SessionRow = {
  id: string;
  dayId: string;
  source: string;
  deviceId: string | null;
  checkInAt: Date;
  checkOutAt: Date | null;
  breaks: BreakRow[];
};

type DayRow = {
  id: string;
  employeeId: string;
  date: Date;
  status: string;
  attendanceMethod: string;
  workedMinutes: number | null;
  breakMinutes: number | null;
  note: string | null;
  sessions: SessionRow[];
};

const openSession = (dayId: string, checkInAt: Date, breaks: BreakRow[] = []): SessionRow => ({
  id: 's-1',
  dayId,
  source: 'APP',
  deviceId: null,
  checkInAt,
  checkOutAt: null,
  breaks,
});

const closedSession = (
  dayId: string,
  checkInAt: Date,
  checkOutAt: Date,
  breaks: BreakRow[] = [],
): SessionRow => ({
  id: 's-1',
  dayId,
  source: 'APP',
  deviceId: null,
  checkInAt,
  checkOutAt,
  breaks,
});

const openBreak = (startedAt: Date): BreakRow => ({
  id: 'b-1',
  startedAt,
  endedAt: null,
});

const endedBreak = (startedAt: Date, endedAt: Date): BreakRow => ({
  id: 'b-1',
  startedAt,
  endedAt,
});

const makeDay = (overrides: Partial<DayRow> = {}): DayRow => ({
  id: 'day-1',
  employeeId: 'emp-1',
  date: new Date('2026-08-28T00:00:00.000Z'),
  status: 'PRESENT',
  attendanceMethod: 'APP',
  workedMinutes: null,
  breakMinutes: null,
  note: null,
  sessions: [],
  ...overrides,
});

describe('HrAttendanceService', () => {
  let service: HrAttendanceService;
  let prisma: any;

  const EMPLOYEE = {
    id: 'emp-1',
    employeeId: 'EMP-1',
    status: 'active',
    attendanceMethod: 'APP' as const,
  };

  // Builds a transaction mock that lazily reflects a mutable `day` object,
  // mimicking a real Postgres tx (writes are visible to later reads).
  // Pass null when no day exists yet — the lock finds nothing, day create
  // materializes the row (id 'day-new') and later reads see it.
  const makeStateTx = (initial: DayRow | null) => {
    let day: DayRow | null = initial;
    const tx = {
      $queryRaw: jest
        .fn()
        .mockImplementation(async () =>
          day && day.id ? [{ id: day.id }] : [],
        ),
      attendanceDay: {
        findUnique: jest.fn(async () => day),
        create: jest.fn(async (args: any) => {
          day = {
            id: 'day-new',
            employeeId: args.data.employeeId,
            date: args.data.date,
            status: args.data.status ?? 'PRESENT',
            attendanceMethod: args.data.attendanceMethod ?? 'APP',
            workedMinutes: null,
            breakMinutes: null,
            note: args.data.note ?? null,
            sessions: [],
          };
          return day;
        }),
        update: jest.fn(async (args: any) => {
          if (day) Object.assign(day, args.data);
          return day;
        }),
      },
      attendanceSession: {
        create: jest.fn(async (args: any) => {
          const row: SessionRow = {
            id: 's-new',
            dayId: args.data.dayId,
            source: args.data.source ?? 'APP',
            deviceId: args.data.deviceId ?? null,
            checkInAt: args.data.checkInAt,
            checkOutAt: null,
            breaks: [],
          };
          day?.sessions.push(row);
          return row;
        }),
        update: jest.fn(async (args: any) => {
          const row = day?.sessions.find((s) => s.id === args.where.id);
          if (row) Object.assign(row, args.data);
          return row;
        }),
      },
      attendanceBreak: {
        create: jest.fn(async (args: any) => {
          const count =
            day?.sessions.flatMap((s) => s.breaks).length ?? 0;
          const row: BreakRow = {
            id: `b-${count + 1}`,
            startedAt: args.data.startedAt,
            endedAt: null,
          };
          const session = day?.sessions.find((s) => s.id === args.data.sessionId);
          session?.breaks.push(row);
          return row;
        }),
        update: jest.fn(async (args: any) => {
          const row = day?.sessions
            .flatMap((s) => s.breaks)
            .find((b) => b.id === args.where.id);
          if (row) Object.assign(row, args.data);
          return row;
        }),
      },
      attendanceAdjustment: {
        create: jest.fn(async (args: any) => ({ id: 'adj-new', ...args.data })),
      },
    };
    return tx;
  };

  const prismaMock = {
    employee: { findUnique: jest.fn() },
    employeeId: {},
    attendanceSettings: { findUnique: jest.fn() },
    attendanceDay: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    attendanceSession: { findUnique: jest.fn() },
    attendanceBreak: { findUnique: jest.fn() },
    attendanceAdjustment: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    leaveRequest: { findMany: jest.fn() },
    weeklyOff: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };

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
    prismaMock.employee.findUnique.mockResolvedValue(EMPLOYEE);
    prismaMock.attendanceSettings.findUnique.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getSettings', () => {
    it('falls back to APP when no settings row exists', async () => {
      prismaMock.attendanceSettings.findUnique.mockResolvedValue(null);
      await expect(service.getSettings()).resolves.toEqual({ mode: 'APP' });
      expect(prismaMock.attendanceSettings.findUnique).toHaveBeenCalledWith({
        where: { id: 'global' },
      });
    });

    it('returns the persisted mode when present', async () => {
      prismaMock.attendanceSettings.findUnique.mockResolvedValue({
        mode: 'MACHINE',
      });
      await expect(service.getSettings()).resolves.toEqual({ mode: 'MACHINE' });
    });
  });

  describe('effectiveMethod', () => {
    const employee = (attendanceMethod: string) => ({
      id: 'emp-1',
      attendanceMethod,
    });

    it('APP mode: APP employees allowed, employee method ignored', async () => {
      prismaMock.attendanceSettings.findUnique.mockResolvedValue({ mode: 'APP' });
      await expect(service.effectiveMethod(employee('APP'))).resolves.toMatchObject({
        allowed: true,
        method: 'APP',
      });
      await expect(
        service.effectiveMethod(employee('MACHINE')),
      ).resolves.toMatchObject({ allowed: true });
    });

    it('NONE method blocks in any mode', async () => {
      prismaMock.attendanceSettings.findUnique.mockResolvedValue({ mode: 'APP' });
      const res = await service.effectiveMethod(employee('NONE'));
      expect(res.allowed).toBe(false);
      expect(res.blockedReason).toMatch(/disabled/i);
    });

    it('MACHINE mode blocks the app for all employees', async () => {
      prismaMock.attendanceSettings.findUnique.mockResolvedValue({ mode: 'MACHINE' });
      const app = await service.effectiveMethod(employee('APP'));
      expect(app.allowed).toBe(false);
      expect(app.blockedReason).toMatch(/MACHINE mode/i);
      const machine = await service.effectiveMethod(employee('MACHINE'));
      expect(machine.allowed).toBe(false);
      expect(machine.method).toBe('MACHINE');
    });

    it('BOTH mode honors the employee method', async () => {
      prismaMock.attendanceSettings.findUnique.mockResolvedValue({ mode: 'BOTH' });
      await expect(service.effectiveMethod(employee('APP'))).resolves.toMatchObject({
        allowed: true,
        method: 'APP',
      });
      const machine = await service.effectiveMethod(employee('MACHINE'));
      expect(machine.allowed).toBe(false);
      expect(machine.blockedReason).toMatch(/machine/i);
    });
  });

  describe('checkIn', () => {
    const DAY_OPEN = makeDay({ sessions: [openSession('day-1', new Date('2026-08-28T08:00:00.000Z'))] });

    it('creates the day (PRESENT, employee method) and an APP session', async () => {
      jest.useFakeTimers({ now: new Date('2026-08-28T09:00:00.000Z') });
      const day = makeDay();
      const tx = makeStateTx(day);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));

      const res = await service.checkIn('emp-1', { note: 'on time', date: '2026-08-28' });

      expect(res).toMatchObject({ dayId: 'day-1', source: 'APP' });
      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.attendanceDay.create).not.toHaveBeenCalled();
      expect(tx.attendanceSession.create).toHaveBeenCalledWith({
        data: {
          dayId: 'day-1',
          source: 'APP',
          checkInAt: new Date('2026-08-28T09:00:00.000Z'),
        },
      });
    });

    it('creates the day lazily when no day exists yet, with employee method', async () => {
      jest.useFakeTimers({ now: new Date('2026-08-28T09:00:00.000Z') });
      const tx = makeStateTx(null);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));

      const res = await service.checkIn('emp-1', { date: '2026-08-28' });

      expect(res).toMatchObject({ dayId: 'day-new', source: 'APP' });
      const createArg = tx.attendanceDay.create.mock.calls[0][0];
      expect(createArg.data).toMatchObject({
        employeeId: 'emp-1',
        date: new Date('2026-08-28T00:00:00.000Z'),
        status: 'PRESENT',
        attendanceMethod: 'APP',
      });
    });

    it('defaults to Dhaka-today UTC-midnight when no date is supplied (server-authoritative)', async () => {
      // 2026-08-24T18:30:00Z = 00:30 BDT on Aug 25 → business date 2026-08-25
      const tx = makeStateTx(null);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));

      const res = await service.checkIn('emp-1', {
        now: new Date('2026-08-24T18:30:00.000Z'),
      });

      expect(res).toMatchObject({ dayId: 'day-new' });
      const createArg = tx.attendanceDay.create.mock.calls[0][0];
      expect(createArg.data.date).toEqual(new Date('2026-08-25T00:00:00.000Z'));
    });

    it('throws 409 on a concurrent day-create P2002 race with friendly message', async () => {
      const tx = makeStateTx(null);
      tx.attendanceDay.create.mockRejectedValue({
        code: 'P2002',
        meta: { target: ['employeeId', 'date'] },
      });
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await expect(service.checkIn('emp-1', { date: '2026-08-28' })).rejects.toThrow(
        ConflictException,
      );
      await expect(
        service.checkIn('emp-1', { date: '2026-08-28' }),
      ).rejects.toThrow(/Attendance ইতিমধ্যে শুরু হয়েছে/);
    });

    it('throws 409 when an open session already exists (double check-in)', async () => {
      const tx = makeStateTx(DAY_OPEN);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
      await expect(service.checkIn('emp-1', { date: '2026-08-28' })).rejects.toThrow(
        ConflictException,
      );
      expect(tx.attendanceSession.create).not.toHaveBeenCalled();
    });

    it('throws 404 when the employee is missing', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(null);
      await expect(service.checkIn('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws 400 for a terminated employee', async () => {
      prismaMock.employee.findUnique.mockResolvedValue({
        ...EMPLOYEE,
        status: 'terminated',
      });
      await expect(service.checkIn('emp-1')).rejects.toThrow(BadRequestException);
    });

    it('throws 400 when application attendance is disabled in MACHINE mode', async () => {
      prismaMock.attendanceSettings.findUnique.mockResolvedValue({ mode: 'MACHINE' });
      await expect(service.checkIn('emp-1', { date: '2026-08-28' })).rejects.toThrow(
        /Application attendance is disabled in MACHINE mode/,
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('throws 400 when the employee method is NONE', async () => {
      prismaMock.employee.findUnique.mockResolvedValue({
        ...EMPLOYEE,
        attendanceMethod: 'NONE',
      });
      await expect(service.checkIn('emp-1', { date: '2026-08-28' })).rejects.toThrow(
        /attendance is disabled/,
      );
    });

    it('BOTH mode: APP employee checked in, MACHINE employee blocked from app', async () => {
      prismaMock.attendanceSettings.findUnique.mockResolvedValue({ mode: 'BOTH' });
      prismaMock.employee.findUnique.mockResolvedValue({
        ...EMPLOYEE,
        attendanceMethod: 'MACHINE',
      });
      await expect(service.checkIn('emp-1', { date: '2026-08-28' })).rejects.toThrow(
        /machine/i,
      );
    });

    it('two parallel check-ins produce exactly one session; the second gets 409', async () => {
      const dayA = makeDay();
      const dayB = makeDay({ sessions: [openSession('day-1', new Date('2026-08-28T09:00:00.000Z'))] });
      const txA = makeStateTx(dayA);
      const txB = makeStateTx(dayB);
      prismaMock.$transaction
        .mockImplementationOnce(async (cb: any) => cb(txA))
        .mockImplementationOnce(async (cb: any) => cb(txB));

      const [r1, r2] = await Promise.allSettled([
        service.checkIn('emp-1', { date: '2026-08-28' }),
        service.checkIn('emp-1', { date: '2026-08-28' }),
      ]);

      expect(r1.status).toBe('fulfilled');
      expect(r2.status).toBe('rejected');
      expect((r2 as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
      expect(txA.attendanceSession.create).toHaveBeenCalledTimes(1);
      expect(txB.attendanceSession.create).not.toHaveBeenCalled();
      expect(txA.$queryRaw).toHaveBeenCalled();
      expect(txB.$queryRaw).toHaveBeenCalled();
    });
  });

  describe('breakStart / breakEnd', () => {
    const RUNNING = new Date('2026-08-28T10:00:00.000Z');
    const workingDay = (breaks: BreakRow[] = []) =>
      makeDay({ sessions: [openSession('day-1', new Date('2026-08-28T09:00:00.000Z'), breaks)] });

    it('starts a break and records unlimited successive breaks', async () => {
      jest.useFakeTimers({ now: RUNNING });
      const day = workingDay([endedBreak(new Date('2026-08-28T09:30:00.000Z'), new Date('2026-08-28T09:45:00.000Z'))]);
      const tx = makeStateTx(day);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.breakStart('emp-1', { date: '2026-08-28' });
      await service.breakEnd('emp-1', { date: '2026-08-28' });
      expect(day.sessions[0].breaks).toHaveLength(2);
      expect(day.sessions[0].breaks[1]).toMatchObject({
        startedAt: RUNNING,
        endedAt: RUNNING,
      });

      jest.setSystemTime(new Date('2026-08-28T12:00:00.000Z'));
      const res = await service.breakStart('emp-1', { date: '2026-08-28' });
      expect(res).toMatchObject({ startedAt: new Date('2026-08-28T12:00:00.000Z') });
      expect(day.sessions[0].breaks).toHaveLength(3);
    });

    it('break start without an open session throws 400', async () => {
      const tx = makeStateTx(makeDay());
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
      await expect(service.breakStart('emp-1', { date: '2026-08-28' })).rejects.toThrow(
        /Check In করার আগে Break শুরু করা যাবে না/,
      );
    });

    it('break start while a break is already open throws 409', async () => {
      const day = workingDay([openBreak(RUNNING)]);
      const tx = makeStateTx(day);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
      await expect(service.breakStart('emp-1', { date: '2026-08-28' })).rejects.toThrow(
        /Break চলছে/,
      );
    });

    it('break end without an open session throws 400', async () => {
      const tx = makeStateTx(makeDay());
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
      await expect(service.breakEnd('emp-1', { date: '2026-08-28' })).rejects.toThrow(
        /Session/,
      );
    });

    it('break end without an open break throws 400', async () => {
      const day = workingDay([endedBreak(new Date('2026-08-28T09:30:00.000Z'), new Date('2026-08-28T09:45:00.000Z'))]);
      const tx = makeStateTx(day);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
      await expect(service.breakEnd('emp-1', { date: '2026-08-28' })).rejects.toThrow(
        /কোনো চলমান Break নেই/,
      );
    });
  });

  describe('checkOut', () => {
    it('closes the session and materializes worked/break minutes (break x2)', async () => {
      jest.useFakeTimers({ now: new Date('2026-08-28T09:00:00.000Z') });
      const day = makeDay();
      const tx = makeStateTx(day);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.checkIn('emp-1', { date: '2026-08-28' });
      jest.setSystemTime(new Date('2026-08-28T10:00:00.000Z'));
      await service.breakStart('emp-1', { date: '2026-08-28' });
      jest.setSystemTime(new Date('2026-08-28T10:15:00.000Z'));
      await service.breakEnd('emp-1', { date: '2026-08-28' });
      jest.setSystemTime(new Date('2026-08-28T12:15:00.000Z'));
      await service.breakStart('emp-1', { date: '2026-08-28' });
      jest.setSystemTime(new Date('2026-08-28T12:45:00.000Z'));
      await service.breakEnd('emp-1', { date: '2026-08-28' });
      jest.setSystemTime(new Date('2026-08-28T18:00:00.000Z'));
      const res = await service.checkOut('emp-1', { date: '2026-08-28' });

      expect(day.sessions[0].checkOutAt).toEqual(new Date('2026-08-28T18:00:00.000Z'));
      expect(day.workedMinutes).toBe(495);
      expect(day.breakMinutes).toBe(45);
      expect(res).toMatchObject({ workedMinutes: 495, breakMinutes: 45 });
    });

    it('throws 400 when no session is open', async () => {
      const tx = makeStateTx(makeDay());
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
      await expect(service.checkOut('emp-1', { date: '2026-08-28' })).rejects.toThrow(
        /কোনো চলমান Session নেই/,
      );
    });

    it('throws 400 when a break is open (must end break first)', async () => {
      const day = makeDay({
        sessions: [
          openSession('day-1', new Date('2026-08-28T09:00:00.000Z'), [
            openBreak(new Date('2026-08-28T11:00:00.000Z')),
          ]),
        ],
      });
      const tx = makeStateTx(day);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
      await expect(service.checkOut('emp-1', { date: '2026-08-28' })).rejects.toThrow(
        /active Break শেষ করুন/,
      );
      expect(day.sessions[0].checkOutAt).toBeNull();
    });

    it('does not overwrite a manually adjusted day status', async () => {
      jest.useFakeTimers({ now: new Date('2026-08-28T09:00:00.000Z') });
      const day = makeDay({ status: 'LATE' });
      const tx = makeStateTx(day);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
      await service.checkIn('emp-1', { date: '2026-08-28' });
      jest.setSystemTime(new Date('2026-08-28T18:00:00.000Z'));
      await service.checkOut('emp-1', { date: '2026-08-28' });
      expect(day.status).toBe('LATE');
    });
  });

  describe('getDayState', () => {
    it('returns none when no day exists', async () => {
      prismaMock.attendanceDay.findUnique.mockResolvedValue(null);
      await expect(service.getDayState('emp-1', '2026-08-28')).resolves.toMatchObject({
        state: 'none',
        workedMinutes: 0,
        breakMinutes: 0,
      });
      expect(prismaMock.attendanceDay.findUnique).toHaveBeenCalledWith({
        where: {
          employeeId_date: {
            employeeId: 'emp-1',
            date: new Date('2026-08-28T00:00:00.000Z'),
          },
        },
        include: {
          sessions: { include: { breaks: true }, orderBy: { checkInAt: 'asc' } },
        },
      });
    });

    it('returns before_work for a day with no sessions', async () => {
      prismaMock.attendanceDay.findUnique.mockResolvedValue(makeDay());
      await expect(service.getDayState('emp-1', '2026-08-28')).resolves.toMatchObject({
        state: 'before_work',
      });
    });

    it('returns working with live minutes for an open session', async () => {
      jest.useFakeTimers({ now: new Date('2026-08-28T12:00:00.000Z') });
      prismaMock.attendanceDay.findUnique.mockResolvedValue(
        makeDay({
          sessions: [openSession('day-1', new Date('2026-08-28T09:00:00.000Z'))],
        }),
      );
      const res = await service.getDayState('emp-1', '2026-08-28');
      expect(res).toMatchObject({
        state: 'working',
        workedMinutes: 180,
        breakMinutes: 0,
      });
      expect(res.checkInAt).toEqual(new Date('2026-08-28T09:00:00.000Z'));
      expect(res.checkOutAt).toBeUndefined();
    });

    it('returns on_break with the running break counted to now', async () => {
      jest.useFakeTimers({ now: new Date('2026-08-28T12:00:00.000Z') });
      prismaMock.attendanceDay.findUnique.mockResolvedValue(
        makeDay({
          sessions: [
            openSession('day-1', new Date('2026-08-28T09:00:00.000Z'), [
              openBreak(new Date('2026-08-28T11:00:00.000Z')),
            ]),
          ],
        }),
      );
      const res = await service.getDayState('emp-1', '2026-08-28');
      expect(res).toMatchObject({
        state: 'on_break',
        breakMinutes: 60,
        workedMinutes: 120,
      });
    });

    it('returns checked_out with materialized minutes and times', async () => {
      prismaMock.attendanceDay.findUnique.mockResolvedValue(
        makeDay({
          workedMinutes: 495,
          breakMinutes: 45,
          sessions: [
            closedSession(
              'day-1',
              new Date('2026-08-28T09:00:00.000Z'),
              new Date('2026-08-28T18:00:00.000Z'),
              [endedBreak(new Date('2026-08-28T10:00:00.000Z'), new Date('2026-08-28T10:15:00.000Z'))],
            ),
          ],
        }),
      );
      const res = await service.getDayState('emp-1', '2026-08-28');
      expect(res).toMatchObject({
        state: 'checked_out',
        workedMinutes: 495,
        breakMinutes: 45,
        checkInAt: new Date('2026-08-28T09:00:00.000Z'),
        checkOutAt: new Date('2026-08-28T18:00:00.000Z'),
      });
    });
  });

  describe('adjust', () => {
    const DAY = makeDay({ status: 'PRESENT' });
    const SESSION = closedSession('day-1', new Date('2026-08-28T09:00:00.000Z'), new Date('2026-08-28T17:00:00.000Z'));
    const BREAK = endedBreak(new Date('2026-08-28T10:00:00.000Z'), new Date('2026-08-28T10:15:00.000Z'));

    const seedTargets = (overrides: any = {}) => {
      const day = { ...DAY, ...overrides.day };
      const session = { ...SESSION, ...overrides.session };
      const brk = { ...BREAK, ...overrides.brk };
      prismaMock.attendanceDay.findUnique.mockResolvedValue(day);
      prismaMock.attendanceSession.findUnique.mockResolvedValue(session);
      prismaMock.attendanceBreak.findUnique.mockResolvedValue(brk);

      const tx = {
        attendanceDay: {
          update: jest.fn(async (args: any) => {
            Object.assign(day, args.data);
            return day;
          }),
        },
        attendanceSession: {
          update: jest.fn(async (args: any) => {
            Object.assign(session, args.data);
            return session;
          }),
        },
        attendanceBreak: {
          update: jest.fn(async (args: any) => {
            Object.assign(brk, args.data);
            return brk;
          }),
        },
        attendanceAdjustment: { create: jest.fn() },
      };
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
      return { day, session, brk, tx };
    };

    it('audits a status change with auto-filled original, reason and actor', async () => {
      const { day, tx } = seedTargets();
      tx.attendanceAdjustment.create.mockResolvedValue({ id: 'adj-1' });
      const res = await service.adjust(
        'emp-1',
        { field: 'status', correctedValue: 'LATE', reason: 'came late', dayId: 'day-1' },
        'actor-1',
      );
      expect(day.status).toBe('LATE');
      expect(tx.attendanceDay.update).toHaveBeenCalledWith({
        where: { id: 'day-1' },
        data: { status: 'LATE' },
      });
      expect(tx.attendanceAdjustment.create).toHaveBeenCalledWith({
        data: {
          employeeId: 'emp-1',
          dayId: 'day-1',
          field: 'status',
          originalValue: 'PRESENT',
          correctedValue: 'LATE',
          reason: 'came late',
          adjustedById: 'actor-1',
        },
      });
      expect(res).toEqual({ id: 'adj-1' });
    });

    it('keeps an explicit originalValue', async () => {
      const { tx } = seedTargets();
      tx.attendanceAdjustment.create.mockResolvedValue({ id: 'adj-2' });
      await service.adjust(
        'emp-1',
        {
          field: 'workedMinutes',
          originalValue: '400',
          correctedValue: '495',
          reason: 'recount',
          dayId: 'day-1',
        },
        'actor-1',
      );
      expect(tx.attendanceAdjustment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          field: 'workedMinutes',
          originalValue: '400',
          correctedValue: '495',
        }),
      });
      expect(tx.attendanceDay.update).toHaveBeenCalledWith({
        where: { id: 'day-1' },
        data: { workedMinutes: 495 },
      });
    });

    it('adjusts a session checkOutAt via sessionId', async () => {
      const { session, tx } = seedTargets();
      tx.attendanceAdjustment.create.mockResolvedValue({ id: 'adj-3' });
      await service.adjust(
        'emp-1',
        {
          field: 'checkOutAt',
          correctedValue: '2026-08-28T18:00:00.000Z',
          reason: 'system missed logout',
          sessionId: 's-1',
        },
        'actor-1',
      );
      expect(session.checkOutAt).toEqual(new Date('2026-08-28T18:00:00.000Z'));
      expect(tx.attendanceSession.update).toHaveBeenCalledWith({
        where: { id: 's-1' },
        data: { checkOutAt: new Date('2026-08-28T18:00:00.000Z') },
      });
      expect(tx.attendanceAdjustment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          originalValue: '2026-08-28T17:00:00.000Z',
          correctedValue: '2026-08-28T18:00:00.000Z',
          field: 'checkOutAt',
        }),
      });
    });

    it('adjusts a break startedAt via breakId', async () => {
      const { brk, tx } = seedTargets();
      tx.attendanceAdjustment.create.mockResolvedValue({ id: 'adj-4' });
      await service.adjust(
        'emp-1',
        {
          field: 'startedAt',
          correctedValue: '2026-08-28T09:55:00.000Z',
          reason: 'clock skew',
          breakId: 'b-1',
        },
        'actor-1',
      );
      expect(brk.startedAt).toEqual(new Date('2026-08-28T09:55:00.000Z'));
      expect(tx.attendanceBreak.update).toHaveBeenCalledWith({
        where: { id: 'b-1' },
        data: { startedAt: new Date('2026-08-28T09:55:00.000Z') },
      });
    });

    it('400 when reason is missing', async () => {
      await expect(
        service.adjust('emp-1', { field: 'status', correctedValue: 'LATE' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('400 for an unknown field', async () => {
      await expect(
        service.adjust(
          'emp-1',
          { field: 'salary', correctedValue: '100', reason: 'x', dayId: 'day-1' } as any,
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('400 for an invalid status correctedValue', async () => {
      seedTargets();
      await expect(
        service.adjust(
          'emp-1',
          { field: 'status', correctedValue: 'FLYING', reason: 'x', dayId: 'day-1' },
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('400 when dayId is missing for a day-scoped field', async () => {
      await expect(
        service.adjust(
          'emp-1',
          { field: 'status', correctedValue: 'LATE', reason: 'x' },
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('400 for negative workedMinutes', async () => {
      seedTargets();
      await expect(
        service.adjust(
          'emp-1',
          { field: 'workedMinutes', correctedValue: '-5', reason: 'x', dayId: 'day-1' },
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('404 when the employee does not exist', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(null);
      await expect(
        service.adjust('missing', { field: 'status', correctedValue: 'LATE', reason: 'x', dayId: 'day-1' }, 'actor-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prismaMock.attendanceAdjustment.create).not.toHaveBeenCalled();
    });
  });

  describe('listAdjustments', () => {
    it('filters by employee with pagination meta', async () => {
      prismaMock.attendanceAdjustment.count.mockResolvedValue(5);
      prismaMock.attendanceAdjustment.findMany.mockResolvedValue([
        { id: 'adj-1' },
      ]);
      const res = await service.listAdjustments('emp-1', 2, 10);
      expect(prismaMock.attendanceAdjustment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { employeeId: 'emp-1' },
          skip: 10,
          take: 10,
          orderBy: { adjustedAt: 'desc' },
        }),
      );
      expect(res).toEqual({
        data: [{ id: 'adj-1' }],
        meta: { total: 5, page: 2, perPage: 10, totalPages: 1 },
      });
    });
  });

  describe('findAll (AttendanceDay)', () => {
    it('applies filters + pagination with employee include and session count', async () => {
      prismaMock.attendanceDay.count.mockResolvedValue(3);
      prismaMock.attendanceDay.findMany.mockResolvedValue([
        { id: 'd-1', employee: {}, _count: { sessions: 2 } },
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

      expect(prismaMock.attendanceDay.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          employeeId: 'emp-1',
          status: 'PRESENT',
        }),
      });
      const call = prismaMock.attendanceDay.findMany.mock.calls[0][0];
      expect(call.skip).toBe(10);
      expect(call.take).toBe(10);
      expect(call.orderBy).toEqual({ date: 'desc' });
      expect(call.where.employee).toEqual({ departmentId: 'dept-1' });
      expect(call.where.date).toEqual({
        gte: new Date('2026-08-28T00:00:00.000Z'),
        lt: new Date('2026-08-29T00:00:00.000Z'),
      });
      expect(call.include.employee.select).toEqual(
        expect.objectContaining({ employeeId: true, status: true }),
      );
      expect(call.include._count).toEqual({ select: { sessions: true } });
      expect(call.include.sessions).toEqual({ include: { breaks: true } });
      expect(res).toEqual({
        data: [{ id: 'd-1', employee: {}, _count: { sessions: 2 }, missingCheckout: false }],
        meta: { total: 3, page: 2, perPage: 10, totalPages: 1 },
      });
    });

    it('omits the date filter when absent', async () => {
      prismaMock.attendanceDay.count.mockResolvedValue(0);
      prismaMock.attendanceDay.findMany.mockResolvedValue([]);
      await service.findAll({ employeeId: 'emp-1' }, 1, 20);
      const where = prismaMock.attendanceDay.findMany.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('date');
    });
  });

  describe('dailyOverview (AttendanceDay)', () => {
    it('returns per-status counts from seeded day rows', async () => {
      prismaMock.attendanceDay.groupBy.mockResolvedValue([
        { status: 'PRESENT', _count: { _all: 5 } },
        { status: 'LATE', _count: { _all: 2 } },
      ]);
      const res = await service.dailyOverview('2026-08-28');
      expect(prismaMock.attendanceDay.groupBy).toHaveBeenCalledWith({
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

  describe('history (AttendanceDay)', () => {
    it('filters by employee + range, ordered date desc, includes minutes + sessions', async () => {
      prismaMock.attendanceDay.findMany.mockResolvedValue([
        { id: 'd-3', workedMinutes: 480, breakMinutes: 30 },
        { id: 'd-1', workedMinutes: 0, breakMinutes: 0 },
      ]);
      const res = await service.history('emp-1', '2026-08-01', '2026-08-31');
      const call = prismaMock.attendanceDay.findMany.mock.calls[0][0];
      expect(call.where).toEqual({
        employeeId: 'emp-1',
        date: {
          gte: new Date('2026-08-01T00:00:00.000Z'),
          lte: new Date('2026-08-31T00:00:00.000Z'),
        },
      });
      expect(call.orderBy).toEqual({ date: 'desc' });
      expect(call.include.sessions).toEqual({ include: { breaks: true } });
      expect(res).toHaveLength(2);
      expect(res[0]).toMatchObject({ workedMinutes: 480, breakMinutes: 30 });
    });
  });

  describe('ingestMachineEvent', () => {
    const occurred = (t: string) => new Date(t);
    const machineEmployee = {
      ...EMPLOYEE,
      attendanceMethod: 'MACHINE' as const,
    };

    beforeEach(() => {
      prismaMock.employee.findUnique.mockResolvedValue(machineEmployee);
      prismaMock.attendanceSettings.findUnique.mockResolvedValue({ mode: 'MACHINE' });
    });

    it('CHECK_IN creates a MACHINE day + session with deviceId', async () => {
      const tx = makeStateTx(null);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));

      const res = await service.ingestMachineEvent(
        'emp-1',
        'dev-1',
        'CHECK_IN',
        occurred('2026-08-28T08:30:00.000Z'),
      );

      expect(res).toEqual({ dayId: 'day-new', sessionId: 's-new' });
      const dayCreate = tx.attendanceDay.create.mock.calls[0][0];
      expect(dayCreate.data).toMatchObject({
        employeeId: 'emp-1',
        status: 'PRESENT',
        attendanceMethod: 'MACHINE',
      });
      expect(tx.attendanceSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          source: 'MACHINE',
          deviceId: 'dev-1',
          checkInAt: occurred('2026-08-28T08:30:00.000Z'),
        }),
      });
    });

    it('second CHECK_IN for the same day throws 409', async () => {
      const day = makeDay({
        sessions: [openSession('day-1', occurred('2026-08-28T08:30:00.000Z'))],
      });
      const tx = makeStateTx(day);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
      await expect(
        service.ingestMachineEvent('emp-1', 'dev-1', 'CHECK_IN', occurred('2026-08-28T09:00:00.000Z')),
      ).rejects.toThrow(ConflictException);
    });

    it('CHECK_OUT closes the session and materializes durations', async () => {
      const day = makeDay({
        sessions: [
          closedSession(
            'day-1',
            occurred('2026-08-28T09:00:00.000Z'),
            null as any,
            [endedBreak(occurred('2026-08-28T11:00:00.000Z'), occurred('2026-08-28T11:30:00.000Z'))],
          ),
        ],
      });
      const tx = makeStateTx(day);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));

      const res = await service.ingestMachineEvent(
        'emp-1',
        'dev-1',
        'CHECK_OUT',
        occurred('2026-08-28T18:00:00.000Z'),
      );

      expect(res).toMatchObject({ dayId: 'day-1' });
      expect(day.sessions[0].checkOutAt).toEqual(occurred('2026-08-28T18:00:00.000Z'));
      expect(day.workedMinutes).toBe(510);
      expect(day.breakMinutes).toBe(30);
    });

    it('CHECK_OUT without an open session throws 400', async () => {
      const tx = makeStateTx(makeDay());
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
      await expect(
        service.ingestMachineEvent('emp-1', 'dev-1', 'CHECK_OUT', occurred('2026-08-28T18:00:00.000Z')),
      ).rejects.toThrow(BadRequestException);
    });

    it('BREAK_START / BREAK_END map onto the open session', async () => {
      const day = makeDay({
        sessions: [openSession('day-1', occurred('2026-08-28T09:00:00.000Z'))],
      });
      const tx = makeStateTx(day);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.ingestMachineEvent('emp-1', 'dev-1', 'BREAK_START', occurred('2026-08-28T12:00:00.000Z'));
      expect(day.sessions[0].breaks[0]).toMatchObject({ startedAt: occurred('2026-08-28T12:00:00.000Z') });
      await service.ingestMachineEvent('emp-1', 'dev-1', 'BREAK_END', occurred('2026-08-28T12:30:00.000Z'));
      expect(day.sessions[0].breaks[0].endedAt).toEqual(occurred('2026-08-28T12:30:00.000Z'));
    });

    it('PUNCH opens a session, then a second PUNCH closes it', async () => {
      const tx = makeStateTx(null);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.ingestMachineEvent('emp-1', 'dev-1', 'PUNCH', occurred('2026-08-28T08:00:00.000Z'));
      expect(tx.attendanceSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          source: 'MACHINE',
          deviceId: 'dev-1',
          checkInAt: occurred('2026-08-28T08:00:00.000Z'),
        }),
      });

      await service.ingestMachineEvent('emp-1', 'dev-1', 'PUNCH', occurred('2026-08-28T17:30:00.000Z'));
      const closeArg = tx.attendanceSession.update.mock.calls[0][0];
      expect(closeArg.where).toEqual({ id: 's-new' });
      expect(closeArg.data).toEqual({ checkOutAt: occurred('2026-08-28T17:30:00.000Z') });
      const dayUpdate = tx.attendanceDay.update.mock.calls.at(-1)[0];
      expect(dayUpdate.data).toMatchObject({ workedMinutes: 570, breakMinutes: 0 });
      expect(tx.attendanceSession.create).toHaveBeenCalledTimes(1);
    });

    it('PUNCH while a break is running throws 400', async () => {
      const day = makeDay({
        sessions: [
          openSession('day-1', occurred('2026-08-28T09:00:00.000Z'), [
            openBreak(occurred('2026-08-28T12:00:00.000Z')),
          ]),
        ],
      });
      const tx = makeStateTx(day);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
      await expect(
        service.ingestMachineEvent('emp-1', 'dev-1', 'PUNCH', occurred('2026-08-28T13:00:00.000Z')),
      ).rejects.toThrow(/Break/);
    });

    it('MACHINE events blocked in APP mode', async () => {
      prismaMock.attendanceSettings.findUnique.mockResolvedValue({ mode: 'APP' });
      await expect(
        service.ingestMachineEvent('emp-1', 'dev-1', 'CHECK_IN', occurred('2026-08-28T08:00:00.000Z')),
      ).rejects.toThrow(/APP mode/);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('NONE method blocks machine events', async () => {
      prismaMock.attendanceSettings.findUnique.mockResolvedValue({ mode: 'MACHINE' });
      prismaMock.employee.findUnique.mockResolvedValue({
        ...EMPLOYEE,
        attendanceMethod: 'NONE',
      });
      await expect(
        service.ingestMachineEvent('emp-1', 'dev-1', 'BREAK_START', occurred('2026-08-28T10:00:00.000Z')),
      ).rejects.toThrow(/disabled/);
    });

    it('BOTH mode: MACHINE employee allowed, APP employee blocked from machine', async () => {
      prismaMock.attendanceSettings.findUnique.mockResolvedValue({ mode: 'BOTH' });

      const tx = makeStateTx(null);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
      const res = await service.ingestMachineEvent('emp-1', 'dev-1', 'CHECK_IN', occurred('2026-08-28T08:00:00.000Z'));
      expect(res).toEqual({ dayId: 'day-new', sessionId: 's-new' });

      prismaMock.employee.findUnique.mockResolvedValue({
        ...EMPLOYEE,
        attendanceMethod: 'APP',
      });
      await expect(
        service.ingestMachineEvent('emp-1', 'dev-1', 'CHECK_IN', occurred('2026-08-28T08:00:00.000Z')),
      ).rejects.toThrow(/application/i);
    });

    it('maps a near-midnight event to its Dhaka business date (00:30 BDT → next day)', async () => {
      const tx = makeStateTx(null);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));

      const res = await service.ingestMachineEvent(
        'emp-1',
        'dev-1',
        'CHECK_IN',
        occurred('2026-08-24T18:30:00.000Z'),
      );

      expect(res).toEqual({ dayId: 'day-new', sessionId: 's-new' });
      const dayCreate = tx.attendanceDay.create.mock.calls[0][0];
      expect(dayCreate.data.date).toEqual(new Date('2026-08-25T00:00:00.000Z'));
    });

    it('keeps same-day events on the same Dhaka business date', async () => {
      const tx = makeStateTx(null);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
      await service.ingestMachineEvent(
        'emp-1',
        'dev-1',
        'CHECK_IN',
        occurred('2026-08-28T08:30:00.000Z'),
      );
      const dayCreate = tx.attendanceDay.create.mock.calls[0][0];
      expect(dayCreate.data.date).toEqual(new Date('2026-08-28T00:00:00.000Z'));
    });
  });

  describe('missingCheckout (derived open-session flag)', () => {
    it('getDayState: open session → missingCheckout true', async () => {
      prismaMock.attendanceDay.findUnique.mockResolvedValue(
        makeDay({
          sessions: [openSession('day-1', new Date('2026-08-28T09:00:00.000Z'))],
        }),
      );
      const res = await service.getDayState('emp-1', '2026-08-28');
      expect(res.missingCheckout).toBe(true);
    });

    it('getDayState: all sessions closed → missingCheckout false', async () => {
      prismaMock.attendanceDay.findUnique.mockResolvedValue(
        makeDay({
          sessions: [
            closedSession(
              'day-1',
              new Date('2026-08-28T09:00:00.000Z'),
              new Date('2026-08-28T17:00:00.000Z'),
            ),
          ],
        }),
      );
      const res = await service.getDayState('emp-1', '2026-08-28');
      expect(res.missingCheckout).toBe(false);
    });

    it('getDayState: no day → missingCheckout false', async () => {
      prismaMock.attendanceDay.findUnique.mockResolvedValue(null);
      const res = await service.getDayState('emp-1', '2026-08-28');
      expect(res.missingCheckout).toBe(false);
    });

    it('resolves "today" by Dhaka date when no date is supplied', async () => {
      prismaMock.attendanceDay.findUnique.mockResolvedValue(null);
      await service.getDayState(
        'emp-1',
        undefined,
        new Date('2026-08-24T18:30:00.000Z'),
      );
      expect(prismaMock.attendanceDay.findUnique).toHaveBeenCalledWith({
        where: {
          employeeId_date: {
            employeeId: 'emp-1',
            date: new Date('2026-08-25T00:00:00.000Z'),
          },
        },
        include: expect.anything(),
      });
    });

    it('findAll rows carry missingCheckout for open sessions', async () => {
      prismaMock.attendanceDay.count.mockResolvedValue(1);
      prismaMock.attendanceDay.findMany.mockResolvedValue([
        { id: 'd-1', employee: {}, _count: { sessions: 1 }, sessions: [{ checkOutAt: null }] },
      ]);
      const res = await service.findAll({}, 1, 20);
      expect(res.data[0]).toMatchObject({ missingCheckout: true });
    });

    it('findAll rows carry missingCheckout=false for closed sessions', async () => {
      prismaMock.attendanceDay.count.mockResolvedValue(1);
      prismaMock.attendanceDay.findMany.mockResolvedValue([
        { id: 'd-1', employee: {}, _count: { sessions: 1 }, sessions: [{ checkOutAt: new Date() }] },
      ]);
      const res = await service.findAll({}, 1, 20);
      expect(res.data[0]).toMatchObject({ missingCheckout: false });
    });

    it('history rows carry missingCheckout', async () => {
      prismaMock.attendanceDay.findMany.mockResolvedValue([
        { id: 'd-1', sessions: [{ checkOutAt: null }] },
        { id: 'd-2', sessions: [{ checkOutAt: new Date() }] },
      ]);
      const res = await service.history('emp-1', '2026-08-01', '2026-08-31');
      expect(res[0]).toMatchObject({ missingCheckout: true });
      expect(res[1]).toMatchObject({ missingCheckout: false });
    });
  });

  describe('createDay (manual absence days)', () => {
    it('creates an absence day + a status audit adjustment', async () => {
      prismaMock.attendanceDay.findUnique.mockResolvedValue(null);
      const tx = makeStateTx(null);
      tx.attendanceDay.create.mockImplementation(async (args: any) => {
        const row = {
          id: 'day-new',
          employeeId: args.data.employeeId,
          date: args.data.date,
          status: args.data.status,
          attendanceMethod: args.data.attendanceMethod,
          note: args.data.note ?? null,
        };
        return row;
      });
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));

      const res = await service.createDay(
        {
          employeeId: 'emp-1',
          date: '2026-08-25',
          status: 'ABSENT',
          reason: 'No show, no call',
        },
        'actor-1',
      );

      expect(res).toMatchObject({
        id: 'day-new',
        status: 'ABSENT',
        date: new Date('2026-08-25T00:00:00.000Z'),
        attendanceMethod: 'APP',
      });
      expect(tx.attendanceDay.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          employeeId: 'emp-1',
          date: new Date('2026-08-25T00:00:00.000Z'),
          status: 'ABSENT',
          attendanceMethod: 'APP',
        }),
      });
      expect(tx.attendanceAdjustment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          field: 'status',
          originalValue: null,
          correctedValue: 'ABSENT',
          reason: 'No show, no call',
          adjustedById: 'actor-1',
          dayId: 'day-new',
        }),
      });
    });

    it('409 when a day already exists for (employee, date)', async () => {
      prismaMock.attendanceDay.findUnique.mockResolvedValue({ id: 'day-1' });
      await expect(
        service.createDay({
          employeeId: 'emp-1',
          date: '2026-08-25',
          status: 'ABSENT',
          reason: 'x',
        }),
      ).rejects.toThrow(ConflictException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('400 for a terminated/inactive employee', async () => {
      prismaMock.employee.findUnique.mockResolvedValue({
        ...EMPLOYEE,
        status: 'terminated',
      });
      await expect(
        service.createDay({
          employeeId: 'emp-1',
          date: '2026-08-25',
          status: 'ABSENT',
          reason: 'x',
        }),
      ).rejects.toThrow(/terminated\/inactive/);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('400 when reason is missing', async () => {
      await expect(
        service.createDay({
          employeeId: 'emp-1',
          date: '2026-08-25',
          status: 'ABSENT',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('400 for a status outside ABSENT/ON_LEAVE/WEEKLY_OFF', async () => {
      await expect(
        service.createDay({
          employeeId: 'emp-1',
          date: '2026-08-25',
          status: 'PRESENT',
          reason: 'x',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('404 when the employee does not exist', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(null);
      await expect(
        service.createDay({
          employeeId: 'missing',
          date: '2026-08-25',
          status: 'ABSENT',
          reason: 'x',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('closeSession (missing checkout)', () => {
    it('closes the open session and writes a checkOutAt adjustment', async () => {
      jest.useFakeTimers({ now: new Date('2026-08-28T18:00:00.000Z') });
      const day = makeDay({
        sessions: [openSession('day-1', new Date('2026-08-28T09:00:00.000Z'))],
      });
      const tx = makeStateTx(day);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));

      const res = await service.closeSession(
        { dayId: 'day-1', reason: 'forgot to log out' },
        'actor-1',
      );

      expect(res).toMatchObject({ dayId: 'day-1', sessionCount: 1 });
      expect(day.sessions[0].checkOutAt).toEqual(new Date('2026-08-28T18:00:00.000Z'));
      expect(tx.attendanceAdjustment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          field: 'checkOutAt',
          originalValue: null,
          correctedValue: '2026-08-28T18:00:00.000Z',
          reason: 'forgot to log out',
          adjustedById: 'actor-1',
          dayId: 'day-1',
        }),
      });
    });

    it('closes ALL open sessions when more than one is open', async () => {
      const day = makeDay({
        sessions: [
          {
            id: 's-1',
            dayId: 'day-1',
            source: 'APP',
            deviceId: null,
            checkInAt: new Date('2026-08-28T09:00:00.000Z'),
            checkOutAt: null,
            breaks: [],
          },
          {
            id: 's-2',
            dayId: 'day-1',
            source: 'APP',
            deviceId: null,
            checkInAt: new Date('2026-08-28T14:00:00.000Z'),
            checkOutAt: null,
            breaks: [],
          },
        ],
      });
      const tx = makeStateTx(day);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.closeSession({ dayId: 'day-1', reason: 'batch close' });

      expect(tx.attendanceSession.update).toHaveBeenCalledTimes(2);
      expect(tx.attendanceAdjustment.create).toHaveBeenCalledTimes(2);
      expect(day.sessions.every((s) => s.checkOutAt)).toBe(true);
    });

    it('400 when there is no open session', async () => {
      const day = makeDay({
        sessions: [
          closedSession(
            'day-1',
            new Date('2026-08-28T09:00:00.000Z'),
            new Date('2026-08-28T17:00:00.000Z'),
          ),
        ],
      });
      const tx = makeStateTx(day);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
      await expect(
        service.closeSession({ dayId: 'day-1', reason: 'x' }),
      ).rejects.toThrow(/No open session/);
    });

    it('404 when the day does not exist', async () => {
      const tx = makeStateTx(null);
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
      await expect(
        service.closeSession({ dayId: 'missing', reason: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('400 when reason is missing', async () => {
      await expect(
        service.closeSession({ dayId: 'day-1' } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('report (G-18 derived attendance)', () => {
    const dayPresentClosed = makeDay({
      id: 'd-1',
      date: new Date('2026-08-03T00:00:00.000Z'),
      status: 'PRESENT',
      workedMinutes: 480,
      breakMinutes: 30,
      sessions: [
        closedSession(
          's-1',
          new Date('2026-08-03T09:00:00.000Z'),
          new Date('2026-08-03T17:00:00.000Z'),
        ),
      ],
    });
    const dayPresentOpen = makeDay({
      id: 'd-2',
      date: new Date('2026-08-04T00:00:00.000Z'),
      status: 'PRESENT',
      workedMinutes: null,
      breakMinutes: null,
      sessions: [openSession('s-2', new Date('2026-08-04T09:00:00.000Z'))],
    });

    it('computes exact numbers from joined data (2 present, 1 leave, 2 weekly-off)', async () => {
      prismaMock.attendanceDay.findMany.mockResolvedValue([dayPresentClosed, dayPresentOpen]);
      prismaMock.leaveRequest.findMany.mockResolvedValue([
        {
          startDate: new Date('2026-08-05T00:00:00.000Z'),
          endDate: new Date('2026-08-05T00:00:00.000Z'),
        },
      ]);
      prismaMock.weeklyOff.findMany.mockResolvedValue([
        {
          dayOfWeek: 6,
          effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
          effectiveTo: null,
        },
      ]);

      const res = await service.report('emp-1', '2026-08-01', '2026-08-09');

      expect(res.daysInRange).toBe(9);
      expect(res.present).toBe(2);
      expect(res.leaveDays).toBe(1);
      expect(res.weeklyOffDays).toBe(2);
      expect(res.absent).toBe(4);
      expect(res.missingCheckout).toBe(1);
      expect(res.workedMinutes).toBe(480);
      expect(res.breakMinutes).toBe(30);
      expect(res.days).toHaveLength(9);
      expect(res.days[2]).toMatchObject({
        date: '2026-08-03',
        present: true,
        weeklyOff: false,
        leave: false,
        workedMinutes: 480,
      });
      expect(res.days[3]).toMatchObject({ date: '2026-08-04', missingCheckout: true });
      expect(res.days[4]).toMatchObject({ date: '2026-08-05', leave: true, present: false });
      expect(res.days[0]).toMatchObject({ date: '2026-08-01', weeklyOff: true });
    });

    it('defaults from/to to the current Dhaka month', async () => {
      jest.useFakeTimers({ now: new Date('2026-08-24T18:30:00.000Z') });
      prismaMock.attendanceDay.findMany.mockResolvedValue([]);
      prismaMock.leaveRequest.findMany.mockResolvedValue([]);
      prismaMock.weeklyOff.findMany.mockResolvedValue([]);
      const res = await service.report('emp-1');
      expect(res.from).toBe('2026-08-01');
      expect(res.to).toBe('2026-08-31');
      expect(res.daysInRange).toBe(31);
    });

    it('404 when the employee does not exist', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(null);
      await expect(
        service.report('missing', '2026-08-01', '2026-08-09'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});