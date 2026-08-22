import { Test, TestingModule } from '@nestjs/testing';
import { MarketingConsumptionService } from '../marketing-consumption.service';
import { MarketingPaymentService } from '../marketing-payment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingService } from '../../accounting/accounting.service';
import {
  MARKETING_EXPENSE_ACCOUNT_CODE,
  MARKETING_PREPAID_ACCOUNT_CODE,
  MARKETING_PAYABLE_ACCOUNT_CODE,
} from '../marketing.constants';

describe('P0 Financial Model Corrections', () => {
  let consumptionService: MarketingConsumptionService;
  let paymentService: MarketingPaymentService;
  let prisma: PrismaService;
  let accounting: AccountingService;

  const mockAdAccountId = 'acct-p0-test';
  const mockCampaignId = '00000000-0000-0000-0000-000000000001';

  const makeLedger = (overrides: any) => ({
    id: `ledger-${Date.now()}-${Math.random()}`,
    adAccountId: mockAdAccountId,
    remainingAmount: 100,
    consumedAmount: 0,
    status: 'confirmed',
    effectiveRate: 132,
    fundingType: 'paid',
    createdAt: new Date('2026-01-01'),
    ...overrides,
  });

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
    },
    marketingFundingLedger: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn().mockImplementation((d) => Promise.resolve({ id: d.where.id, ...d.data })),
    },
    marketingConsumption: {
      create: jest.fn().mockImplementation((d) => Promise.resolve({ id: `cons-${Date.now()}`, ...d.data })),
      aggregate: jest.fn().mockResolvedValue({ _sum: { consumedAmount: 0, calculatedCost: 0 } }),
    },
    marketingPayment: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation((d) => Promise.resolve({ id: d.where.id, ...d.data })),
    },
    journalEntryLine: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    financialPeriod: {
      findFirst: jest.fn().mockResolvedValue({ id: 'period-1', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), isClosed: false }),
    },
    account: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingConsumptionService,
        MarketingPaymentService,
        { provide: PrismaService, useValue: mockPrisma() },
        { provide: AccountingService, useValue: { createEntry: jest.fn().mockResolvedValue({ id: 'journal-1', entryNo: 'JE-001' }) } },
      ],
    }).compile();

    consumptionService = module.get(MarketingConsumptionService);
    paymentService = module.get(MarketingPaymentService);
    prisma = module.get(PrismaService);
    accounting = module.get(AccountingService);

    (prisma.account.findFirst as jest.Mock).mockImplementation(({ where }: any) => {
      if (where.code === MARKETING_EXPENSE_ACCOUNT_CODE) {
        return Promise.resolve({ id: 'acct-expense', code: MARKETING_EXPENSE_ACCOUNT_CODE, name: 'Marketing Expenses', type: 'expense', isGroup: false });
      }
      if (where.code === MARKETING_PREPAID_ACCOUNT_CODE) {
        return Promise.resolve({ id: 'acct-prepaid', code: MARKETING_PREPAID_ACCOUNT_CODE, name: 'Marketing Prepaid Credit', type: 'asset', isGroup: false });
      }
      if (where.code === MARKETING_PAYABLE_ACCOUNT_CODE) {
        return Promise.resolve({ id: 'acct-payable', code: MARKETING_PAYABLE_ACCOUNT_CODE, name: 'Marketing Payable', type: 'liability', isGroup: false });
      }
      return Promise.resolve({ id: 'acct-other', code: 'other', name: 'Other', type: 'asset', isGroup: false });
    });
  });

  afterEach(() => jest.clearAllMocks());

  describe('Scenario A - Pure prepaid consumption', () => {
    it('consumes $40 from $100 prepaid; journal: Dr Expense / Cr Prepaid (no shortfall)', async () => {
      const ledgerRow = makeLedger({ id: 'ledger-a1', remainingAmount: 100, effectiveRate: 132, fundingType: 'paid' });

      (prisma.marketingFundingLedger.findMany as jest.Mock).mockResolvedValue([ledgerRow]);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
        const tx = {
          marketingFundingLedger: {
            findUnique: jest.fn().mockResolvedValue({ ...ledgerRow, remainingAmount: 100 }),
            update: jest.fn().mockImplementation((d: any) => Promise.resolve({ id: d.where.id, ...d.data })),
          },
          marketingConsumption: {
            create: jest.fn().mockImplementation((d: any) => Promise.resolve({ id: 'cons-a1', ...d.data })),
          },
        };
        return cb(tx);
      });

      const res = await consumptionService.consume(mockCampaignId, 40, 'spend_sync', new Date('2026-06-01'));
      expect(res.consumedRows).toBe(1);
      expect(res.shortfall).toBe(0);

      expect(accounting.createEntry).toHaveBeenCalledTimes(1);
      const journalCall = (accounting.createEntry as jest.Mock).mock.calls[0][0];
      expect(journalCall.lines[0].accountId).toBe('acct-expense');
      expect(journalCall.lines[0].debit).toBe(5280);
      expect(journalCall.lines[1].accountId).toBe('acct-prepaid');
      expect(journalCall.lines[1].credit).toBe(5280);
    });
  });

  describe('Scenario B - Pure threshold (no prepaid)', () => {
    it('shortfall of $60 when no ledger rows; no journal (no FX rate available)', async () => {
      (prisma.marketingFundingLedger.findMany as jest.Mock).mockResolvedValue([]);

      const res = await consumptionService.consume(mockCampaignId, 60, 'spend_sync', new Date('2026-06-01'));
      expect(res.consumedRows).toBe(0);
      expect(res.shortfall).toBe(60);

      // No prepaid rate available -> threshold journal skipped; BDT amount set at payment reconciliation
      expect(accounting.createEntry).not.toHaveBeenCalled();
    });
  });

  describe('Scenario C - Mixed prepaid + threshold', () => {
    it('$40 consumed from prepaid + $20 shortfall; 1 prepaid journal + 1 threshold journal', async () => {
      const ledgerRow = makeLedger({ id: 'ledger-c1', remainingAmount: 40, effectiveRate: 132, fundingType: 'paid' });

      (prisma.marketingFundingLedger.findMany as jest.Mock).mockResolvedValue([ledgerRow]);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
        const tx = {
          marketingFundingLedger: {
            findUnique: jest.fn().mockResolvedValue({ ...ledgerRow, remainingAmount: 40 }),
            update: jest.fn().mockImplementation((d: any) => Promise.resolve({ id: d.where.id, ...d.data })),
          },
          marketingConsumption: {
            create: jest.fn().mockImplementation((d: any) => Promise.resolve({ id: 'cons-c1', ...d.data })),
          },
        };
        return cb(tx);
      });

      const res = await consumptionService.consume(mockCampaignId, 60, 'spend_sync', new Date('2026-06-01'));
      expect(res.consumedRows).toBe(1);
      expect(res.shortfall).toBe(20);

      expect(accounting.createEntry).toHaveBeenCalledTimes(2);

      const prepaidJournal = (accounting.createEntry as jest.Mock).mock.calls[0][0];
      expect(prepaidJournal.lines[1].accountId).toBe('acct-prepaid');
      expect(prepaidJournal.lines[1].credit).toBe(5280);

      const thresholdJournal = (accounting.createEntry as jest.Mock).mock.calls[1][0];
      expect(thresholdJournal.referenceNo).toMatch(/^MTH-/);
      expect(thresholdJournal.lines[1].accountId).toBe('acct-payable');
      expect(thresholdJournal.lines[1].credit).toBe(2640);
    });
  });

  describe('Scenario D - Promotional credit consumption', () => {
    it('$30 consumed from promotional; NO journal entries', async () => {
      const promoRow = makeLedger({ id: 'ledger-d1', remainingAmount: 30, effectiveRate: 132, fundingType: 'promotional' });

      (prisma.marketingFundingLedger.findMany as jest.Mock).mockResolvedValue([promoRow]);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
        const tx = {
          marketingFundingLedger: {
            findUnique: jest.fn().mockResolvedValue({ ...promoRow, remainingAmount: 30 }),
            update: jest.fn().mockImplementation((d: any) => Promise.resolve({ id: d.where.id, ...d.data })),
          },
          marketingConsumption: {
            create: jest.fn().mockImplementation((d: any) => Promise.resolve({ id: 'cons-d1', ...d.data })),
          },
        };
        return cb(tx);
      });

      const res = await consumptionService.consume(mockCampaignId, 30, 'spend_sync', new Date('2026-06-01'));
      expect(res.consumedRows).toBe(1);
      expect(res.shortfall).toBe(0);

      expect(accounting.createEntry).not.toHaveBeenCalled();
    });
  });

  describe('Scenario E - Mixed promo + paid + threshold', () => {
    it('$15 promo + $40 paid + $20 shortfall; 1 paid journal + 1 threshold journal', async () => {
      const promoRow = makeLedger({ id: 'ledger-e1', remainingAmount: 15, effectiveRate: 132, fundingType: 'promotional', createdAt: new Date('2026-01-01') });
      const paidRow = makeLedger({ id: 'ledger-e2', remainingAmount: 40, effectiveRate: 132, fundingType: 'paid', createdAt: new Date('2026-01-02') });

      (prisma.marketingFundingLedger.findMany as jest.Mock).mockResolvedValue([promoRow, paidRow]);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
        const tx = {
          marketingFundingLedger: {
            findUnique: jest.fn().mockImplementation(({ where }: any) => {
              if (where.id === 'ledger-e1') return Promise.resolve({ ...promoRow, remainingAmount: 15 });
              return Promise.resolve({ ...paidRow, remainingAmount: 40 });
            }),
            update: jest.fn().mockImplementation((d: any) => Promise.resolve({ id: d.where.id, ...d.data })),
          },
          marketingConsumption: {
            create: jest.fn().mockImplementation((d: any) => Promise.resolve({ id: `cons-${Date.now()}`, ...d.data })),
          },
        };
        return cb(tx);
      });

      const res = await consumptionService.consume(mockCampaignId, 75, 'spend_sync', new Date('2026-06-01'));
      expect(res.consumedRows).toBe(2);
      expect(res.shortfall).toBe(20);

      expect(accounting.createEntry).toHaveBeenCalledTimes(2);

      const paidJournal = (accounting.createEntry as jest.Mock).mock.calls[0][0];
      expect(paidJournal.lines[1].accountId).toBe('acct-prepaid');
      expect(paidJournal.lines[1].credit).toBe(5280);

      const thresholdJournal = (accounting.createEntry as jest.Mock).mock.calls[1][0];
      expect(thresholdJournal.lines[1].accountId).toBe('acct-payable');
      expect(thresholdJournal.lines[1].credit).toBe(2640);
    });
  });

  describe('Scenario F - Multiple FX lots (lot-based credit valuation)', () => {
    it('credit value uses remaining x effectiveRate per lot, not first lot rate', async () => {
      // Set up payable balance to simulate threshold consumption
      // Threshold journal: Dr Expense / Cr Payable 2800
      (prisma.account.findFirst as jest.Mock).mockImplementation(({ where }: any) => {
        if (where.code === MARKETING_PAYABLE_ACCOUNT_CODE) {
          return Promise.resolve({ id: 'acct-payable', code: MARKETING_PAYABLE_ACCOUNT_CODE, name: 'Marketing Payable', type: 'liability', isGroup: false });
        }
        return Promise.resolve({ id: 'acct-other', code: 'other', name: 'Other', type: 'asset', isGroup: false });
      });

      const accounts = [{
        id: mockAdAccountId,
        name: 'Test Account',
        currency: 'USD',
        fundingLedger: [
          { fundingType: 'paid', receivedAmount: 100, remainingAmount: 60, consumedAmount: 40, effectiveRate: 132 },
          { fundingType: 'paid', receivedAmount: 50, remainingAmount: 30, consumedAmount: 20, effectiveRate: 140 },
          { fundingType: 'promotional', receivedAmount: 25, remainingAmount: 10, consumedAmount: 15, effectiveRate: 132 },
        ],
        payments: [],
      }];
      (prisma.adAccount.findMany as jest.Mock).mockResolvedValue(accounts);

      // Mock payable lines: threshold journal credit of 2800 referencing this campaign
      (prisma.journalEntryLine.findMany as jest.Mock).mockResolvedValue([
        { credit: 2800, entry: { description: `Marketing threshold (unfunded) — campaign ${mockCampaignId}` } },
      ]);
      // No threshold payments yet — prepaid consumption does NOT create MarketingPayment records
      (prisma.marketingPayment.findMany as jest.Mock).mockResolvedValue([]);

      const result = await paymentService.creditDuePosition(mockAdAccountId);
      expect(result).toHaveLength(1);
      const pos = result[0];

      expect(pos.paidCredit).toBe(90);
      expect(pos.promotionalCredit).toBe(10);
      expect(pos.totalCredit).toBe(100);

      // Due = threshold credit = 2800 (no threshold payments yet)
      expect(pos.due).toBe(2800);

      // totalPaid = 0 (no MarketingPayment records)
      expect(pos.totalPaid).toBe(0);

      // Billed = due + totalPaid = 2800 + 0 = 2800
      expect(pos.billed).toBe(2800);

      // Credit value (lot-based): 60x132 + 30x140 = 7920 + 4200 = 12120
      expect(pos.netPosition).toBe(9320);
    });
  });

  describe('Post payment debits Marketing Payable (not Prepaid)', () => {
    it('journal: Dr Marketing Payable / Cr Source Account', async () => {
      const payment = {
        id: 'pay-test-1',
        status: 'reconciled',
        actualCost: 6650,
        paymentDate: new Date('2026-06-15'),
        journalEntryId: null,
        notes: null,
        sourceAccountId: 'acct-bank',
        adAccount: { id: mockAdAccountId, name: 'Test Ad Account' },
        sourceAccount: null,
        journalEntry: null,
      };
      (prisma.marketingPayment.findUnique as jest.Mock).mockResolvedValue(payment);
      (prisma.account.findUnique as jest.Mock).mockResolvedValue({ id: 'acct-bank', name: 'Business Bank', isGroup: false });

      const result = await paymentService.postToAccounting('pay-test-1', 'user-1');

      expect(accounting.createEntry).toHaveBeenCalledTimes(1);
      const journalCall = (accounting.createEntry as jest.Mock).mock.calls[0][0];

      expect(journalCall.lines[0].accountId).toBe('acct-payable');
      expect(journalCall.lines[0].debit).toBe(6650);
      expect(journalCall.lines[0].description).toBe('Marketing payable reduction');

      expect(journalCall.lines[1].accountId).toBe('acct-bank');
      expect(journalCall.lines[1].credit).toBe(6650);
    });
  });
});
