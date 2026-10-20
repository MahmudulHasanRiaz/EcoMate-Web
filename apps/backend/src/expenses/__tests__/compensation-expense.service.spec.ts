import { Prisma } from '@prisma/client';
import { CompensationExpenseService } from '../compensation-expense.service';

function dupError() {
  return new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function makePrisma() {
  const rows = new Map<string, any>();
  const categories = new Map<string, any>([
    ['salaries', { id: 'cat-salaries', slug: 'salaries', name: 'Salaries' }],
    ['commissions', { id: 'cat-commissions', slug: 'commissions', name: 'Commissions' }],
  ]);

  const create = jest.fn(async ({ data }: any) => {
    const key = data.sourceType && data.sourceId ? `${data.sourceType}|${data.sourceId}` : null;
    if (key) {
      if (rows.has(key)) throw dupError();
      rows.set(key, data);
    }
    return { id: `exp-${rows.size}`, ...data };
  });

  const prisma: any = {
    rows,
    categories,
    expense: {
      create,
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where.sourceType_sourceId;
        return rows.get(`${k.sourceType}|${k.sourceId}`) ?? null;
      }),
    },
    expenseCategory: {
      findUnique: jest.fn(async ({ where }: any) => categories.get(where.slug) ?? null),
      create: jest.fn(async ({ data }: any) => {
        categories.set(data.slug, data);
        return data;
      }),
    },
  };
  return prisma;
}

describe('CompensationExpenseService', () => {
  let prisma: any;
  let service: CompensationExpenseService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new CompensationExpenseService(prisma);
  });

  it('posts one expense with provenance, category and rounded amount', async () => {
    await service.postCompensationExpense({
      sourceType: 'payroll',
      sourceId: 'ps-1',
      amount: 50000.005,
      expenseDate: new Date('2026-10-01T00:00:00Z'),
      description: 'Salary — 2026-10',
      categorySlug: 'salaries',
    });

    expect(prisma.expense.create).toHaveBeenCalledTimes(1);
    const data = prisma.expense.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      categoryId: 'cat-salaries',
      sourceType: 'payroll',
      sourceId: 'ps-1',
      description: 'Salary — 2026-10',
    });
    expect(Number(data.amount)).toBe(50000.01);
  });

  it('is idempotent: re-posting the same source never duplicates', async () => {
    const input = {
      sourceType: 'payroll' as const,
      sourceId: 'ps-1',
      amount: 100,
      expenseDate: new Date(),
      description: 'Salary',
      categorySlug: 'salaries' as const,
    };
    await service.postCompensationExpense(input);
    await expect(service.postCompensationExpense(input)).resolves.toBeUndefined();
    expect(prisma.expense.create).toHaveBeenCalledTimes(2);
    expect(prisma.rows.size).toBe(1);
  });

  it('self-heals a missing category', async () => {
    prisma.categories.delete('commissions');
    await service.postCompensationExpense({
      sourceType: 'commission',
      sourceId: 'o1:r1',
      amount: 25,
      expenseDate: new Date(),
      description: 'Commission',
      categorySlug: 'commissions',
    });

    expect(prisma.expenseCategory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slug: 'commissions', expenseKind: 'variable' }),
      }),
    );
    expect(prisma.expense.create.mock.calls[0][0].data.categoryId).toBe(
      prisma.categories.get('commissions').id,
    );
  });

  it('writes through the supplied transaction client', async () => {
    const tx = makePrisma();
    await service.postCompensationExpense(
      {
        sourceType: 'commission_v2',
        sourceId: 'ledger-1',
        amount: 10,
        expenseDate: new Date(),
        description: 'Commission v2',
        categorySlug: 'commissions',
      },
      tx,
    );
    expect(tx.expense.create).toHaveBeenCalledTimes(1);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  it('reverses with a separate negative row (prior periods untouched)', async () => {
    await service.postCompensationExpense({
      sourceType: 'payroll',
      sourceId: 'ps-1',
      amount: 1000,
      expenseDate: new Date('2026-10-01T00:00:00Z'),
      description: 'Salary',
      categorySlug: 'salaries',
    });

    await service.reverseCompensationExpense({
      sourceType: 'payroll',
      sourceId: 'ps-1',
      expenseDate: new Date('2026-10-05T00:00:00Z'),
      description: 'Salary reversal',
      categorySlug: 'salaries',
    });

    const reversal = prisma.expense.create.mock.calls[1][0].data;
    expect(reversal.sourceType).toBe('payroll_reversal');
    expect(Number(reversal.amount)).toBe(-1000);
    // Original row stays exactly as posted.
    const original = prisma.rows.get('payroll|ps-1');
    expect(Number(original.amount)).toBe(1000);
  });

  it('does not post a reversal when no original expense exists', async () => {
    await service.reverseCompensationExpense({
      sourceType: 'payroll',
      sourceId: 'missing',
      expenseDate: new Date(),
      description: 'Salary reversal',
      categorySlug: 'salaries',
    });
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  it('is idempotent on repeated reversal', async () => {
    await service.postCompensationExpense({
      sourceType: 'commission',
      sourceId: 'o1:r1',
      amount: 50,
      expenseDate: new Date(),
      description: 'Commission',
      categorySlug: 'commissions',
    });
    const reverse = () =>
      service.reverseCompensationExpense({
        sourceType: 'commission',
        sourceId: 'o1:r1',
        expenseDate: new Date(),
        description: 'Commission reversal',
        categorySlug: 'commissions',
      });

    await reverse();
    await expect(reverse()).resolves.toBeUndefined();
    expect(prisma.rows.size).toBe(2);
  });
});
