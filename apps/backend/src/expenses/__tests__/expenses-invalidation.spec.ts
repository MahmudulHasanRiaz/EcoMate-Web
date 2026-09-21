/**
 * P2 §6 — analytics freshness: expense mutations drop `analytics:*`.
 *
 * Expenses feed Operating Expenses and the R4 tie-out; the @Optional cache
 * keeps unit tests provider-free (no-op path) while production resolves the
 * global CacheService.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ExpensesService } from '../expenses.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';

describe('ExpensesService analytics invalidation', () => {
  let service: ExpensesService;
  const mockPrisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(mockPrisma)),
    expenseCategory: { findUnique: jest.fn() },
    expense: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    account: { findUnique: jest.fn() },
    journalEntry: { update: jest.fn() },
    journalEntryLine: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const mockCache: any = {
    invalidateByPrefix: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();
    service = module.get(ExpensesService);
  });

  it('drops analytics:* after update', async () => {
    const existing: any = {
      id: 'e1',
      amount: 100,
      taxAmount: 0,
      categoryId: 'c1',
      paymentAccountId: null,
      expenseDate: new Date('2026-09-10T00:00:00Z'),
      journalEntryId: null,
    };
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue(existing);
    mockPrisma.expense.update.mockResolvedValue(existing);

    await service.update('e1', { amount: 120 } as any);

    expect(mockCache.invalidateByPrefix).toHaveBeenCalledWith('analytics:');
  });

  it('drops analytics:* after remove', async () => {
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: 'e1', journalEntryId: null } as any);
    mockPrisma.expense.delete.mockResolvedValue({ id: 'e1' });

    await service.remove('e1');

    expect(mockCache.invalidateByPrefix).toHaveBeenCalledWith('analytics:');
  });
});
