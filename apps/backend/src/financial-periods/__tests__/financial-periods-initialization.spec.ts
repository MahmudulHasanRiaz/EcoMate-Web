import { Test, TestingModule } from '@nestjs/testing';
import { FinancialPeriodsService } from '../financial-periods.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingService } from '../../accounting/accounting.service';

/**
 * Stateful in-memory double of the slice of PrismaClient these methods touch.
 * `findFirst` implements the single where-shape used by both the overlap check
 * (`create`) and the covering lookup (`ensurePeriodCovering`):
 *   { startDate: { lte }, endDate: { gte } }
 * A second `create` for the same range therefore reproduces the DB's unique /
 * overlap conflict exactly like production.
 */
function buildPrismaDouble(seed: any[] = []) {
  const store: any[] = [...seed];

  const findFirst = jest.fn(async ({ where }: any) => {
    const matches = store.filter(
      (p) =>
        p.startDate.getTime() <= where.startDate.lte.getTime() &&
        p.endDate.getTime() >= where.endDate.gte.getTime(),
    );
    matches.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
    return matches[0] ?? null;
  });

  const create = jest.fn(async ({ data }: any) => {
    const period = {
      id: `fp-${store.length + 1}`,
      isClosed: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    };
    store.push(period);
    return period;
  });

  const update = jest.fn(async ({ where, data }: any) => {
    const period = store.find((p) => p.id === where.id);
    if (!period) throw new Error('not found');
    Object.assign(period, data, { updatedAt: new Date() });
    return period;
  });

  const prisma: any = {
    financialPeriod: { findFirst, create, update },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };

  return { prisma, store };
}

