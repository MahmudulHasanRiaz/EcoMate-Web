import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccountingService } from '../accounting.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AccountingService', () => {
  let service: AccountingService;
  let prisma: PrismaService;

  const openPeriod = {
    id: 'fp-open',
    name: 'July 2026',
    startDate: new Date('2026-07-01'),
    endDate: new Date('2026-07-31'),
    isClosed: false,
  };
  const closedPeriod = {
    id: 'fp-closed',
    name: 'June 2026',
    startDate: new Date('2026-06-01'),
    endDate: new Date('2026-06-30'),
    isClosed: true,
  };
  const otherPeriod = {
    id: 'fp-other',
    name: 'August 2026',
    startDate: new Date('2026-08-01'),
    endDate: new Date('2026-08-31'),
    isClosed: false,
  };

  const assetAccount = {
    id: 'acc-cash',
    code: '1-1000',
    name: 'Cash',
    type: 'asset',
    parentId: null,
    isActive: true,
    isGroup: false,
  };
  const incomeAccount = {
    id: 'acc-rev',
    code: '4-1000',
    name: 'Sales Revenue',
    type: 'income',
    parentId: null,
    isActive: true,
    isGroup: false,
  };
  const expenseAccount = {
    id: 'acc-exp',
    code: '5-1000',
    name: 'Rent Expense',
    type: 'expense',
    parentId: null,
    isActive: true,
    isGroup: false,
  };
  const equityAccount = {
    id: 'acc-eq',
    code: '3-1000',
    name: 'Retained Earnings',
    type: 'equity',
    parentId: null,
    isActive: true,
    isGroup: false,
  };
  const liabilityAccount = {
    id: 'acc-lib',
    code: '2-1000',
    name: 'Accounts Payable',
    type: 'liability',
    parentId: null,
    isActive: true,
    isGroup: false,
  };

  const mockEntry = {
    id: 'je-1',
    entryNo: 'JE-250701-0001',
    periodId: 'fp-open',
    entryDate: new Date('2026-07-15'),
    description: 'Test entry',
    totalDebit: 10000,
    totalCredit: 10000,
    isOpening: false,
    referenceNo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lines: [
      {
        id: 'jel-1',
        entryId: 'je-1',
        accountId: 'acc-cash',
        debit: 10000,
        credit: 0,
        description: null,
        account: assetAccount,
      },
      {
        id: 'jel-2',
        entryId: 'je-1',
        accountId: 'acc-rev',
        debit: 0,
        credit: 10000,
        description: null,
        account: incomeAccount,
      },
    ],
    period: openPeriod,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountingService,
        {
          provide: PrismaService,
          useValue: {
            journalEntry: {
              findMany: jest.fn().mockResolvedValue([mockEntry]),
              findUnique: jest.fn().mockResolvedValue(mockEntry),
              create: jest.fn().mockResolvedValue(mockEntry),
              delete: jest.fn().mockResolvedValue(mockEntry),
              count: jest.fn().mockResolvedValue(1),
            },
            journalEntryLine: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            account: {
              findMany: jest
                .fn()
                .mockResolvedValue([
                  assetAccount,
                  incomeAccount,
                  expenseAccount,
                  equityAccount,
                  liabilityAccount,
                ]),
              findUnique: jest
                .fn()
                .mockImplementation(async ({ where }: any) => {
                  const map: any = {
                    'acc-cash': assetAccount,
                    'acc-rev': incomeAccount,
                    'acc-exp': expenseAccount,
                    'acc-eq': equityAccount,
                    'acc-lib': liabilityAccount,
                  };
                  return map[where.id] || null;
                }),
            },
            financialPeriod: {
              findUnique: jest
                .fn()
                .mockImplementation(async ({ where }: any) => {
                  const map: any = {
                    'fp-open': openPeriod,
                    'fp-closed': closedPeriod,
                    'fp-other': otherPeriod,
                  };
                  return map[where.id] || null;
                }),
            },
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250701', seq: 1 }),
            },
            expense: {
              findUnique: jest.fn().mockResolvedValue(null),
            },
            $queryRaw: jest.fn().mockResolvedValue([]),
            $queryRawUnsafe: jest.fn().mockResolvedValue([]),
            $transaction: jest.fn().mockImplementation(async (cb) => {
              const tx = {
                orderCounter: {
                  upsert: jest
                    .fn()
                    .mockResolvedValue({ date: '250701', seq: 1 }),
                },
                journalEntry: {
                  create: jest.fn().mockResolvedValue(mockEntry),
                  delete: jest.fn().mockResolvedValue(mockEntry),
                },
                account: {
                  findMany: jest
                    .fn()
                    .mockResolvedValue([
                      assetAccount,
                      incomeAccount,
                      expenseAccount,
                      equityAccount,
                      liabilityAccount,
                    ]),
                },
              };
              return cb(tx);
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AccountingService>(AccountingService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createEntry', () => {
    it('should create a balanced journal entry', async () => {
      const result = await service.createEntry({
        periodId: 'fp-open',
        entryDate: '2026-07-15',
        description: 'Test entry',
        lines: [
          { accountId: 'acc-cash', debit: 10000, credit: 0 },
          { accountId: 'acc-rev', debit: 0, credit: 10000 },
        ],
      });
      expect(result).toEqual(mockEntry);
    });

    it('should throw if debit != credit', async () => {
      await expect(
        service.createEntry({
          periodId: 'fp-open',
          entryDate: '2026-07-15',
          description: 'Unbalanced',
          lines: [
            { accountId: 'acc-cash', debit: 10000, credit: 0 },
            { accountId: 'acc-rev', debit: 0, credit: 5000 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if no lines provided', async () => {
      await expect(
        service.createEntry({
          periodId: 'fp-open',
          entryDate: '2026-07-15',
          description: 'No lines',
          lines: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if period is closed', async () => {
      await expect(
        service.createEntry({
          periodId: 'fp-closed',
          entryDate: '2026-07-15',
          description: 'Closed',
          lines: [
            { accountId: 'acc-cash', debit: 10000, credit: 0 },
            { accountId: 'acc-rev', debit: 0, credit: 10000 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if account not found', async () => {
      jest.spyOn(prisma.account, 'findUnique').mockResolvedValue(null);
      await expect(
        service.createEntry({
          periodId: 'fp-open',
          entryDate: '2026-07-15',
          description: 'Bad account',
          lines: [
            { accountId: 'invalid', debit: 100, credit: 0 },
            { accountId: 'acc-rev', debit: 0, credit: 100 },
          ],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw if line has both debit and credit', async () => {
      await expect(
        service.createEntry({
          periodId: 'fp-open',
          entryDate: '2026-07-15',
          description: 'Both sides',
          lines: [{ accountId: 'acc-cash', debit: 100, credit: 50 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if line has neither debit nor credit', async () => {
      await expect(
        service.createEntry({
          periodId: 'fp-open',
          entryDate: '2026-07-15',
          description: 'Zero line',
          lines: [{ accountId: 'acc-cash', debit: 0, credit: 0 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getEntry', () => {
    it('should return entry with lines and accounts', async () => {
      const result = await service.getEntry('je-1');
      expect(result).toEqual(mockEntry);
    });

    it('should throw if not found', async () => {
      jest.spyOn(prisma.journalEntry, 'findUnique').mockResolvedValue(null);
      await expect(service.getEntry('invalid')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAllEntries', () => {
    it('should return paginated entries', async () => {
      const result = await service.findAllEntries(1, 10);
      expect(result.data).toHaveLength(1);
    });

    it('should filter by periodId', async () => {
      await service.findAllEntries(1, 10, 'fp-open');
      expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ periodId: 'fp-open' }),
        }),
      );
    });
  });

  describe('trialBalance', () => {
    it('should return trial balance grouped by account type', async () => {
      jest.spyOn(prisma, '$queryRawUnsafe').mockResolvedValue([
        {
          type: 'asset',
          account_id: 'acc-cash',
          account_code: '1-1000',
          account_name: 'Cash',
          total_debit: '100000',
          total_credit: '0',
        },
        {
          type: 'income',
          account_id: 'acc-rev',
          account_code: '4-1000',
          account_name: 'Sales Revenue',
          total_debit: '0',
          total_credit: '50000',
        },
        {
          type: 'expense',
          account_id: 'acc-exp',
          account_code: '5-1000',
          account_name: 'Rent Expense',
          total_debit: '20000',
          total_credit: '0',
        },
        {
          type: 'equity',
          account_id: 'acc-eq',
          account_code: '3-1000',
          account_name: 'Retained Earnings',
          total_debit: '0',
          total_credit: '30000',
        },
        {
          type: 'liability',
          account_id: 'acc-lib',
          account_code: '2-1000',
          account_name: 'Accounts Payable',
          total_debit: '0',
          total_credit: '40000',
        },
      ]);

      const result = await service.trialBalance('fp-open');
      expect(result.accounts).toHaveLength(5);
      expect(result.totalDebit).toBe(120000);
      expect(result.totalCredit).toBe(120000);
    });
  });

  describe('profitAndLoss', () => {
    it('should return P&L statement', async () => {
      jest.spyOn(prisma, '$queryRawUnsafe').mockResolvedValue([
        {
          type: 'income',
          account_id: 'acc-rev',
          account_code: '4-1000',
          account_name: 'Sales Revenue',
          balance: '50000',
        },
        {
          type: 'expense',
          account_id: 'acc-exp',
          account_code: '5-1000',
          account_name: 'Rent Expense',
          balance: '20000',
        },
      ]);

      const result = await service.profitAndLoss('fp-open');
      expect(result.totalIncome).toBe(50000);
      expect(result.totalExpense).toBe(20000);
      expect(result.netProfit).toBe(30000);
    });
  });

  describe('balanceSheet', () => {
    it('should return balance sheet', async () => {
      jest.spyOn(prisma, '$queryRawUnsafe').mockResolvedValue([
        {
          account_id: 'acc-cash',
          account_code: '1-1000',
          account_name: 'Cash',
          type: 'asset',
          balance: '100000',
        },
        {
          account_id: 'acc-lib',
          account_code: '2-1000',
          account_name: 'Accounts Payable',
          type: 'liability',
          balance: '40000',
        },
        {
          account_id: 'acc-eq',
          account_code: '3-1000',
          account_name: 'Retained Earnings',
          type: 'equity',
          balance: '60000',
        },
      ]);

      const result = await service.balanceSheet('fp-open');
      expect(result.totalAssets).toBe(100000);
      expect(result.totalLiabilities).toBe(40000);
      expect(result.totalEquity).toBe(60000);
    });
  });

  describe('accountLedger', () => {
    it('should return ledger entries for an account', async () => {
      jest.spyOn(prisma.journalEntryLine, 'findMany').mockResolvedValue([
        {
          id: 'jel-1',
          entryId: 'je-1',
          accountId: 'acc-cash',
          debit: 10000,
          credit: 0,
          description: null,
          entry: {
            entryNo: 'JE-250701-0001',
            entryDate: new Date('2026-07-15'),
            description: 'Test entry',
          },
        },
      ]);

      const result = await service.accountLedger('acc-cash', 'fp-open');
      expect(result.entries).toHaveLength(1);
      expect(result.account).toBeDefined();
    });
  });

  describe('deleteEntry', () => {
    it('should delete a journal entry', async () => {
      const result = await service.deleteEntry('je-1');
      expect(result).toEqual(mockEntry);
    });

    it('should throw if not found', async () => {
      jest.spyOn(prisma.journalEntry, 'findUnique').mockResolvedValue(null);
      await expect(service.deleteEntry('invalid')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
