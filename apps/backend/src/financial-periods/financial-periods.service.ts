import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFinancialPeriodDto } from './dto/create-financial-period.dto';

@Injectable()
export class FinancialPeriodsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateFinancialPeriodDto) {
    if (dto.startDate > dto.endDate) {
      throw new BadRequestException('Start date must be before end date');
    }

    const overlapping = await this.prisma.financialPeriod.findFirst({
      where: {
        startDate: { lte: dto.endDate },
        endDate: { gte: dto.startDate },
      },
    });

    if (overlapping) {
      throw new ConflictException('A financial period already exists for this date range');
    }

    return this.prisma.financialPeriod.create({ data: dto });
  }

  async findAll() {
    return this.prisma.financialPeriod.findMany({
      orderBy: { startDate: 'desc' },
    });
  }

  async findOne(id: string) {
    const period = await this.prisma.financialPeriod.findUnique({ where: { id } });

    if (!period) {
      throw new NotFoundException(`Financial period with ID ${id} not found`);
    }

    return period;
  }

  async closePeriod(id: string) {
    const period = await this.prisma.financialPeriod.findUnique({ where: { id } });

    if (!period) {
      throw new NotFoundException(`Financial period with ID ${id} not found`);
    }

    if (period.isClosed) {
      throw new BadRequestException('Financial period is already closed');
    }

    return this.prisma.financialPeriod.update({
      where: { id },
      data: { isClosed: true },
    });
  }

  async openPeriod(id: string) {
    const period = await this.prisma.financialPeriod.findUnique({ where: { id } });

    if (!period) {
      throw new NotFoundException(`Financial period with ID ${id} not found`);
    }

    if (!period.isClosed) {
      throw new BadRequestException('Financial period is already open');
    }

    return this.prisma.financialPeriod.update({
      where: { id },
      data: { isClosed: false },
    });
  }
}
