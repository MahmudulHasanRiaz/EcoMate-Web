/**
 * P2 cost-capture tests — ExpenseCategory.expenseKind (§2.9).
 *
 * fixed | variable | unclassified, default unclassified, never inferred.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ExpenseCategoriesService } from '../expense-categories.service';
import {
  CreateExpenseCategoryDto,
  UpdateExpenseCategoryDto,
} from '../dto/expense-category.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';

describe('ExpenseCategoryDto expenseKind', () => {
  it('accepts fixed / variable / unclassified', async () => {
    for (const expenseKind of ['fixed', 'variable', 'unclassified']) {
      const dto = plainToInstance(CreateExpenseCategoryDto, {
        name: 'Rent',
        slug: 'rent',
        expenseKind,
      });
      expect(await validate(dto)).toHaveLength(0);
    }
  });

  it('rejects invented kinds', async () => {
    const dto = plainToInstance(UpdateExpenseCategoryDto, {
      expenseKind: 'marketing-ish',
    });
    expect((await validate(dto)).length).toBeGreaterThanOrEqual(1);
  });
});

describe('ExpenseCategoriesService expenseKind', () => {
  let service: ExpenseCategoriesService;
  const mockPrisma: any = {
    expenseCategory: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    expense: { count: jest.fn() },
    account: { findUnique: jest.fn() },
  };
  const mockCache: any = {
    invalidateByPrefix: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseCategoriesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();
    service = module.get(ExpenseCategoriesService);
  });

  it('persists an explicit expenseKind on create', async () => {
    mockPrisma.expenseCategory.findUnique.mockResolvedValue(null);
    mockPrisma.expenseCategory.create.mockImplementation(async (args: any) => args.data);
    const created = await service.create({
      name: 'Rent',
      slug: 'rent',
      expenseKind: 'fixed',
    } as any);
    expect(mockPrisma.expenseCategory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ expenseKind: 'fixed' }),
      include: expect.anything(),
    });
    expect(created).toMatchObject({ expenseKind: 'fixed' });
  });

  it('persists expenseKind changes on update', async () => {
    mockPrisma.expenseCategory.findUnique.mockResolvedValue({
      id: 'c1',
      slug: 'rent',
    });
    mockPrisma.expenseCategory.update.mockImplementation(
      async (args: any) => args.data,
    );
    await service.update('c1', { expenseKind: 'variable' } as any);
    expect(mockPrisma.expenseCategory.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({ expenseKind: 'variable' }),
      include: expect.anything(),
    });
  });

  it('drops analytics:* after create (P2 §6)', async () => {
    mockPrisma.expenseCategory.findUnique.mockResolvedValue(null);
    mockPrisma.expenseCategory.create.mockImplementation(
      async (args: any) => args.data,
    );
    await service.create({ name: 'Rent', slug: 'rent' } as any);
    expect(mockCache.invalidateByPrefix).toHaveBeenCalledWith('analytics:');
  });
});
