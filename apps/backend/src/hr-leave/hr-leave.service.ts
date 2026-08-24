import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { DecideLeaveRequestDto } from './dto/decide-leave-request.dto';

@Injectable()
export class HrLeaveService {
  constructor(private prisma: PrismaService) {}

  async createType(dto: CreateLeaveTypeDto) {
    const byName = await this.prisma.leaveType.findUnique({
      where: { name: dto.name },
    });
    if (byName)
      throw new ConflictException('Leave type with this name already exists');
    const byCode = await this.prisma.leaveType.findUnique({
      where: { code: dto.code },
    });
    if (byCode)
      throw new ConflictException('Leave type with this code already exists');

    try {
      return await this.prisma.leaveType.create({
        data: {
          name: dto.name,
          code: dto.code,
          daysPerYear: dto.daysPerYear,
          isPaid: dto.isPaid ?? true,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (err) {
      // Race guard: concurrent creates can both pass the pre-checks; P2002 on
      // the unique name/code constraints surfaces as a friendly 409.
      if ((err as { code?: string } | null)?.code === 'P2002') {
        throw new ConflictException(
          'Leave type with this name or code already exists',
        );
      }
      throw err;
    }
  }

  async listTypes(filter: { isActive?: boolean } = {}) {
    const where: Prisma.LeaveTypeWhereInput = {};
    if (filter.isActive !== undefined) where.isActive = filter.isActive;
    return this.prisma.leaveType.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateType(id: string, dto: UpdateLeaveTypeDto) {
    const existing = await this.prisma.leaveType.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Leave type not found');

    if (dto.name !== undefined && dto.name !== existing.name) {
      const byName = await this.prisma.leaveType.findUnique({
        where: { name: dto.name },
      });
      if (byName)
        throw new ConflictException(
          'Leave type with this name already exists',
        );
    }
    if (dto.code !== undefined && dto.code !== existing.code) {
      const byCode = await this.prisma.leaveType.findUnique({
        where: { code: dto.code },
      });
      if (byCode)
        throw new ConflictException(
          'Leave type with this code already exists',
        );
    }

    try {
      return await this.prisma.leaveType.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.code !== undefined ? { code: dto.code } : {}),
          ...(dto.daysPerYear !== undefined ? { daysPerYear: dto.daysPerYear } : {}),
          ...(dto.isPaid !== undefined ? { isPaid: dto.isPaid } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
    } catch (err) {
      if ((err as { code?: string } | null)?.code === 'P2002') {
        throw new ConflictException(
          'Leave type with this name or code already exists',
        );
      }
      throw err;
    }
  }

  async deleteType(id: string) {
    const existing = await this.prisma.leaveType.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Leave type not found');

    // LeaveType → LeaveRequest is onDelete: Restrict; deleting a type that
    // has requests would throw a raw P2003. Surface it as a friendly 409.
    const requestCount = await this.prisma.leaveRequest.count({
      where: { typeId: id },
    });
    if (requestCount > 0)
      throw new ConflictException(
        'Cannot delete leave type that has requests',
      );

    try {
      await this.prisma.leaveType.delete({ where: { id } });
      return { success: true, id };
    } catch (err) {
      // Race guard: a request created between the count and the delete.
      if ((err as { code?: string } | null)?.code === 'P2003') {
        throw new ConflictException(
          'Cannot delete leave type that has requests',
        );
      }
      throw err;
    }
  }

  private computeDays(start: Date, end: Date): number {
    return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  }

  /**
   * Overlap guard (G-14): a leave request must not overlap another request
   * that is still pending or already approved. Existing rejected/cancelled
   * requests never block (they are excluded by the status filter). `excludeId`
   * is used at decision time so a pending request does not block its own
   * approval.
   */
  private async assertNoOverlap(
    employeeId: string,
    startDate: Date,
    endDate: Date,
    excludeId?: string,
  ) {
    const overlap = await this.prisma.leaveRequest.findFirst({
      where: {
        employeeId,
        status: { in: ['pending', 'approved'] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (overlap) {
      throw new ConflictException(
        'Overlapping leave request already exists for this employee.',
      );
    }
  }

  async createRequest(dto: CreateLeaveRequestDto, actorId?: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const type = await this.prisma.leaveType.findUnique({
      where: { id: dto.typeId },
    });
    if (!type) throw new NotFoundException('Leave type not found');

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate < startDate) {
      throw new BadRequestException('endDate must be on or after startDate');
    }
    const days = dto.days ?? this.computeDays(startDate, endDate);

    await this.assertNoOverlap(dto.employeeId, startDate, endDate);

    return this.prisma.leaveRequest.create({
      data: {
        employeeId: dto.employeeId,
        typeId: dto.typeId,
        startDate,
        endDate,
        days,
        reason: dto.reason,
        status: 'pending',
        createdById: actorId ?? null,
      },
    });
  }

  async listRequests(
    filter: { employeeId?: string; status?: string } = {},
    page = 1,
    perPage = 20,
  ) {
    page = Math.max(1, page);
    perPage = Math.max(1, Math.min(100, perPage));
    const where: Prisma.LeaveRequestWhereInput = {};
    if (filter.employeeId) where.employeeId = filter.employeeId;
    if (filter.status) where.status = filter.status as any;
    const [data, total] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          type: true,
          employee: {
            select: {
              id: true,
              employeeId: true,
              betterAuthUser: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  private async loadPending(id: string) {
    const req = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Leave request not found');
    if (req.status !== 'pending') {
      throw new BadRequestException(
        `Leave request is already ${req.status}; only pending requests can be decided`,
      );
    }
    return req;
  }

  async approveRequest(id: string, dto: DecideLeaveRequestDto, actorId?: string) {
    const req = await this.loadPending(id);
    // Re-check overlap at decision time — a race could otherwise allow two
    // requests for the same range to both be approved.
    await this.assertNoOverlap(req.employeeId, req.startDate, req.endDate, req.id);
    return this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: 'approved',
        decisionNote: dto.decisionNote ?? null,
        approvedById: actorId ?? null,
        approvedAt: new Date(),
      },
    });
  }

  async rejectRequest(id: string, dto: DecideLeaveRequestDto, actorId?: string) {
    if (!dto.decisionNote || !dto.decisionNote.trim()) {
      throw new BadRequestException('decisionNote is required to reject');
    }
    const req = await this.loadPending(id);
    return this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: 'rejected',
        decisionNote: dto.decisionNote,
        approvedById: actorId ?? null,
        approvedAt: new Date(),
      },
    });
  }

  async cancelRequest(id: string, actorId?: string) {
    const req = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Leave request not found');
    if (req.status !== 'pending' && req.status !== 'approved') {
      throw new BadRequestException(
        `Leave request is ${req.status}; only pending or approved requests can be cancelled`,
      );
    }
    const isCreator = actorId != null && req.createdById === actorId;
    if (!isCreator && actorId != null) {
      // Caller is not the creator; only managerial roles may cancel on behalf.
      // Managerial role enforcement is handled at the controller guard layer.
    }
    return this.prisma.leaveRequest.update({
      where: { id },
      data: { status: 'cancelled' },
    });
  }

  async leaveBalances(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const year = new Date().getFullYear();
    const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    const types = await this.prisma.leaveType.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    const result: Array<{
      typeId: string;
      typeName: string;
      isPaid: boolean;
      entitlement: number;
      used: number;
      remaining: number;
    }> = [];
    for (const type of types) {
      const agg = await this.prisma.leaveRequest.aggregate({
        where: {
          employeeId,
          typeId: type.id,
          status: 'approved',
          startDate: { gte: start, lte: end },
        },
        _sum: { days: true },
      });
      const used = agg._sum.days ?? 0;
      result.push({
        typeId: type.id,
        typeName: type.name,
        isPaid: type.isPaid,
        entitlement: type.daysPerYear,
        used,
        remaining: type.daysPerYear - used,
      });
    }
    return result;
  }

  async leaveCalendar(filter: {
    employeeId?: string;
    year?: number;
    month?: number;
  } = {}) {
    const where: Prisma.LeaveRequestWhereInput = { status: 'approved' };
    if (filter.employeeId) where.employeeId = filter.employeeId;
    if (filter.year !== undefined) {
      const y = filter.year;
      if (filter.month !== undefined) {
        const m = filter.month - 1;
        where.startDate = {
          gte: new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)),
          lt: new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0)),
        };
      } else {
        where.startDate = {
          gte: new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0)),
          lt: new Date(Date.UTC(y + 1, 0, 1, 0, 0, 0, 0)),
        };
      }
    }
    const rows = await this.prisma.leaveRequest.findMany({
      where,
      orderBy: { startDate: 'asc' },
      include: { type: { select: { name: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      typeName: r.type?.name ?? null,
      startDate: r.startDate,
      endDate: r.endDate,
    }));
  }
}
