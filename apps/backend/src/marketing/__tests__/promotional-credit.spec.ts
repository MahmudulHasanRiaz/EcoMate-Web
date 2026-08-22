import { Test, TestingModule } from '@nestjs/testing';
import { MarketingConsumptionService } from '../marketing-consumption.service';
import { MarketingFundingService } from '../marketing-funding.service';
import { MarketingPaymentService } from '../marketing-payment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingService } from '../../accounting/accounting.service';

describe('Promotional Credit Accounting', () => {
  let consumptionService: MarketingConsumptionService;
  let fundingService: MarketingFundingService;
  let paymentService: MarketingPaymentService;
  let prisma: PrismaService;
  let accounting: AccountingService;

  const mockAdAccountId = 'acct-promo-test';
  const mockCampaignId = '00000000-0000-0000-0000-000000000002';

  const mockPrisma = () => ({
    adAccount: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    marketingCampaign: {
      findUnique: jest.fn().mockResolvedValue({ id: mockCampaignId, adAccountId: mockAdAccountId }),
      findMany: jest.fn().mockResolvedValue([{ id: mockCampaignId, adAccountId: mockAdAccountId }]),
    },
    marketingFundingEntry: {
      create: jest.fn().mockImplementation((d) => Promise.resolve({ id: `entry-${Date.now()}`, ...d.data })),
      findUnique: jest.fn(),
      update: jest.fn().mockImplementation((d) => Promise.resolve({ id: d.where.id, ...d.data })),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    marketingFundingLedger: {
      create: jest.fn().mockImplementation((d) => Promise.resolve({ id: `ledger-${Date.now()}`, ...d.data })),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn().mockImplementation((d) => Promise.resolve({ id: d.where.id, ...d.data })),
      aggregate: jest.fn().mockResolvedValue({ _sum: { receivedAmount: 0, remainingAmount: 0, consumedAmount: 0 } }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    marketingConsumption: {
      create: jest.fn().mockImplementation((d) => Promise.resolve({ id: `cons-${Date.now()}`, ...d.data })),
    },
    marketingPayment: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((d) => Promise.resolve({ id: `pay-${Date.now()}`, ...d.data })),
      update: jest.fn().mockImplementation((d) => Promise.resolve({ id: d.where.id, ...d.data })),
      count: jest.fn().mockResolvedValue(0),
    },
    financialPeriod: {
      findFirst: jest.fn().mockResolvedValue({ id: 'period-1', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), isClosed: false }),
    },
    marketingAuditLog: { create: jest.fn().mockResolvedValue({}) },
    account: {
      findFirst: jest.fn().mockResolvedValue({ id: 'acct-expense', code: 'marketing-expense', name: 'Marketing Expenses' }),
      findUnique: jest.fn().mockResolvedValue({ id: 'acct-funding', name: 'Business Visa', isGroup: false }),
      create: jest.fn(),
    },
    journalEntryLine: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn().mockImplementation(async (fn: any) => {
      const ledgerRows: Record<string, any> = {
        'ledger-promo-1': { id: 'ledger-promo-1', remainingAmount: 50, consumedAmount: 0, effectiveRate: 132, fundingType: 'promotional' },
        'ledger-paid-1': { id: 'ledger-paid-1', remainingAmount: 100, consumedAmount: 0, effectiveRate: 132, fundingType: 'paid' },
      };
      const tx = {
        marketingFundingEntry: {
          create: jest.fn().mockImplementation((d) => Promise.resolve({ id: `entry-${Date.now()}`, ...d.data })),
          update: jest.fn().mockImplementation((d) => Promise.resolve({ id: d.where.id, ...d.data })),
        },
        marketingFundingLedger: {
          create: jest.fn().mockImplementation((d) => Promise.resolve({ id: `ledger-${Date.now()}`, ...d.data })),
          findUnique: jest.fn().mockImplementation((d: any) => {
            return Promise.resolve(ledgerRows[d.where.id] ?? null);
          }),
          update: jest.fn().mockImplementation((d) => Promise.resolve({ id: d.where.id, ...d.data })),
        },
        marketingConsumption: {
          create: jest.fn().mockImplementation((d) => Promise.resolve({ id: `cons-${Date.now()}`, ...d.data })),
        },
      };
      return fn(tx);
    }),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingConsumptionService,
        MarketingFundingService,
        MarketingPaymentService,
        { provide: PrismaService, useValue: mockPrisma() },
        { provide: AccountingService, useValue: { createEntry: jest.fn().mockResolvedValue({ id: 'journal-1', entryNo: 'JE-001' }) } },
      ],
    }).compile();

    consumptionService = module.get(MarketingConsumptionService);
    fundingService = module.get(MarketingFundingService);
    paymentService = module.get(MarketingPaymentService);
    prisma = module.get(PrismaService);
    accounting = module.get(AccountingService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('Promotional credit — no cash outflow', () => {
    it('addFunding with promotional type creates entry with fundingType=promotional', async () => {
      (prisma.adAccount.findUnique as jest.Mock).mockResolvedValue({
        id: mockAdAccountId,
        currency: 'USD',
        connection: { platform: { slug: 'facebook' } },
      });

      const entry = await fundingService.addFunding({
        adAccountId: mockAdAccountId,
        fundingType: 'promotional',
        fundingSource: 'PLATFORM_CREDIT',
        fundingDate: '2026-08-01',
        currencyAmount: 100,
        effectiveRate: 132,
      });

      expect(entry.fundingType).toBe('promotional');
    });

    it('promotional funding post() does NOT create a journal entry', async () => {
      (prisma.marketingFundingEntry.findUnique as jest.Mock).mockResolvedValue({
        id: 'entry-promo-1',
        status: 'confirmed',
        fundingType: 'promotional',
        fundingDate: new Date('2026-08-01'),
        baseAmount: 13200,
        journalEntryId: null,
        adAccount: { name: 'Test Account' },
      });

      const result = await fundingService.post('entry-promo-1', { fundingAccountId: 'acct-1' });

      expect(accounting.createEntry).not.toHaveBeenCalled();
      expect(result.journalEntry).toBeNull();
    });

    it('promotional consumption does NOT create a journal entry', async () => {
      const ledgerRows = [{
        id: 'ledger-promo-1',
        adAccountId: mockAdAccountId,
        fundingType: 'promotional',
        remainingAmount: 100,
        consumedAmount: 0,
        effectiveRate: 132,
        status: 'confirmed',
        createdAt: new Date(),
      }];

      (prisma.marketingFundingLedger.findMany as jest.Mock).mockResolvedValue(ledgerRows);
      (prisma.marketingFundingLedger.findUnique as jest.Mock).mockResolvedValue({ ...ledgerRows[0], remainingAmount: 100 });

      const result = await consumptionService.consume(mockCampaignId, 40, 'spend_sync', new Date('2026-08-01'));

      // Journal should NOT be called for promotional consumption
      expect(accounting.createEntry).not.toHaveBeenCalled();
      expect(result.consumedRows).toBe(1);
      expect(result.shortfall).toBe(0);
    });
  });

  describe('Paid credit — proper cash flow', () => {
    it('paid funding post() creates journal entry', async () => {
      (prisma.marketingFundingEntry.findUnique as jest.Mock).mockResolvedValue({
        id: 'entry-paid-1',
        status: 'confirmed',
        fundingType: 'paid',
        fundingDate: new Date('2026-08-01'),
        baseAmount: 13200,
        journalEntryId: null,
        adAccount: { name: 'Test Account' },
        reference: 'REF-001',
      });
      (prisma.account.findUnique as jest.Mock).mockResolvedValue({ id: 'acct-funding', name: 'Business Visa', isGroup: false });

      const result = await fundingService.post('entry-paid-1', { fundingAccountId: 'acct-funding' });

      expect(accounting.createEntry).toHaveBeenCalled();
      expect(result.journalEntry).toBeDefined();
    });

    it('paid consumption creates journal entry', async () => {
      const ledgerRows = [{
        id: 'ledger-paid-1',
        adAccountId: mockAdAccountId,
        fundingType: 'paid',
        remainingAmount: 100,
        consumedAmount: 0,
        effectiveRate: 132,
        status: 'confirmed',
        createdAt: new Date(),
      }];

      (prisma.marketingFundingLedger.findMany as jest.Mock).mockResolvedValue(ledgerRows);
      (prisma.marketingFundingLedger.findUnique as jest.Mock).mockResolvedValue({ ...ledgerRows[0], remainingAmount: 100 });

      await consumptionService.consume(mockCampaignId, 40, 'spend_sync', new Date('2026-08-01'));

      expect(accounting.createEntry).toHaveBeenCalled();
    });
  });

  describe('Mixed credit — FIFO promotional first', () => {
    it('consumes promotional credit before paid credit and only journals paid consumption', async () => {
      // Simplified: test that journal is called only for paid rows
      const ledgerRows = [
        {
          id: 'ledger-promo-1',
          adAccountId: mockAdAccountId,
          fundingType: 'promotional',
          remainingAmount: 50,
          consumedAmount: 0,
          effectiveRate: 132,
          status: 'confirmed',
          createdAt: new Date(),
        },
        {
          id: 'ledger-paid-1',
          adAccountId: mockAdAccountId,
          fundingType: 'paid',
          remainingAmount: 100,
          consumedAmount: 0,
          effectiveRate: 132,
          status: 'confirmed',
          createdAt: new Date(),
        },
      ];

      (prisma.marketingFundingLedger.findMany as jest.Mock).mockResolvedValue(ledgerRows);

      let journalCallCount = 0;
      (accounting.createEntry as jest.Mock).mockImplementation(() => {
        journalCallCount++;
        return Promise.resolve({ id: `journal-${journalCallCount}`, entryNo: `JE-${journalCallCount}` });
      });

      // Consume 50 from promotional (all of it)
      (prisma.marketingFundingLedger.findUnique as jest.Mock)
        .mockResolvedValueOnce({ ...ledgerRows[0], remainingAmount: 50 });

      const result1 = await consumptionService.consume(mockCampaignId, 50, 'spend_sync', new Date('2026-08-01'));
      expect(result1.consumedRows).toBe(1);
      // No journal for promotional
      expect(accounting.createEntry).not.toHaveBeenCalled();

      // Now consume 30 more — this must come from paid
      (prisma.marketingFundingLedger.findMany as jest.Mock).mockResolvedValue([ledgerRows[1]]);
      (prisma.marketingFundingLedger.findUnique as jest.Mock)
        .mockResolvedValueOnce({ ...ledgerRows[1], remainingAmount: 100 });

      const result2 = await consumptionService.consume(mockCampaignId, 30, 'spend_sync', new Date('2026-08-01'));
      expect(result2.consumedRows).toBe(1);
      // Journal called once for paid consumption
      expect(accounting.createEntry).toHaveBeenCalledTimes(1);
      const journalCall = (accounting.createEntry as jest.Mock).mock.calls[0][0];
      expect(journalCall.lines[0].debit).toBe(3960); // 30 * 132
    });
  });

  describe('Credit/due position — paid vs promotional breakdown', () => {
    it('returns separate paidCredit and promotionalCredit', async () => {
      (prisma.adAccount.findMany as jest.Mock).mockResolvedValue([{
        id: mockAdAccountId,
        name: 'Test Ad Account',
        currency: 'USD',
        fundingLedger: [
          { fundingType: 'paid', receivedAmount: 100, consumedAmount: 40, effectiveRate: 132 },
          { fundingType: 'promotional', receivedAmount: 50, consumedAmount: 20, effectiveRate: 132 },
        ],
        payments: [
          { status: 'reconciled', actualCost: 5280 },
        ],
      }]);

      const result = await paymentService.creditDuePosition(mockAdAccountId);

      expect(result).toHaveLength(1);
      const pos = result[0];
      expect(pos.paidCredit).toBe(60); // 100 - 40
      expect(pos.promotionalCredit).toBe(30); // 50 - 20
      expect(pos.totalCredit).toBe(90); // 60 + 30
      expect(pos.paidConsumed).toBe(40);
      expect(pos.promoConsumed).toBe(20);
      // Due = 0 (no threshold journals → payable balance = 0)
      expect(pos.due).toBe(0);
    });

    it('shows due from payable balance when threshold consumption exists', async () => {
      (prisma.adAccount.findMany as jest.Mock).mockResolvedValue([{
        id: mockAdAccountId,
        name: 'Test Ad Account',
        currency: 'USD',
        fundingLedger: [
          { fundingType: 'paid', receivedAmount: 100, consumedAmount: 60, effectiveRate: 132 },
        ],
        payments: [],
      }]);
      // Simulate threshold journal credit of 2640 for this account's campaign
      (prisma.journalEntryLine.findMany as jest.Mock).mockResolvedValue([
        { credit: 2640, entry: { description: `Marketing threshold (unfunded) — campaign ${mockCampaignId}` } },
      ]);
      // No threshold payments yet
      (prisma.marketingPayment.findMany as jest.Mock).mockResolvedValue([]);

      const result = await paymentService.creditDuePosition(mockAdAccountId);
      const pos = result[0];
      // Due = threshold credit = 2640 (no payments yet)
      expect(pos.due).toBe(2640);
      expect(pos.paidCredit).toBe(40); // 100 - 60
      expect(pos.promotionalCredit).toBe(0);
    });

    it('promotional consumption does not increase due', async () => {
      (prisma.adAccount.findMany as jest.Mock).mockResolvedValue([{
        id: mockAdAccountId,
        name: 'Test Ad Account',
        currency: 'USD',
        fundingLedger: [
          { fundingType: 'paid', receivedAmount: 100, consumedAmount: 20, effectiveRate: 132 },
          { fundingType: 'promotional', receivedAmount: 50, consumedAmount: 50, effectiveRate: 132 },
        ],
        payments: [
          { status: 'reconciled', actualCost: 2640 },
        ],
      }]);
      // No threshold → no payable lines
      (prisma.journalEntryLine.findMany as jest.Mock).mockResolvedValue([]);

      const result = await paymentService.creditDuePosition(mockAdAccountId);
      const pos = result[0];
      // Due = 0 (prepaid covered all consumption)
      expect(pos.due).toBe(0);
      expect(pos.paidCredit).toBe(80); // 100 - 20
      expect(pos.promotionalCredit).toBe(0); // 50 - 50
    });
  });
});
