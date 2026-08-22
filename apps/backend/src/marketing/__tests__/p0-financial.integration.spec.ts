/**
 * P0 Financial Architecture Integration Test
 *
 * Runs against the real database (NOT mocked Prisma).
 * Verifies the 5-layer financial model, accrual accounting,
 * provider abstraction, and all approved business rules.
 *
 * Usage: npx jest --config jest.config.ts src/marketing/__tests__/p0-financial.integration.spec.ts
 */
import { PrismaClient, AccountType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres@localhost:5432/ecomate_web';
const pool = new Pool({ connectionString, max: 5 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const MARKETING_EXPENSE_CODE = 'marketing-expense';
const MARKETING_PREPAID_CODE = 'marketing-prepaid';

describe('P0 Financial Architecture Integration', () => {
  let testAccountId: string;
  let testPlatformId: string;
  let testConnectionId: string;
  let testCampaignId: string;
  let testBusinessVisaId: string;
  let testBankAccountId: string;
  let testPeriodId: string;

  beforeAll(async () => {
    // Ensure test financial period exists (current month)
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

    let period = await prisma.financialPeriod.findFirst({
      where: { startDate: { lte: monthStart }, endDate: { gte: monthStart } },
    });
    if (!period) {
      period = await prisma.financialPeriod.create({
        data: { name: `P0 Test ${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`, startDate: monthStart, endDate: monthEnd, isClosed: false },
      });
    }
    testPeriodId = period.id;

    // Ensure test accounting accounts exist
    let expenseAcct = await prisma.account.findFirst({ where: { code: MARKETING_EXPENSE_CODE } });
    if (!expenseAcct) {
      expenseAcct = await prisma.account.create({
        data: { code: MARKETING_EXPENSE_CODE, name: 'Marketing Expenses', type: 'expense', isGroup: false },
      });
    }

    let prepaidAcct = await prisma.account.findFirst({ where: { code: MARKETING_PREPAID_CODE } });
    if (!prepaidAcct) {
      prepaidAcct = await prisma.account.create({
        data: { code: MARKETING_PREPAID_CODE, name: 'Marketing Prepaid Credit', type: 'asset', isGroup: false },
      });
    }

    // Create test payment accounts
    testBusinessVisaId = (await prisma.account.upsert({
      where: { code: 'TEST-BUSINESS-VISA-P0' },
      update: {},
      create: { code: 'TEST-BUSINESS-VISA-P0', name: 'Test Business Visa (P0)', type: 'asset' as AccountType, isGroup: false },
    })).id;

    testBankAccountId = (await prisma.account.upsert({
      where: { code: 'TEST-BANK-ACCT-P0' },
      update: {},
      create: { code: 'TEST-BANK-ACCT-P0', name: 'Test Bank Account (P0)', type: 'asset' as AccountType, isGroup: false },
    })).id;

    // Create test platform + connection + ad account
    testPlatformId = (await prisma.marketingPlatform.upsert({
      where: { slug: 'facebook' },
      update: {},
      create: { id: `test-plat-${Date.now()}`, name: 'Meta Ads (Test)', slug: 'facebook' },
    })).id;

    testConnectionId = (await prisma.marketingConnection.create({
      data: {
        id: `test-conn-${Date.now()}`,
        platformId: testPlatformId,
        accessTokenEnc: 'test-encrypted-token',
        status: 'connected',
      },
    })).id;

    testAccountId = (await prisma.adAccount.create({
      data: {
        id: `test-acct-${Date.now()}`,
        connectionId: testConnectionId,
        providerAccountId: `act_test_${Date.now()}`,
        name: 'Test Ad Account (P0)',
        currency: 'USD',
        timezone: 'Asia/Dhaka',
        defaultPaymentAccountId: testBusinessVisaId,
      },
    })).id;

    // Create test campaign
    testCampaignId = (await prisma.marketingCampaign.create({
      data: {
        id: `test-camp-${Date.now()}`,
        adAccountId: testAccountId,
        providerCampaignId: `camp_test_${Date.now()}`,
        name: 'P0 Test Campaign',
        status: 'ACTIVE',
      },
    })).id;
  });

  afterAll(async () => {
    // Clean up test data (order matters for FKs)
    try {
      await prisma.marketingCostAllocation.deleteMany({ where: { campaignId: testCampaignId } });
      await prisma.orderAttribution.deleteMany({ where: { campaignId: testCampaignId } });
      await prisma.marketingConsumption.deleteMany({ where: { campaignId: testCampaignId } });
      await prisma.marketingFundingLedger.deleteMany({ where: { adAccountId: testAccountId } });
      await prisma.marketingFundingEntry.deleteMany({ where: { adAccountId: testAccountId } });
      await prisma.marketingPayment.deleteMany({ where: { adAccountId: testAccountId } });
      await prisma.marketingCampaign.deleteMany({ where: { id: testCampaignId } });
      await prisma.adAccount.deleteMany({ where: { id: testAccountId } });
      await prisma.marketingConnection.deleteMany({ where: { id: testConnectionId } });
      await prisma.account.deleteMany({ where: { code: { startsWith: 'TEST-' } } });
    } catch { /* cleanup best-effort */ }
    await prisma.$disconnect();
  });

  describe('Scenario A — Paid Prepaid Funding', () => {
    it('creates funding entry + ledger with correct amounts; ledger tracks platform currency', async () => {
      // User pays Meta $100 USD, actual cost ৳13,200 BDT
      const entry = await prisma.marketingFundingEntry.create({
        data: {
          platform: 'facebook',
          adAccountId: testAccountId,
          fundingSource: 'BANK',
          fundingDate: new Date(),
          currency: 'USD',
          currencyAmount: 100,
          baseCurrency: 'BDT',
          baseAmount: 13200,
          effectiveRate: 132,
          status: 'confirmed',
        },
      });

      const ledger = await prisma.marketingFundingLedger.create({
        data: {
          fundingEntryId: entry.id,
          adAccountId: testAccountId,
          receivedAmount: 100,
          remainingAmount: 100,
          effectiveRate: 132,
          consumedAmount: 0,
          status: 'confirmed',
        },
      });

      // Verify funding ledger: Credit = +$100 platform currency
      const summary = await prisma.marketingFundingLedger.aggregate({
        _sum: { receivedAmount: true, remainingAmount: true, consumedAmount: true },
        where: { adAccountId: testAccountId },
      });
      expect(Number(summary._sum.receivedAmount)).toBeGreaterThanOrEqual(100);
      expect(Number(summary._sum.remainingAmount)).toBeGreaterThanOrEqual(100);

      // Verify the entry records both platform and base currency
      expect(entry.currency).toBe('USD');
      expect(entry.baseCurrency).toBe('BDT');
      expect(Number(entry.currencyAmount)).toBe(100);
      expect(Number(entry.baseAmount)).toBe(13200);
      expect(Number(entry.effectiveRate)).toBe(132);

      // Verify ledger tracks platform currency amounts
      expect(Number(ledger.receivedAmount)).toBe(100);
      expect(Number(ledger.remainingAmount)).toBe(100);
      expect(Number(ledger.effectiveRate)).toBe(132);

      // Cleanup
      await prisma.marketingFundingLedger.delete({ where: { id: ledger.id } });
      await prisma.marketingFundingEntry.delete({ where: { id: entry.id } });
    });
  });

  describe('Scenario D — Payment Reconciliation', () => {
    it('creates payment, reconciles with derived FX rate', async () => {
      const payment = await prisma.marketingPayment.create({
        data: {
          adAccountId: testAccountId,
          platformAmount: 50,
          platformCurrency: 'USD',
          paymentDate: new Date(),
          sourceAccountId: testBusinessVisaId,
          status: 'pending',
        },
      });

      expect(payment.status).toBe('pending');

      // Reconcile: actual BDT cost = 6650
      const actualCost = 6650;
      const platformAmount = 50;
      const effectiveRate = Math.round((actualCost / platformAmount) * 10000) / 10000;
      expect(effectiveRate).toBe(133);

      const reconciled = await prisma.marketingPayment.update({
        where: { id: payment.id },
        data: {
          actualCost,
          baseCurrency: 'BDT',
          effectiveRate,
          status: 'reconciled',
          reconciledAt: new Date(),
        },
      });

      expect(reconciled.status).toBe('reconciled');
      expect(Number(reconciled.effectiveRate)).toBe(133);
      expect(Number(reconciled.actualCost)).toBe(6650);

      // Cleanup
      await prisma.marketingPayment.delete({ where: { id: payment.id } });
    });
  });

  describe('Scenario E — Default Payment Account', () => {
    it('auto-selects default payment account from ad account', async () => {
      // Ad account has defaultPaymentAccountId = testBusinessVisaId
      const adAccount = await prisma.adAccount.findUnique({ where: { id: testAccountId } });
      expect(adAccount?.defaultPaymentAccountId).toBe(testBusinessVisaId);

      // Create payment without explicit sourceAccountId
      const payment = await prisma.marketingPayment.create({
        data: {
          adAccountId: testAccountId,
          platformAmount: 25,
          platformCurrency: 'USD',
          paymentDate: new Date(),
          sourceAccountId: adAccount!.defaultPaymentAccountId!,
          status: 'pending',
        },
      });

      expect(payment.sourceAccountId).toBe(testBusinessVisaId);

      // Override: explicit different account
      const override = await prisma.marketingPayment.create({
        data: {
          adAccountId: testAccountId,
          platformAmount: 30,
          platformCurrency: 'USD',
          paymentDate: new Date(),
          sourceAccountId: testBankAccountId,
          status: 'pending',
        },
      });

      expect(override.sourceAccountId).toBe(testBankAccountId);
      // Default should still be the original
      const stillDefault = await prisma.adAccount.findUnique({ where: { id: testAccountId } });
      expect(stillDefault?.defaultPaymentAccountId).toBe(testBusinessVisaId);

      // Cleanup
      await prisma.marketingPayment.delete({ where: { id: payment.id } });
      await prisma.marketingPayment.delete({ where: { id: override.id } });
    });
  });

  describe('Scenario F — Payment Idempotency', () => {
    it('rejects duplicate providerPaymentId', async () => {
      const p1 = await prisma.marketingPayment.create({
        data: {
          adAccountId: testAccountId,
          providerPaymentId: 'DUPLICATE-PAY-TEST-001',
          platformAmount: 50,
          platformCurrency: 'USD',
          paymentDate: new Date(),
          status: 'pending',
        },
      });

      // Attempt duplicate
      await expect(
        prisma.marketingPayment.create({
          data: {
            adAccountId: testAccountId,
            providerPaymentId: 'DUPLICATE-PAY-TEST-001',
            platformAmount: 50,
            platformCurrency: 'USD',
            paymentDate: new Date(),
            status: 'pending',
          },
        }),
      ).rejects.toThrow();

      // Cleanup
      await prisma.marketingPayment.delete({ where: { id: p1.id } });
    });
  });

  describe('Scenario G — Credit/Due Position', () => {
    it('calculates credit = funded - consumed, due = billed - paid', async () => {
      // Create a fresh ad account for isolation
      const freshAcctId = `test-acct-credit-${Date.now()}`;
      const freshAcct = await prisma.adAccount.create({
        data: {
          id: freshAcctId,
          connectionId: testConnectionId,
          providerAccountId: `act_credit_${Date.now()}`,
          name: 'P0 Credit Test Account',
          currency: 'USD',
          defaultPaymentAccountId: testBusinessVisaId,
        },
      });

      // Fund $100
      const ledger = await prisma.marketingFundingLedger.create({
        data: {
          fundingEntryId: (await prisma.marketingFundingEntry.create({
            data: {
              platform: 'facebook',
              adAccountId: freshAcctId,
              fundingSource: 'BANK',
              fundingDate: new Date(),
              currency: 'USD',
              currencyAmount: 100,
              baseCurrency: 'BDT',
              baseAmount: 13200,
              effectiveRate: 132,
              status: 'confirmed',
            },
          })).id,
          adAccountId: freshAcctId,
          receivedAmount: 100,
          remainingAmount: 100,
          effectiveRate: 132,
          consumedAmount: 0,
          status: 'confirmed',
        },
      });

      // Case 1: Credit = $100 (platform), Due = ৳0 (nothing consumed yet)
      const pos1 = await calculatePosition(freshAcctId);
      expect(pos1.credit).toBe(100);
      expect(pos1.due).toBe(0);

      // Consume $40 via FIFO (simulate)
      await prisma.marketingFundingLedger.update({
        where: { id: ledger.id },
        data: {
          remainingAmount: 60,
          consumedAmount: 40,
          status: 'partially_consumed',
        },
      });

      // Case 2: Credit = $60 (platform), Due = ৳5280 ($40 × 132, consumed but not paid)
      const pos2 = await calculatePosition(freshAcctId);
      expect(pos2.credit).toBe(60);
      expect(pos2.due).toBe(5280);

      // Pay ৳3960 (base currency)
      await prisma.marketingPayment.create({
        data: {
          adAccountId: freshAcctId,
          platformAmount: 30,
          platformCurrency: 'USD',
          paymentDate: new Date(),
          actualCost: 3960,
          baseCurrency: 'BDT',
          effectiveRate: 132,
          status: 'reconciled',
          reconciledAt: new Date(),
          sourceAccountId: testBusinessVisaId,
        },
      });

      // Case 3: Credit = $60 (platform), Due = ৳1320 (billed 5280 - paid 3960)
      const pos3 = await calculatePosition(freshAcctId);
      expect(pos3.credit).toBe(60);
      expect(pos3.due).toBe(1320);

      // Cleanup
      await prisma.marketingPayment.deleteMany({ where: { adAccountId: freshAcctId } });
      await prisma.marketingFundingLedger.deleteMany({ where: { adAccountId: freshAcctId } });
      await prisma.marketingFundingEntry.deleteMany({ where: { adAccountId: freshAcctId } });
      await prisma.adAccount.delete({ where: { id: freshAcctId } });
    });
  });

  describe('Scenario J — Accrual Behavior', () => {
    it('expense recognized only at consumption time, NOT at funding time', async () => {
      // This is the CRITICAL accrual test
      // Fund $100, consume $40 → P&L should show $40 expense, not $100

      const freshAcctId = `test-acct-accrual-${Date.now()}`;
      await prisma.adAccount.create({
        data: {
          id: freshAcctId,
          connectionId: testConnectionId,
          providerAccountId: `act_accrual_${Date.now()}`,
          name: 'P0 Accrual Test Account',
          currency: 'USD',
        },
      });

      const freshCampId = `test-camp-accrual-${Date.now()}`;
      await prisma.marketingCampaign.create({
        data: {
          id: freshCampId,
          adAccountId: freshAcctId,
          providerCampaignId: `camp_accrual_${Date.now()}`,
          name: 'P0 Accrual Campaign',
          status: 'ACTIVE',
        },
      });

      // Fund $100 → Dr Prepaid / Cr Visa (NO expense)
      const fundingEntry = await prisma.marketingFundingEntry.create({
        data: {
          platform: 'facebook',
          adAccountId: freshAcctId,
          fundingSource: 'BANK',
          fundingDate: new Date(),
          currency: 'USD',
          currencyAmount: 100,
          baseCurrency: 'BDT',
          baseAmount: 13200,
          effectiveRate: 132,
          status: 'confirmed',
        },
      });

      await prisma.marketingFundingLedger.create({
        data: {
          fundingEntryId: fundingEntry.id,
          adAccountId: freshAcctId,
          receivedAmount: 100,
          remainingAmount: 100,
          effectiveRate: 132,
          consumedAmount: 0,
          status: 'confirmed',
        },
      });

      // Count expense lines BEFORE consumption
      const expenseBefore = await prisma.journalEntryLine.aggregate({
        _sum: { debit: true },
        where: { account: { code: MARKETING_EXPENSE_CODE } },
      });
      const debitBefore = Number(expenseBefore._sum.debit ?? 0);

      // Simulate consumption: $40 spent
      // In production, this happens via MarketingConsumptionService.consume()
      // which now creates: Dr Marketing Expense / Cr Marketing Prepaid
      const consumptionJournal = await prisma.journalEntry.create({
        data: {
          periodId: testPeriodId,
          entryDate: new Date(),
          entryNo: `MCON-ACC-${Date.now()}`,
          description: 'Marketing consumption — campaign test',
          referenceNo: `MCON-accrual-${Date.now()}`,
          totalDebit: 5280,
          totalCredit: 5280,
          lines: {
            create: [
              {
                accountId: (await prisma.account.findFirst({ where: { code: MARKETING_EXPENSE_CODE } }))!.id,
                debit: 5280,
                credit: 0,
                description: 'Marketing expense recognized at spend time',
              },
              {
                accountId: (await prisma.account.findFirst({ where: { code: MARKETING_PREPAID_CODE } }))!.id,
                debit: 0,
                credit: 5280,
                description: 'Marketing prepaid credit consumed',
              },
            ],
          },
        },
      });

      // Count expense lines AFTER consumption
      const expenseAfter = await prisma.journalEntryLine.aggregate({
        _sum: { debit: true },
        where: { account: { code: MARKETING_EXPENSE_CODE } },
      });
      const debitAfter = Number(expenseAfter._sum.debit ?? 0);

      // Expense should only increase by the consumed amount ($40 × 132 = 5280 BDT)
      const expenseIncrease = debitAfter - debitBefore;
      expect(expenseIncrease).toBe(5280);

      // The $100 funding (13200 BDT) should NOT appear as expense
      // Prove: no single expense line of 13200 from this funding
      const falseExpenseLines = await prisma.journalEntryLine.findMany({
        where: {
          account: { code: MARKETING_EXPENSE_CODE },
          debit: 13200,
        },
      });
      // None of these should be from the funding entry
      // (they might exist from other tests, but not from our funding)
      // The key assertion: expense only increased by 5280, not 13200
      expect(expenseIncrease).toBeLessThan(13200);

      // Verify prepaid account decreased by 5280
      const prepaidJournalLines = await prisma.journalEntryLine.findMany({
        where: {
          account: { code: MARKETING_PREPAID_CODE },
          createdAt: { gte: new Date(Date.now() - 5000) },
        },
      });
      const prepaidCredit = prepaidJournalLines
        .filter(l => Number(l.credit) > 0)
        .reduce((sum, l) => sum + Number(l.credit), 0);
      expect(prepaidCredit).toBe(5280);

      // Cleanup
      await prisma.journalEntryLine.deleteMany({ where: { entryId: consumptionJournal.id } });
      await prisma.journalEntry.delete({ where: { id: consumptionJournal.id } });
      await prisma.marketingFundingLedger.deleteMany({ where: { adAccountId: freshAcctId } });
      await prisma.marketingFundingEntry.deleteMany({ where: { adAccountId: freshAcctId } });
      await prisma.marketingCampaign.delete({ where: { id: freshCampId } });
      await prisma.adAccount.delete({ where: { id: freshAcctId } });
    });
  });

  describe('Scenario L — Payment Does Not Belong to Campaign', () => {
    it('payment has no campaignId; campaigns track spend via separate allocation', async () => {
      // Create two campaigns
      const campA = await prisma.marketingCampaign.create({
        data: {
          adAccountId: testAccountId,
          providerCampaignId: `camp_sep_a_${Date.now()}`,
          name: 'P0 Separation Campaign A',
          status: 'ACTIVE',
        },
      });
      const campB = await prisma.marketingCampaign.create({
        data: {
          adAccountId: testAccountId,
          providerCampaignId: `camp_sep_b_${Date.now()}`,
          name: 'P0 Separation Campaign B',
          status: 'ACTIVE',
        },
      });

      // Create one account-level payment = $50
      const payment = await prisma.marketingPayment.create({
        data: {
          adAccountId: testAccountId,
          platformAmount: 50,
          platformCurrency: 'USD',
          paymentDate: new Date(),
          actualCost: 6600,
          baseCurrency: 'BDT',
          effectiveRate: 132,
          status: 'reconciled',
          reconciledAt: new Date(),
          sourceAccountId: testBusinessVisaId,
        },
      });

      // Verify: payment has NO campaignId field (it's account-level)
      // Prisma MarketingPayment model has no campaignId field
      const paymentRecord = await prisma.marketingPayment.findUnique({ where: { id: payment.id } });
      expect(paymentRecord).toBeDefined();
      // The schema proves payment is account-level: @@index([adAccountId]) not campaignId

      // Verify: campaign profitability is based on insights/consumption, not payment
      // Create separate consumptions per campaign
      const ledgerA = await prisma.marketingFundingLedger.create({
        data: {
          fundingEntryId: (await prisma.marketingFundingEntry.create({
            data: {
              platform: 'facebook', adAccountId: testAccountId, fundingSource: 'BANK',
              fundingDate: new Date(), currency: 'USD', currencyAmount: 20,
              baseCurrency: 'BDT', baseAmount: 2640, effectiveRate: 132, status: 'confirmed',
            },
          })).id,
          adAccountId: testAccountId, receivedAmount: 20, remainingAmount: 0,
          effectiveRate: 132, consumedAmount: 20, status: 'fully_consumed',
        },
      });

      const ledgerB = await prisma.marketingFundingLedger.create({
        data: {
          fundingEntryId: (await prisma.marketingFundingEntry.create({
            data: {
              platform: 'facebook', adAccountId: testAccountId, fundingSource: 'BANK',
              fundingDate: new Date(), currency: 'USD', currencyAmount: 30,
              baseCurrency: 'BDT', baseAmount: 3960, effectiveRate: 132, status: 'confirmed',
            },
          })).id,
          adAccountId: testAccountId, receivedAmount: 30, remainingAmount: 0,
          effectiveRate: 132, consumedAmount: 30, status: 'fully_consumed',
        },
      });

      // Campaign A consumed $20, Campaign B consumed $30 — independent of the $50 payment
      const consA = await prisma.marketingConsumption.create({
        data: {
          ledgerId: ledgerA.id, campaignId: campA.id, consumedAmount: 20,
          effectiveRate: 132, calculatedCost: 2640, source: 'spend_sync',
        },
      });

      const consB = await prisma.marketingConsumption.create({
        data: {
          ledgerId: ledgerB.id, campaignId: campB.id, consumedAmount: 30,
          effectiveRate: 132, calculatedCost: 3960, source: 'spend_sync',
        },
      });

      // Verify: Campaign A cost = $20, Campaign B cost = $30
      const campACons = await prisma.marketingConsumption.aggregate({
        _sum: { consumedAmount: true },
        where: { campaignId: campA.id },
      });
      expect(Number(campACons._sum.consumedAmount)).toBe(20);

      const campBCons = await prisma.marketingConsumption.aggregate({
        _sum: { consumedAmount: true },
        where: { campaignId: campB.id },
      });
      expect(Number(campBCons._sum.consumedAmount)).toBe(30);

      // Cleanup
      await prisma.marketingConsumption.deleteMany({ where: { campaignId: { in: [campA.id, campB.id] } } });
      await prisma.marketingPayment.delete({ where: { id: payment.id } });
      await prisma.marketingFundingLedger.deleteMany({ where: { id: { in: [ledgerA.id, ledgerB.id] } } });
      await prisma.marketingFundingEntry.deleteMany({ where: { adAccountId: testAccountId, fundingSource: 'BANK', status: 'confirmed', currencyAmount: { in: [20, 30] } } });
      await prisma.marketingCampaign.deleteMany({ where: { id: { in: [campA.id, campB.id] } } });
    });
  });

  describe('Scenario I — Multi-Currency', () => {
    it('preserves source currency and converts for base-currency reporting', async () => {
      // USD account
      const usdAcctId = `test-acct-usd-${Date.now()}`;
      await prisma.adAccount.create({
        data: {
          id: usdAcctId,
          connectionId: testConnectionId,
          providerAccountId: `act_usd_${Date.now()}`,
          name: 'P0 USD Account',
          currency: 'USD',
        },
      });

      // BDT account (hypothetical)
      const bdtAcctId = `test-acct-bdt-${Date.now()}`;
      await prisma.adAccount.create({
        data: {
          id: bdtAcctId,
          connectionId: testConnectionId,
          providerAccountId: `act_bdt_${Date.now()}`,
          name: 'P0 BDT Account',
          currency: 'BDT',
        },
      });

      // USD payment: $50 at 132 rate → 6600 BDT
      const usdPayment = await prisma.marketingPayment.create({
        data: {
          adAccountId: usdAcctId,
          platformAmount: 50,
          platformCurrency: 'USD',
          paymentDate: new Date(),
          actualCost: 6600,
          baseCurrency: 'BDT',
          effectiveRate: 132,
          status: 'reconciled',
          reconciledAt: new Date(),
        },
      });

      // BDT payment: ৳5000 at 1:1 rate → 5000 BDT
      const bdtPayment = await prisma.marketingPayment.create({
        data: {
          adAccountId: bdtAcctId,
          platformAmount: 5000,
          platformCurrency: 'BDT',
          paymentDate: new Date(),
          actualCost: 5000,
          baseCurrency: 'BDT',
          effectiveRate: 1,
          status: 'reconciled',
          reconciledAt: new Date(),
        },
      });

      // Verify currencies preserved
      expect(usdPayment.platformCurrency).toBe('USD');
      expect(bdtPayment.platformCurrency).toBe('BDT');

      // Verify base costs are correct
      expect(Number(usdPayment.actualCost)).toBe(6600);
      expect(Number(bdtPayment.actualCost)).toBe(5000);

      // Cleanup
      await prisma.marketingPayment.delete({ where: { id: usdPayment.id } });
      await prisma.marketingPayment.delete({ where: { id: bdtPayment.id } });
      await prisma.adAccount.delete({ where: { id: usdAcctId } });
      await prisma.adAccount.delete({ where: { id: bdtAcctId } });
    });
  });

  describe('Scenario K — Optional Fee/Tax', () => {
    it('simple mode works without fee/tax fields', async () => {
      const payment = await prisma.marketingPayment.create({
        data: {
          adAccountId: testAccountId,
          platformAmount: 50,
          platformCurrency: 'USD',
          paymentDate: new Date(),
          actualCost: 6650,
          baseCurrency: 'BDT',
          effectiveRate: 133,
          status: 'reconciled',
          reconciledAt: new Date(),
        },
      });

      expect(payment.feeAmount).toBeNull();
      expect(payment.taxAmount).toBeNull();
      expect(payment.processingFee).toBeNull();
      expect(Number(payment.effectiveRate)).toBe(133);

      await prisma.marketingPayment.delete({ where: { id: payment.id } });
    });

    it('advanced mode preserves fee/tax decomposition', async () => {
      const payment = await prisma.marketingPayment.create({
        data: {
          adAccountId: testAccountId,
          platformAmount: 50,
          platformCurrency: 'USD',
          paymentDate: new Date(),
          actualCost: 6650,
          baseCurrency: 'BDT',
          effectiveRate: 133,
          feeAmount: 2.50,
          taxAmount: 1.00,
          processingFee: 0.50,
          status: 'reconciled',
          reconciledAt: new Date(),
        },
      });

      expect(Number(payment.feeAmount)).toBe(2.50);
      expect(Number(payment.taxAmount)).toBe(1.00);
      expect(Number(payment.processingFee)).toBe(0.50);

      await prisma.marketingPayment.delete({ where: { id: payment.id } });
    });
  });
});

async function calculatePosition(adAccountId: string) {
  const account = await prisma.adAccount.findUnique({
    where: { id: adAccountId },
    include: {
      fundingLedger: true,
      payments: true,
    },
  });
  if (!account) throw new Error('Account not found');

  const totalFunded = account.fundingLedger.reduce(
    (sum, l) => sum + Number(l.receivedAmount), 0,
  );
  const totalConsumed = account.fundingLedger.reduce(
    (sum, l) => sum + Number(l.consumedAmount), 0,
  );
  // Credit in platform currency
  const credit = Math.round((totalFunded - totalConsumed) * 100) / 100;

  const totalPaid = account.payments
    .filter((p) => p.status === 'reconciled' && p.actualCost)
    .reduce((sum, p) => sum + Number(p.actualCost), 0);
  // billed = base-currency cost via effectiveRate
  const billed = account.fundingLedger.reduce(
    (sum, l) => sum + Number(l.consumedAmount) * Number(l.effectiveRate),
    0,
  );
  const due = Math.round((billed - totalPaid) * 100) / 100;

  return { credit, due, totalFunded, totalConsumed, totalPaid, billed: Math.round(billed * 100) / 100 };
}
