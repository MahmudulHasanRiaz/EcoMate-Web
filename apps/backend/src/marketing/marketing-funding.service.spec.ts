import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { MarketingFundingService } from './marketing-funding.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { MARKETING_EXPENSE_ACCOUNT_CODE, MARKETING_EXPENSE_ACCOUNT_NAME } from './marketing.constants';

describe('MarketingFundingService', () => {
  let service: MarketingFundingService;
  let prisma: PrismaService;
  let accounting: AccountingService;

  const mockAdAccount = { id: 'acct-1', name: 'Meta (prod)', currency: 'USD' };
  const mockEntry = (overrides: Partial<any> = {}) => ({
    id: 'fund-1',
    platform: 'facebook',
    adAccountId: 'acct-1',
    fundingSource: 'BANK',
    fundingDate: new Date('2026-01-15'),
    currency: 'USD',
    currencyAmount: 100,
    baseCurrency: 'BDT',
    baseAmount: 12000,
    effectiveRate: 120,
    reference: null,
    remarks: null,
    journalEntryId: null,
    status: 'draft',
    postedAt: null,
    createdBy: 'user-1',
    adAccount: mockAdAccount,
    ledger: [
      { id: 'ledger-1', remainingAmount: 100, receivedAmount: 100, consumedAmount: 0, status: 'confirmed' },
    ],
    ...overrides,
  });

  const mockPrisma = () => ({
    adAccount: { findUnique: jest.fn() },
    marketingFundingEntry: {
      findUnique: jest.fn(),
      update: jest.fn(({ data }) => Promise.resolve(data)),
      delete: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    marketingFundingLedger: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      groupBy: jest.fn(),
      updateMany: jest.fn(),
    },
    financialPeriod: { findFirst: jest.fn() },
    account: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    marketingAuditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingFundingService,
        { provide: PrismaService, useValue: mockPrisma() },
        { provide: AccountingService, useValue: { createEntry: jest.fn() } },
      ],
    }).compile();
    service = module.get(MarketingFundingService);
    prisma = module.get(PrismaService);
    accounting = module.get(AccountingService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('addFunding', () => {
    it('creates draft entry + confirmed ledger row inside one transaction', async () => {
      (prisma.adAccount.findUnique as jest.Mock).mockResolvedValue(mockAdAccount);
      const tx = {
        marketingFundingEntry: { create: jest.fn().mockResolvedValue({ id: 'fund-1' }) },
        marketingFundingLedger: { create: jest.fn().mockResolvedValue({}) },
      };
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));

      const res = await service.addFunding({
        adAccountId: 'acct-1',
        fundingSource: 'BANK',
        fundingDate: '2026-01-15',
        currency: 'USD',
        currencyAmount: 100,
        baseCurrency: 'BDT',
        baseAmount: 12000,
        effectiveRate: 120,
      });

      expect(res.id).toBe('fund-1');
      const entryData = tx.marketingFundingEntry.create.mock.calls[0][0].data;
      expect(entryData.status).toBe('draft');
      expect(entryData.baseAmount).toBe(12000);
      expect(entryData.effectiveRate).toBe(120);
      const ledgerData = tx.marketingFundingLedger.create.mock.calls[0][0].data;
      expect(ledgerData.receivedAmount).toBe(100);
      expect(ledgerData.remainingAmount).toBe(100);
      expect(ledgerData.status).toBe('confirmed');
    });

    it('derives baseAmount from effectiveRate when omitted', async () => {
      (prisma.adAccount.findUnique as jest.Mock).mockResolvedValue(mockAdAccount);
      const tx = {
        marketingFundingEntry: { create: jest.fn().mockResolvedValue({ id: 'fund-x' }) },
        marketingFundingLedger: { create: jest.fn().mockResolvedValue({}) },
      };
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));
      await service.addFunding({
        adAccountId: 'acct-1',
        fundingSource: 'BANK',
        fundingDate: '2026-01-15',
        currency: 'USD',
        currencyAmount: 100,
        effectiveRate: 125,
      } as any);
      expect(tx.marketingFundingEntry.create.mock.calls[0][0].data.baseAmount).toBe(12500);
    });

    it('rejects when baseAmount cannot be derived', async () => {
      (prisma.adAccount.findUnique as jest.Mock).mockResolvedValue(mockAdAccount);
      await expect(
        service.addFunding({
          adAccountId: 'acct-1',
          fundingSource: 'BANK',
          fundingDate: '2026-01-15',
          currencyAmount: 100,
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound for unknown ad account', async () => {
      (prisma.adAccount.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.addFunding({ adAccountId: 'nope', fundingDate: '2026-01-15', currencyAmount: 10 } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('confirm', () => {
    it('confirms only draft entries', async () => {
      (prisma.marketingFundingEntry.findUnique as jest.Mock).mockResolvedValue(mockEntry());
      (prisma.marketingFundingEntry.update as jest.Mock).mockResolvedValue({ status: 'confirmed' });
      const res = await service.confirm('fund-1');
      expect(prisma.marketingFundingEntry.update).toHaveBeenCalledWith({
        where: { id: 'fund-1' },
        data: { status: 'confirmed' },
      });
      expect(res.status).toBe('confirmed');
    });

    it('rejects confirming a non-draft entry', async () => {
      (prisma.marketingFundingEntry.findUnique as jest.Mock).mockResolvedValue(mockEntry({ status: 'posted', journalEntryId: 'je-1' }));
      await expect(service.confirm('fund-1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('post', () => {
    it('posts confirmed funding to accounting on an open period (Dr expense / Cr funding)', async () => {
      (prisma.marketingFundingEntry.findUnique as jest.Mock).mockResolvedValue(
        mockEntry({ status: 'confirmed' }),
      );
      (prisma.financialPeriod.findFirst as jest.Mock).mockResolvedValue({
        id: 'period-1',
        isClosed: false,
      });
      (prisma.account.findFirst as jest.Mock).mockResolvedValue({
        id: 'acct-expense',
        code: MARKETING_EXPENSE_ACCOUNT_CODE,
      });
      (prisma.account.findUnique as jest.Mock).mockResolvedValue({
        id: 'acct-funding',
        name: 'Bank',
        isGroup: false,
      });
      (accounting.createEntry as jest.Mock).mockResolvedValue({
        id: 'je-1',
        entryNo: 'JE-0001',
      });
      (prisma.marketingFundingEntry.update as jest.Mock).mockResolvedValue({ ...mockEntry(), status: 'posted' });

      const res = await service.post('fund-1', { fundingAccountId: 'acct-funding' }, 'user-1');

      const entryArg = (accounting.createEntry as jest.Mock).mock.calls[0][0];
      expect(entryArg.referenceNo).toBe(`FUND-${'fund-1'.slice(0, 8)}`);
      expect(entryArg.lines).toHaveLength(2);
      expect(entryArg.lines[0]).toMatchObject({ accountId: 'acct-expense', debit: 12000 });
      expect(entryArg.lines[1]).toMatchObject({ accountId: 'acct-funding', credit: 12000 });
      expect(res.journalEntry.id).toBe('je-1');
      expect(prisma.marketingFundingEntry.update).toHaveBeenCalledWith({
        where: { id: 'fund-1' },
        data: expect.objectContaining({ status: 'posted', journalEntryId: 'je-1', postedAt: expect.any(Date) }),
      });
    });

    it('rejects posting a draft (must confirm first)', async () => {
      (prisma.marketingFundingEntry.findUnique as jest.Mock).mockResolvedValue(mockEntry());
      await expect(service.post('fund-1', { fundingAccountId: 'acct-funding' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects double posting', async () => {
      (prisma.marketingFundingEntry.findUnique as jest.Mock).mockResolvedValue(
        mockEntry({ status: 'posted', journalEntryId: 'je-1' }),
      );
      await expect(service.post('fund-1', { fundingAccountId: 'acct-funding' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects posting into a closed financial period (accounting integrity)', async () => {
      (prisma.marketingFundingEntry.findUnique as jest.Mock).mockResolvedValue(
        mockEntry({ status: 'confirmed' }),
      );
      (prisma.financialPeriod.findFirst as jest.Mock).mockResolvedValue({
        id: 'period-closed',
        isClosed: true,
      });
      await expect(service.post('fund-1', { fundingAccountId: 'acct-funding' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(accounting.createEntry).not.toHaveBeenCalled();
    });

    it('rejects group accounts as funding source', async () => {
      (prisma.marketingFundingEntry.findUnique as jest.Mock).mockResolvedValue(
        mockEntry({ status: 'confirmed' }),
      );
      (prisma.financialPeriod.findFirst as jest.Mock).mockResolvedValue({ id: 'period-1', isClosed: false });
      (prisma.account.findFirst as jest.Mock).mockResolvedValue({ id: 'acct-expense' });
      (prisma.account.findUnique as jest.Mock).mockResolvedValue({
        id: 'acct-group',
        name: 'Assets (group)',
        isGroup: true,
      });
      await expect(service.post('fund-1', { fundingAccountId: 'acct-group' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(accounting.createEntry).not.toHaveBeenCalled();
    });
  });

  describe('archive / remove', () => {
    it('archives only fully-consumed entries', async () => {
      (prisma.marketingFundingEntry.findUnique as jest.Mock).mockResolvedValue(
        mockEntry({ status: 'fully_consumed', ledger: [{ remainingAmount: 0 }] }),
      );
      (prisma.marketingFundingEntry.update as jest.Mock).mockResolvedValue({ status: 'archived' });
      const res = await service.archive('fund-1');
      expect(res.status).toBe('archived');
    });

    it('rejects archiving with unconsumed funds', async () => {
      (prisma.marketingFundingEntry.findUnique as jest.Mock).mockResolvedValue(
        mockEntry({ status: 'fully_consumed', ledger: [{ remainingAmount: 50 }] }),
      );
      await expect(service.archive('fund-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('deletes only draft entries (with their ledger rows)', async () => {
      (prisma.marketingFundingEntry.findUnique as jest.Mock).mockResolvedValue(mockEntry({ status: 'draft' }));
      const res = await service.remove('fund-1');
      expect(prisma.marketingFundingLedger.deleteMany).toHaveBeenCalledWith({
        where: { fundingEntryId: 'fund-1' },
      });
      expect(prisma.marketingFundingEntry.delete).toHaveBeenCalledWith({ where: { id: 'fund-1' } });
      expect(res.success).toBe(true);
    });

    it('rejects deleting a confirmed/posted entry', async () => {
      (prisma.marketingFundingEntry.findUnique as jest.Mock).mockResolvedValue(
        mockEntry({ status: 'confirmed' }),
      );
      await expect(service.remove('fund-1')).rejects.toBeInstanceOf(ConflictException);
    });
  });
});