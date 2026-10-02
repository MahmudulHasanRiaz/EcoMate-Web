import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  detectOvernight,
  parseWallClock,
  type DerivableShift,
} from '../hr-attendance/attendance-derivation';
import type { CreateShiftPresetDto, UpdateShiftPresetDto } from './dto/shift.dto';

const DAY_MS = 86400000;

@Injectable()
export class ShiftService {
  constructor(private prisma: PrismaService) {}

  // ── Presets ──────────────────────────────────────────────────────────

  /**
   * Standard minutes for a shift: the span it covers, minus its standard break.
   * Overnight spans cross midnight, so the end is taken relative to the start.
   */
  private computeStandardMinutes(
    startTime: string,
    endTime: string,
    breakMinutes: number,
  ): number {
    const start = parseWallClock(startTime);
    const end = parseWallClock(endTime);
    if (start === end) {
      throw new BadRequestException(
        'startTime and endTime must differ — a shift cannot be zero-length',
      );
    }
    const overnight = detectOvernight(startTime, endTime);
    const span = overnight ? end + DAY_MS / 60000 - start : end - start;
    const standard = span - breakMinutes;
    if (standard <= 0) {
      throw new BadRequestException(
        `Break (${breakMinutes}m) must be shorter than the shift span (${span}m)`,
      );
    }
    if (standard >= 1440) {
      throw new BadRequestException('A shift cannot exceed 24 hours');
    }
    return standard;
  }

