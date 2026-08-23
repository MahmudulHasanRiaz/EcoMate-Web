import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { baPrisma } from '../better-auth/prisma';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

const TERMINAL_STATUSES: EmployeeStatus[] = ['terminated', 'resigned'];

const EMPLOYEE_STATUS_TRANSITIONS: Record<EmployeeStatus, EmployeeStatus[]> = {
  active: ['inactive', 'on_leave', 'suspended', 'terminated', 'resigned'],
  inactive: ['active', 'on_leave', 'suspended', 'terminated', 'resigned'],
  on_leave: ['active', 'inactive', 'suspended'],
  suspended: ['active', 'on_leave'],
  terminated: [],
  resigned: [],
};

@Injectable()
export class EmployeesService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    page = 1,
    perPage = 20,
    status?: string,
    departmentId?: string,
  ) {
    const where: any = {};
    if (status) where.status = status;
    if (departmentId) where.departmentId = departmentId;

    const [data, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          department: { select: { id: true, name: true, slug: true } },
          designation: {
            select: { id: true, name: true, slug: true, level: true },
          },
          accessPreset: { select: { id: true, name: true } },
          reportingTo: {
            select: {
              id: true,
              employeeId: true,
              betterAuthUser: { select: { name: true } },
            },
          },
          betterAuthUser: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
      }),
      this.prisma.employee.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findOne(id: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        department: { select: { id: true, name: true, slug: true } },
        designation: {
          select: { id: true, name: true, slug: true, level: true },
        },
        accessPreset: { select: { id: true, name: true } },
        reportingTo: {
          select: {
            id: true,
            employeeId: true,
            betterAuthUser: { select: { name: true } },
          },
        },
        betterAuthUser: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  async create(dto: CreateEmployeeDto) {
    const baUser = await baPrisma.betterAuthUser.findUnique({
      where: { id: dto.betterAuthUserId },
    });
    if (!baUser) throw new BadRequestException('Better Auth user not found');

    const existing = await this.prisma.employee.findUnique({
      where: { betterAuthUserId: dto.betterAuthUserId },
    });
    if (existing) throw new ConflictException('User is already an employee');

    if (dto.departmentId) {
      const dept = await this.prisma.department.findUnique({
        where: { id: dto.departmentId },
      });
      if (!dept) throw new NotFoundException('Department not found');
    }
    if (dto.designationId) {
      const desig = await this.prisma.designation.findUnique({
        where: { id: dto.designationId },
      });
      if (!desig) throw new NotFoundException('Designation not found');
    }
    if (dto.accessPresetId) {
      const preset = await this.prisma.accessPreset.findUnique({
        where: { id: dto.accessPresetId },
      });
      if (!preset) throw new NotFoundException('Access preset not found');
    }
    if (dto.reportingToId) {
      const manager = await this.prisma.employee.findUnique({
        where: { id: dto.reportingToId },
      });
      if (!manager) throw new NotFoundException('Employee not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const counter = await tx.orderCounter.upsert({
        where: { date: this.dateStr() },
        create: { date: this.dateStr(), seq: 1 },
        update: { seq: { increment: 1 } },
      });

      const employeeId = `EMP-${this.dateStr()}-${String(counter.seq).padStart(4, '0')}`;

      const employee = await tx.employee.create({
        data: {
          betterAuthUserId: dto.betterAuthUserId,
          employeeId,
          departmentId: dto.departmentId,
          designationId: dto.designationId,
          accessPresetId: dto.accessPresetId,
          reportingToId: dto.reportingToId,
          employmentType: dto.employmentType || 'full_time',
          status: dto.status,
          joiningDate: new Date(dto.joiningDate),
          exitDate: dto.exitDate ? new Date(dto.exitDate) : undefined,
          salary: dto.salary ?? undefined,
          bankAccountNo: dto.bankAccountNo,
          bankName: dto.bankName,
          profilePictureUrl: dto.profilePictureUrl,
          notes: dto.notes,
        },
        include: {
          department: { select: { id: true, name: true, slug: true } },
          designation: {
            select: { id: true, name: true, slug: true, level: true },
          },
          accessPreset: { select: { id: true, name: true } },
          betterAuthUser: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
      });

      await baPrisma.betterAuthUser.update({
        where: { id: dto.betterAuthUserId },
        data: { role: 'employee' },
      });

      const profile = await tx.userProfile.findUnique({
        where: { betterAuthUserId: dto.betterAuthUserId },
        select: { id: true, role: true },
      });
      if (profile && profile.role === 'customer') {
        await tx.userProfile.update({
          where: { id: profile.id },
          data: { role: 'employee' },
        });
      }

      return employee;
    });
  }

  async update(id: string, dto: UpdateEmployeeDto, actorId?: string) {
    const current = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        department: { select: { id: true, name: true } },
        designation: { select: { id: true, name: true } },
        reportingTo: {
          select: {
            id: true,
            employeeId: true,
            betterAuthUser: { select: { name: true } },
          },
        },
      },
    });
    if (!current) throw new NotFoundException('Employee not found');

    let newDepartment: { id: string; name: string } | null = null;
    if (dto.departmentId !== undefined && dto.departmentId !== current.departmentId) {
      newDepartment = await this.prisma.department.findUnique({
        where: { id: dto.departmentId },
      });
      if (!newDepartment) throw new NotFoundException('Department not found');
    }
    let newDesignation: { id: string; name: string } | null = null;
    if (dto.designationId !== undefined && dto.designationId !== current.designationId) {
      newDesignation = await this.prisma.designation.findUnique({
        where: { id: dto.designationId },
      });
      if (!newDesignation) throw new NotFoundException('Designation not found');
    }
    if (dto.accessPresetId !== undefined && dto.accessPresetId !== current.accessPresetId) {
      const preset = await this.prisma.accessPreset.findUnique({
        where: { id: dto.accessPresetId },
      });
      if (!preset) throw new NotFoundException('Access preset not found');
    }
    let newManager: {
      id: string;
      employeeId: string;
      betterAuthUser: { name: string | null } | null;
    } | null = null;
    if (dto.reportingToId !== undefined && dto.reportingToId !== current.reportingToId) {
      if (dto.reportingToId === current.id) {
        throw new BadRequestException('Employee cannot report to themselves');
      }
      newManager = await this.prisma.employee.findUnique({
        where: { id: dto.reportingToId },
        select: {
          id: true,
          employeeId: true,
          betterAuthUser: { select: { name: true } },
        },
      });
      if (!newManager) throw new NotFoundException('Employee not found');
    }

    if (dto.status && dto.status !== current.status) {
      const allowed = EMPLOYEE_STATUS_TRANSITIONS[current.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Invalid status transition from ${current.status} to ${dto.status}`,
        );
      }
      if (TERMINAL_STATUSES.includes(dto.status) && !dto.exitDate) {
        throw new BadRequestException(
          `exitDate is required when status is ${dto.status}`,
        );
      }
    }

    const changedById = actorId ?? null;
    const historyRows: {
      employeeId: string;
      field:
        | 'status'
        | 'department'
        | 'designation'
        | 'reporting_manager'
        | 'employment_type';
      oldValue: string | null;
      newValue: string | null;
      effectiveFrom: Date;
      changedById: string | null;
    }[] = [];

    if (dto.status !== undefined && dto.status !== current.status) {
      historyRows.push({
        employeeId: id,
        field: 'status',
        oldValue: current.status,
        newValue: dto.status,
        effectiveFrom: new Date(),
        changedById,
      });
    }
    if (
      dto.departmentId !== undefined &&
      dto.departmentId !== current.departmentId
    ) {
      historyRows.push({
        employeeId: id,
        field: 'department',
        oldValue: current.department?.name ?? current.departmentId,
        newValue: newDepartment?.name ?? dto.departmentId,
        effectiveFrom: new Date(),
        changedById,
      });
    }
    if (
      dto.designationId !== undefined &&
      dto.designationId !== current.designationId
    ) {
      historyRows.push({
        employeeId: id,
        field: 'designation',
        oldValue: current.designation?.name ?? current.designationId,
        newValue: newDesignation?.name ?? dto.designationId,
        effectiveFrom: new Date(),
        changedById,
      });
    }
    if (
      dto.employmentType !== undefined &&
      dto.employmentType !== current.employmentType
    ) {
      historyRows.push({
        employeeId: id,
        field: 'employment_type',
        oldValue: current.employmentType,
        newValue: dto.employmentType,
        effectiveFrom: new Date(),
        changedById,
      });
    }
    if (
      dto.reportingToId !== undefined &&
      dto.reportingToId !== current.reportingToId
    ) {
      const reporterLabel = (emp: {
        employeeId: string;
        betterAuthUser: { name: string | null } | null;
      } | null, fallback: string | null): string | null => {
        if (!emp) return fallback;
        const name = emp.betterAuthUser?.name;
        return name ? `${emp.employeeId} · ${name}` : emp.employeeId;
      };
      historyRows.push({
        employeeId: id,
        field: 'reporting_manager',
        oldValue: reporterLabel(
          current.reportingTo,
          current.reportingToId ?? null,
        ),
        newValue: reporterLabel(newManager, dto.reportingToId ?? null),
        effectiveFrom: new Date(),
        changedById,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.update({
        where: { id },
        data: {
          ...dto,
          joiningDate: dto.joiningDate ? new Date(dto.joiningDate) : undefined,
          exitDate: dto.exitDate ? new Date(dto.exitDate) : undefined,
        },
        include: {
          department: { select: { id: true, name: true, slug: true } },
          designation: {
            select: { id: true, name: true, slug: true, level: true },
          },
          accessPreset: { select: { id: true, name: true } },
          betterAuthUser: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
      });

      if (historyRows.length > 0) {
        await tx.employmentHistory.createMany({ data: historyRows });
      }

      return employee;
    });
  }

  async remove(id: string) {
    const emp = await this.findOne(id);
    const profile = await this.prisma.userProfile.findUnique({
      where: { betterAuthUserId: emp.betterAuthUserId },
    });
    await baPrisma.betterAuthUser.update({
      where: { id: emp.betterAuthUserId },
      data: { role: profile?.role ?? 'customer' },
    });
    return this.prisma.employee.delete({ where: { id } });
  }

  async searchBaUsers(query: string) {
    const users = await baPrisma.betterAuthUser.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
        employee: null,
      },
      take: 20,
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, role: true },
    });
    return { data: users };
  }

  private dateStr() {
    const d = new Date();
    const yy = d.getFullYear().toString().slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
  }
}