describe('FinancialPeriodsService initialization', () => {
  const makeService = async (prisma: any) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancialPeriodsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    return module.get<FinancialPeriodsService>(FinancialPeriodsService);
  };

  describe('ensureYearPeriods', () => {
    it('creates the twelve UTC monthly periods with exact boundaries and names', async () => {
      const { prisma, store } = buildPrismaDouble();
      const service = await makeService(prisma);

      const result = await service.ensureYearPeriods(2026);

      expect(result).toEqual({ created: 12, existing: 0 });
      expect(store).toHaveLength(12);

      const october = store.find((p) => p.name === 'October 2026');
      expect(october).toBeDefined();
      expect(october.startDate.toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(october.endDate.toISOString()).toBe('2026-10-31T23:59:59.999Z');

      // December exercises the month-end clamp (31st), January the first month.
      const january = store.find((p) => p.name === 'January 2026');
      expect(january.startDate.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(january.endDate.toISOString()).toBe('2026-01-31T23:59:59.999Z');
      expect(store.some((p) => p.name === 'December 2026')).toBe(true);
    });

    it('is idempotent: a second call reports existing and performs no extra writes', async () => {
      const { prisma, store } = buildPrismaDouble();
      const service = await makeService(prisma);

      await service.ensureYearPeriods(2026);
      const second = await service.ensureYearPeriods(2026);

      expect(second).toEqual({ created: 0, existing: 12 });
      expect(store).toHaveLength(12);
      expect(prisma.financialPeriod.create).toHaveBeenCalledTimes(12);
    });

    it('leaves an existing CLOSED period exactly as-is (never re-opens or rewrites)', async () => {
      const closedOctober = {
        id: 'fp-closed-oct',
        name: 'October 2026',
        startDate: new Date('2026-10-01T00:00:00.000Z'),
        endDate: new Date('2026-10-31T23:59:59.999Z'),
        isClosed: true,
        createdAt: new Date('2026-09-30T00:00:00.000Z'),
        updatedAt: new Date('2026-09-30T00:00:00.000Z'),
      };
      const { prisma, store } = buildPrismaDouble([closedOctober]);
      const service = await makeService(prisma);

      const result = await service.ensureYearPeriods(2026);

      // The closed October month already exists; the other eleven are created.
      expect(result).toEqual({ created: 11, existing: 1 });
      expect(store).toHaveLength(12);

      const stored = store.find((p) => p.id === 'fp-closed-oct');
      expect(stored).toBe(closedOctober);
      expect(stored.isClosed).toBe(true);
      expect(stored.name).toBe('October 2026');
      expect(prisma.financialPeriod.update).not.toHaveBeenCalled();
    });

    it('swallows a P2002 unique violation on create and counts it as existing', async () => {
      const { prisma } = buildPrismaDouble();
      prisma.financialPeriod.create.mockImplementation(async () => {
        const err: any = new Error('Unique constraint failed');
        err.code = 'P2002';
        throw err;
      });
      const service = await makeService(prisma);

      const result = await service.ensureYearPeriods(2026);

      expect(result).toEqual({ created: 0, existing: 12 });
      expect(prisma.financialPeriod.create).toHaveBeenCalledTimes(12);
    });
  });

  describe('ensurePeriodCovering', () => {
    it('returns an existing covering period and writes nothing', async () => {
      const july = {
        id: 'fp-july',
        name: 'July 2026',
        startDate: new Date('2026-07-01T00:00:00.000Z'),
        endDate: new Date('2026-07-31T23:59:59.999Z'),
        isClosed: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { prisma, store } = buildPrismaDouble([july]);
      const service = await makeService(prisma);

      const result = await service.ensurePeriodCovering(
        new Date('2026-07-15T12:00:00.000Z'),
      );

      expect(result).toBe(july);
      expect(store).toHaveLength(1);
      expect(prisma.financialPeriod.create).not.toHaveBeenCalled();
      expect(prisma.financialPeriod.update).not.toHaveBeenCalled();
    });

    it('returns a covering period even when it is closed (caller decides)', async () => {
      const closedJuly = {
        id: 'fp-july-closed',
        name: 'July 2026',
        startDate: new Date('2026-07-01T00:00:00.000Z'),
        endDate: new Date('2026-07-31T23:59:59.999Z'),
        isClosed: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { prisma } = buildPrismaDouble([closedJuly]);
      const service = await makeService(prisma);

      const result = await service.ensurePeriodCovering(
        new Date('2026-07-20T00:00:00.000Z'),
      );

      expect(result).toBe(closedJuly);
      expect(prisma.financialPeriod.create).not.toHaveBeenCalled();
    });

    it('creates the missing month and the created period covers the passed date', async () => {
      const { prisma, store } = buildPrismaDouble();
      const service = await makeService(prisma);

      const date = new Date('2026-10-15T12:34:56.789Z');
      const result = await service.ensurePeriodCovering(date);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('October 2026');
      expect(result!.startDate.toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(result!.endDate.toISOString()).toBe('2026-10-31T23:59:59.999Z');
      expect(result!.startDate.getTime()).toBeLessThanOrEqual(date.getTime());
      expect(result!.endDate.getTime()).toBeGreaterThanOrEqual(date.getTime());
      expect(store).toHaveLength(1);
      expect(prisma.financialPeriod.create).toHaveBeenCalledTimes(1);
    });

    it('re-queries and returns the winner when the create races into a conflict', async () => {
      const { prisma, store } = buildPrismaDouble();
      let winner: any;
      // The initial covering lookup misses (empty store), then a concurrent
      // creator writes the row before our own insert loses the unique race;
      // the re-query must resolve that winner.
      prisma.financialPeriod.create.mockImplementation(async ({ data }: any) => {
        winner = {
          id: 'fp-oct',
          isClosed: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        store.push(winner);
        const err: any = new Error('Unique constraint failed');
        err.code = 'P2002';
        throw err;
      });
      const service = await makeService(prisma);

      const result = await service.ensurePeriodCovering(
        new Date('2026-10-05T00:00:00.000Z'),
      );

      expect(result).toBe(winner);
      expect(result!.name).toBe('October 2026');
    });

    it('returns null instead of throwing when nothing can be resolved', async () => {
      const { prisma } = buildPrismaDouble();
      prisma.financialPeriod.findFirst.mockResolvedValue(null);
      prisma.financialPeriod.create.mockImplementation(async () => {
        throw new Error('database is on fire');
      });
      const service = await makeService(prisma);

      await expect(
        service.ensurePeriodCovering(new Date('2026-10-05T00:00:00.000Z')),
      ).resolves.toBeNull();
    });
  });

  describe('AccountingService.profitAndLoss', () => {
    it('returns an all-zero report (not an error) for a period with zero journals', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AccountingService,
          {
            provide: PrismaService,
            useValue: {
              $queryRaw: jest.fn().mockResolvedValue([]),
              $queryRawUnsafe: jest.fn().mockResolvedValue([]),
            },
          },
        ],
      }).compile();
      const service = module.get<AccountingService>(AccountingService);

      const result = await service.profitAndLoss('fp-with-no-journals');

      expect(result).toEqual({
        incomeAccounts: [],
        expenseAccounts: [],
        totalIncome: 0,
        totalExpense: 0,
        netProfit: 0,
      });
    });
  });
});
