import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type CompensationSourceType =
  | 'payroll'
  | 'commission'
  | 'commission_v2';

export type CompensationCategorySlug = 'salaries' | 'commissions';

export interface PostCompensationExpenseInput {
  sourceType: CompensationSourceType;
  sourceId: string;
  amount: number;
  expenseDate: Date;
  description: string;
  categorySlug: CompensationCategorySlug;
}

export interface ReverseCompensationExpenseInput {
  /** Original source type; the reversal row is written as `<type>_reversal`. */
  sourceType: CompensationSourceType;
  sourceId: string;
  expenseDate: Date;
  description: string;
  categorySlug: CompensationCategorySlug;
}

const CATEGORY_FALLBACKS: Record<
  CompensationCategorySlug,
  { name: string; kind: 'fixed' | 'variable'; color: string; sortOrder: number }
> = {
  salaries: {
    name: 'Salaries',
    kind: 'fixed',
    color: '#3B82F6',
    sortOrder: 3,
  },
  commissions: {
    name: 'Commissions',
    kind: 'variable',
    color: '#8B5CF6',
    sortOrder: 60,
  },
};

/**
 * System-posted compensation expenses.
 *
 * Payroll finalisation and commission accrual must reach Operating Expenses
 * exactly once. Provenance (`sourceType`, `sourceId`) is unique, so a retried
 * finalisation is a no-op instead of a duplicate cost. Reversals post a NEW
 * negative row — a closed period is never edited in place.
 *
 * A manual expense in the same category is never touched: any manual/auto
 * overlap is surfaced by reconciliation W12, never silently merged.
 */
@Injectable()
export class CompensationExpenseService {
  private readonly logger = new Logger(CompensationExpenseService.name);

  constructor(private readonly prisma: PrismaService) {}

  async postCompensationExpense(
    input: PostCompensationExpenseInput,
    tx?: Prisma.TransactionClient | PrismaService,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const categoryId = await this.resolveCategory(input.categorySlug, db);

    try {
      await db.expense.create({
        data: {
          description: input.description,
          categoryId,
          amount: new Prisma.Decimal(round2(input.amount)),
          expenseDate: input.expenseDate,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          createdBy: 'system',
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Already posted for this source — finalisation/accrual is idempotent.
        return;
      }
      throw err;
    }
  }

  async reverseCompensationExpense(
    input: ReverseCompensationExpenseInput,
    tx?: Prisma.TransactionClient | PrismaService,
  ): Promise<void> {
    const db = tx ?? this.prisma;

    const original = await db.expense.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        },
      },
      select: { id: true, amount: true },
    });
    // Nothing was posted (e.g. payslip cancelled before any finalisation) —
    // never invent a negative expense.
    if (!original) return;

    const categoryId = await this.resolveCategory(input.categorySlug, db);
    try {
      await db.expense.create({
        data: {
          description: input.description,
          categoryId,
          amount: new Prisma.Decimal(round2(-Math.abs(Number(original.amount)))),
          expenseDate: input.expenseDate,
          sourceType: `${input.sourceType}_reversal`,
          sourceId: input.sourceId,
          createdBy: 'system',
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) return;
      throw err;
    }
  }

  private async resolveCategory(
    slug: CompensationCategorySlug,
    db: Prisma.TransactionClient | PrismaService,
  ): Promise<string> {
    const existing = await db.expenseCategory.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (existing) return existing.id;

    const fallback = CATEGORY_FALLBACKS[slug];
    try {
      const created = await db.expenseCategory.create({
        data: {
          name: fallback.name,
          slug,
          description:
            slug === 'salaries'
              ? 'Salaries and payroll compensation'
              : 'Sales and performance commissions',
          color: fallback.color,
          expenseKind: fallback.kind,
          isActive: true,
          sortOrder: fallback.sortOrder,
        },
        select: { id: true },
      });
      return created.id;
    } catch (err) {
      if (isUniqueViolation(err)) {
        const raced = await db.expenseCategory.findUnique({
          where: { slug },
          select: { id: true },
        });
        if (raced) return raced.id;
      }
      this.logger.error(`Failed to resolve expense category "${slug}"`, err);
      throw err;
    }
  }
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}