  async listPresets(includeInactive = false) {
    return this.prisma.shiftPreset.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { name: 'asc' },
      include: {
        assignments: {
          where: { effectiveTo: null },
          select: { id: true, employeeId: true },
        },
      },
    });
  }

  async getPreset(id: string) {
    const preset = await this.prisma.shiftPreset.findUnique({
      where: { id },
      include: { assignments: { where: { effectiveTo: null } } },
    });
    if (!preset) throw new NotFoundException('Shift preset not found');
    return preset;
  }

  async createPreset(dto: CreateShiftPresetDto) {
    const standardMinutes = this.computeStandardMinutes(
      dto.startTime,
      dto.endTime,
      dto.breakMinutes,
    );
    try {
      return await this.prisma.shiftPreset.create({
        data: {
          name: dto.name,
          code: dto.code,
          startTime: dto.startTime,
          endTime: dto.endTime,
          graceMinutes: dto.graceMinutes,
          breakMinutes: dto.breakMinutes,
          standardMinutes,
          overnight: detectOvernight(dto.startTime, dto.endTime),
          notes: dto.notes ?? null,
        },
      });
    } catch (err) {
      throw this.translateUnique(err, dto.name, dto.code);
    }
  }

  async updatePreset(id: string, dto: UpdateShiftPresetDto) {
    const existing = await this.prisma.shiftPreset.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Shift preset not found');

    const startTime = dto.startTime ?? existing.startTime;
    const endTime = dto.endTime ?? existing.endTime;
    const breakMinutes = dto.breakMinutes ?? existing.breakMinutes;

    // Standard minutes are derived, never client-supplied: the UI showing
    // "7h 30m" and the overtime maths must never disagree.
    const standardMinutes = this.computeStandardMinutes(
      startTime,
      endTime,
      breakMinutes,
    );

    try {
      return await this.prisma.shiftPreset.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          startTime,
          endTime,
          breakMinutes,
          standardMinutes,
          overnight: detectOvernight(startTime, endTime),
          ...(dto.graceMinutes !== undefined
            ? { graceMinutes: dto.graceMinutes }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
      });
    } catch (err) {
      throw this.translateUnique(err, dto.name, existing.code);
    }
  }

  /**
   * Soft delete only. A preset still in a live rotation is refused outright —
   * deactivating it would silently strip shifts from employees mid-week.
   */
  async deactivatePreset(id: string) {
    const active = await this.prisma.shiftAssignment.count({
      where: { shiftPresetId: id, effectiveTo: null },
    });
    if (active > 0) {
      throw new BadRequestException(
        `Cannot remove this preset — ${active} employee rotation${
          active === 1 ? '' : 's'
        } still use${active === 1 ? 's' : ''} it. Reassign those first.`,
      );
    }
    return this.prisma.shiftPreset.update({
      where: { id },
      data: { isActive: false },
    });
  }

  private translateUnique(err: unknown, name?: string, code?: string) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return new ConflictException(
        'A shift preset with that name or code already exists',
      );
    }
    return err;
  }

  // ── Rotation ──────────────────────────────────────────────────────────

  private async ensureEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  async getRotation(employeeId: string) {
    await this.ensureEmployee(employeeId);
    const rows = await this.prisma.shiftAssignment.findMany({
      where: { employeeId, effectiveTo: null },
      include: { shiftPreset: true },
    });
    const byDay: Record<
      number,
      { dayOfWeek: number; shift: { id: string; name: string; code: string } }
    > = {};
    for (const r of rows) {
      byDay[r.dayOfWeek] = {
        dayOfWeek: r.dayOfWeek,
        shift: { id: r.shiftPreset.id, name: r.shiftPreset.name, code: r.shiftPreset.code },
      };
    }
    return { employeeId, rotation: Object.values(byDay).sort((a, b) => a.dayOfWeek - b.dayOfWeek) };
  }

  /**
   * Replace one weekday's shift, effective-dated. Closes the current row and
   * opens a new one, so historical attendance days keep the shift that was in
   * force when they were worked.
   */
  async setRotationDay(
    employeeId: string,
    dayOfWeek: number,
    shiftPresetId: string,
    actorId?: string | null,
  ) {
    await this.ensureEmployee(employeeId);
    const preset = await this.prisma.shiftPreset.findUnique({
      where: { id: shiftPresetId },
    });
    if (!preset) throw new NotFoundException('Shift preset not found');
    if (!preset.isActive) {
      throw new BadRequestException(
        'That shift preset is retired and cannot be assigned',
      );
    }

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const open = await tx.shiftAssignment.findFirst({
        where: { employeeId, dayOfWeek, effectiveTo: null },
        include: { shiftPreset: true },
      });

      // No-op when the same preset is already in force — avoid closing and
      // reopening a row for an unchanged assignment.
      if (open?.shiftPresetId === shiftPresetId) {
        return {
          employeeId,
          dayOfWeek,
          shiftPresetId,
          changed: false,
        };
      }

      if (open) {
        await tx.shiftAssignment.update({
          where: { id: open.id },
          data: { effectiveTo: now },
        });
      }

      await tx.shiftAssignment.create({
        data: {
          employeeId,
          shiftPresetId,
          dayOfWeek,
          effectiveFrom: now,
          createdById: actorId ?? null,
        },
      });

      await tx.employmentHistory.create({
        data: {
          employeeId,
          field: 'shift',
          oldValue: open ? `${open.dayOfWeek}:${open.shiftPreset.name}` : null,
          newValue: `${dayOfWeek}:${preset.name}`,
          effectiveFrom: now,
          changedById: actorId ?? null,
        },
      });

      return { employeeId, dayOfWeek, shiftPresetId, changed: true };
    });
  }

  /** Clear one weekday's shift (off that day from the rotation). */
  async clearRotationDay(
    employeeId: string,
    dayOfWeek: number,
    actorId?: string | null,
  ) {
    await this.ensureEmployee(employeeId);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const open = await tx.shiftAssignment.findFirst({
        where: { employeeId, dayOfWeek, effectiveTo: null },
        include: { shiftPreset: true },
      });
      if (!open) return { employeeId, dayOfWeek, changed: false };
      await tx.shiftAssignment.update({
        where: { id: open.id },
        data: { effectiveTo: now },
      });
      await tx.employmentHistory.create({
        data: {
          employeeId,
          field: 'shift',
          oldValue: `${open.dayOfWeek}:${open.shiftPreset.name}`,
          newValue: null,
          effectiveFrom: now,
          changedById: actorId ?? null,
        },
      });
      return { employeeId, dayOfWeek, changed: true };
    });
  }

  // ── Resolution ────────────────────────────────────────────────────────

  /**
   * The shift in force for an employee on a business day, or null when that
   * weekday has no assignment. Date is the stored convention (UTC midnight for
   * the Dhaka calendar date) — the same value as AttendanceDay.date.
   */
  async resolveFor(
    employeeId: string,
    day: Date,
  ): Promise<DerivableShift | null> {
    // Day-of-week is taken in Dhaka terms: a business day is named by its
    // calendar date, and getUTCDay() on the stored UTC-midnight value is
    // exactly that weekday.
    const dayOfWeek = day.getUTCDay();

    // An assignment takes effect from the START of the business day it was
    // made, not the instant it was saved. Without this, a shift assigned at
    // 09:00 would not resolve for the very day it was assigned — the row's
    // effectiveFrom (a real timestamp) is later than the day boundary.
    const dayStart = day;
    // Order explicitly: several rows can be in force for the same weekday when
    // a rotation is reassigned mid-day, and findFirst without an orderBy has no
    // defined result — it could return the closed row and resolve the OLD shift.
    const candidates = await this.prisma.shiftAssignment.findMany({
      where: {
        employeeId,
        dayOfWeek,
        effectiveFrom: { lt: new Date(day.getTime() + DAY_MS) },
        OR: [
          { effectiveTo: null },
          // A row closed during this day still governed it up to that moment.
          { effectiveTo: { gt: dayStart } },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
      take: 1,
      include: { shiftPreset: true },
    });
    const assignment = candidates[0];
    if (!assignment) return null;
    const p = assignment.shiftPreset;
    return {
      startTime: p.startTime,
      endTime: p.endTime,
      graceMinutes: p.graceMinutes,
      breakMinutes: p.breakMinutes,
      standardMinutes: p.standardMinutes,
      overnight: p.overnight,
    };
  }
}