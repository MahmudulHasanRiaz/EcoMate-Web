import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerStatus } from '@prisma/client';
import { CreateEarningDto } from './dto/create-earning.dto';
import { CreateDeductionDto } from './dto/create-deduction.dto';

@Injectable()
export class HrLedgersService {
  constructor(private prisma: PrismaService) {}

  private async ensureEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  private buildWhere(filter: {
    employeeId?: string;
    status?: LedgerStatus;
  }) {
    const where: { employeeId?: string; status?: LedgerStatus } = {};
    if (filter.employeeId) where.employeeId = filter.employeeId;
    if (filter.status) where.status = filter.status;
    return where;
  }

  async createEarning(dto: CreateEarningDto, actorId?: string) {
    await this.ensureEmployee(dto.employeeId);
    return this.prisma.employeeEarning.create({
      data: {
        employeeId: dto.employeeId,
        type: dto.type,
        amount: dto.amount,
        reason: dto.reason,
        applicableFrom: dto.applicableFrom ? new Date(dto.applicableFrom) : null,
        applicableTo: dto.applicableTo ? new Date(dto.applicableTo) : null,
        status: LedgerStatus.draft,
        createdById: actorId ?? null,
      },
    });
  }

  async findEarnings(
    filter: { employeeId?: string; status?: LedgerStatus },
    page = 1,
    perPage = 20,
  ) {
    page = Math.max(1, page);
    perPage = Math.max(1, Math.min(100, perPage));
    const where = this.buildWhere(filter);
    const [data, total] = await Promise.all([
      this.prisma.employeeEarning.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.employeeEarning.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async approveEarning(id: string, actorId?: string) {
    const row = await this.prisma.employeeEarning.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Earning not found');
    if (row.status !== LedgerStatus.draft)
      throw new BadRequestException(
        `Cannot approve earning with status "${row.status}"`,
      );
    return this.prisma.employeeEarning.update({
      where: { id },
      data: {
        status: LedgerStatus.approved,
        approvedById: actorId ?? null,
        approvedAt: new Date(),
      },
    });
  }

  async createDeduction(dto: CreateDeductionDto, actorId?: string) {
    await this.ensureEmployee(dto.employeeId);
    return this.prisma.employeeDeduction.create({
      data: {
        employeeId: dto.employeeId,
        type: dto.type,
        amount: dto.amount,
        reason: dto.reason,
        applicableFrom: dto.applicableFrom ? new Date(dto.applicableFrom) : null,
        applicableTo: dto.applicableTo ? new Date(dto.applicableTo) : null,
        status: LedgerStatus.draft,
        createdById: actorId ?? null,
      },
    });
  }

  async findDeductions(
    filter: { employeeId?: string; status?: LedgerStatus },
    page = 1,
    perPage = 20,
  ) {
    page = Math.max(1, page);
    perPage = Math.max(1, Math.min(100, perPage));
    const where = this.buildWhere(filter);
    const [data, total] = await Promise.all([
      this.prisma.employeeDeduction.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.employeeDeduction.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async approveDeduction(id: string, actorId?: string) {
    const row = await this.prisma.employeeDeduction.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Deduction not found');
    if (row.status !== LedgerStatus.draft)
      throw new BadRequestException(
        `Cannot approve deduction with status "${row.status}"`,
      );
    return this.prisma.employeeDeduction.update({
      where: { id },
      data: {
        status: LedgerStatus.approved,
        approvedById: actorId ?? null,
        approvedAt: new Date(),
      },
    });
  }
}
