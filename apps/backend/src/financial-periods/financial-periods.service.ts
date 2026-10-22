import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFinancialPeriodDto } from './dto/create-financial-period.dto';
import { FinancialPeriod } from '@prisma/client';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

@Injectable()
export class FinancialPeriodsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateFinancialPeriodDto) {
    if (dto.startDate > dto.endDate) {
      throw new BadRequestException('Start date must be before end date');
    }

    return this.prisma.$transaction(async (tx) => {
      const overlapping = await tx.financialPeriod.findFirst({
        where: {
          startDate: { lte: dto.endDate },
          endDate: { gte: dto.startDate },
        },
      });

      if (overlapping) {
        throw new ConflictException(
          'A financial period already exists for this date range',
        );
      }

      return tx.financialPeriod.create({ data: dto });
    });
  }

  async findAll() {
    return this.prisma.financialPeriod.findMany({
      orderBy: { startDate: 'desc' },
    });
  }

  async findOne(id: string) {
    const period = await this.prisma.financialPeriod.findUnique({
      where: { id },
    });

    if (!period) {
      throw new NotFoundException(`Financial period with ID ${id} not found`);
    }

    return period;
  }

  async closePeriod(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const period = await tx.financialPeriod.findUnique({
        where: { id },
      });

      if (!period) {
        throw new NotFoundException(`Financial period with ID ${id} not found`);
      }

      if (period.isClosed) {
        throw new BadRequestException('Financial period is already closed');
      }

      const entryCount = await tx.journalEntry.count({
        where: { periodId: id },
      });

      if (entryCount === 0) {
        throw new BadRequestException(
          'Cannot close a financial period with no journal entries',
        );
      }

      return tx.financialPeriod.update({
        where: { id },
        data: { isClosed: true },
      });
    });
  }

  async openPeriod(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const period = await tx.financialPeriod.findUnique({
        where: { id },
      });

      if (!period) {
        throw new NotFoundException(`Financial period with ID ${id} not found`);
      }

      if (!period.isClosed) {
        throw new BadRequestException('Financial period is already open');
      }

      return tx.financialPeriod.update({
        where: { id },
        data: { isClosed: false },
      });
    });
  }

  /**
   * Idempotently ensures the twelve monthly periods of `year` exist.
   * Never modifies, re-opens or deletes an existing period.
   */
  async ensureYearPeriods(
    year: number,
  ): Promise<{ created: number; existing: number }> {
    let created = 0;
    let existing = 0;

    for (let month = 0; month < 12; month++) {
      const startDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
      const endDate = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
      const name = `${MONTH_NAMES[month]} ${year}`;

      try {
        await this.create({ name, startDate, endDate });
        created++;
      } catch (err) {
        if (err instanceof ConflictException || this.isUniqueViolation(err)) {
          existing++;
        } else {
          throw err;
        }
      }
    }

    return { created, existing };
  }

  /** ensureYearPeriods(new Date().getUTCFullYear()) */
  async ensureCurrentYearPeriods(): Promise<{
    created: number;
    existing: number;
  }> {
    // The UTC calendar year is the defensible default: this codebase has no
    // fiscal-year / fiscal-year-start configuration anywhere (Bangladesh's
    // Jul–Jun cycle is not modelled), so calendar months are what we can honour.
    return this.ensureYearPeriods(new Date().getUTCFullYear());
  }

  /**
   * The period covering `date`, creating that calendar month when missing.
   * Returns null only when no period could be resolved.
   */
  async ensurePeriodCovering(date: Date): Promise<FinancialPeriod | null> {
    const covering = await this.findCoveringPeriod(date);
    if (covering) return covering;

    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const startDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
    const name = `${MONTH_NAMES[month]} ${year}`;

    try {
      return await this.create({ name, startDate, endDate });
    } catch {
      // A concurrent creator (P2002) or an overlapping admin period wins the
      // race; fall back to whatever now covers `date`. Never throws.
      try {
        return await this.findCoveringPeriod(date);
      } catch {
        return null;
      }
    }
  }

  private findCoveringPeriod(date: Date): Promise<FinancialPeriod | null> {
    return this.prisma.financialPeriod.findFirst({
      where: { startDate: { lte: date }, endDate: { gte: date } },
      orderBy: { startDate: 'desc' },
    });
  }

  private isUniqueViolation(err: unknown): boolean {
    return (err as { code?: string } | null)?.code === 'P2002';
  }
}
