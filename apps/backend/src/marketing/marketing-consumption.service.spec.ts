import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { MarketingConsumptionService } from './marketing-consumption.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MarketingConsumptionService', () => {
  let service: MarketingConsumptionService;
  let prisma: PrismaService;

  const mockCampaign = { id: 'camp-1', adAccountId: 'acct-1' };

  const makeLedger = (id: string, remaining: number, effectiveRate: number, createdAt = new Date('2026-01-01')) => ({
    id,
    adAccountId: 'acct-1',
    remainingAmount: remaining,
    consumedAmount: 0,
    status: 'confirmed',
    effectiveRate,
    createdAt,
  });

  const mockPrisma = () => ({
    marketingCampaign: { findUnique: jest.fn() },
    marketingFundingLedger: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    marketingConsumption: { create: jest.fn(), aggregate: jest.fn() },
    $transaction: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingConsumptionService,
        { provide: PrismaService, useValue: mockPrisma() },
      ],
    }).compile();
    service = module.get(MarketingConsumptionService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns empty for non-positive amount', async () => {
    const res = await service.consume('camp-1', 0);
    expect(res).toEqual({ consumedRows: 0, shortfall: 0 });
    expect(prisma.marketingCampaign.findUnique).not.toHaveBeenCalled();
  });

  it('throws BadRequest for unknown campaign', async () => {
    (prisma.marketingCampaign.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(service.consume('nope', 10)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('consumes FIFO (oldest ledger row first) and records effectiveRate at draw time', async () => {
    (prisma.marketingCampaign.findUnique as jest.Mock).mockResolvedValue(mockCampaign);
    const oldRow = makeLedger('row-old', 100, 120);
    const newRow = makeLedger('row-new', 50, 130, new Date('2026-01-02'));
    (prisma.marketingFundingLedger.findMany as jest.Mock).mockResolvedValue([oldRow, newRow]);

    // First draw hits the stale-guard tx: re-read current rows and apply.
    const consumptions: any[] = [];
    const ledgerUpdates: any[] = [];
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
      const tx = {
        marketingFundingLedger: {
          findUnique: jest.fn(async ({ where }: any) =>
            where.id === 'row-old' ? oldRow : newRow,
          ),
          update: jest.fn(async (args: any) => {
            ledgerUpdates.push(args);
            return args.data;
          }),
        },
        marketingConsumption: {
          create: jest.fn(async (args: any) => {
            consumptions.push(args.data);
            return args.data;
          }),
        },
      };
      return cb(tx);
    });

    const res = await service.consume('camp-1', 150, 'spend_sync', new Date('2026-01-10'));
    expect(res).toEqual({ consumedRows: 2, shortfall: 0 });

    // Consumption rows in FIFO order with captured rates.
    expect(consumptions).toHaveLength(2);
    expect(consumptions[0].consumedAmount).toBe(100);
    expect(consumptions[0].effectiveRate).toBe(120);
    expect(consumptions[0].calculatedCost).toBe(12000);
    expect(consumptions[0].spendDate?.toISOString()).toBe('2026-01-10T00:00:00.000Z');
    expect(consumptions[1].consumedAmount).toBe(50);
    expect(consumptions[1].effectiveRate).toBe(130);
    expect(ledgerUpdates[0].data.remainingAmount).toBe(0);
    expect(ledgerUpdates[0].data.status).toBe('fully_consumed');
    expect(ledgerUpdates[1].data.status).toBe('fully_consumed');
  });

  it('stops at oldest rows and reports the shortfall when funds run out', async () => {
    (prisma.marketingCampaign.findUnique as jest.Mock).mockResolvedValue(mockCampaign);
    const single = makeLedger('row-1', 40, 100);
    (prisma.marketingFundingLedger.findMany as jest.Mock).mockResolvedValue([single]);
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) =>
      cb({
        marketingFundingLedger: {
          findUnique: jest.fn(async () => single),
          update: jest.fn(),
        },
        marketingConsumption: { create: jest.fn() },
      }),
    );

    const res = await service.consume('camp-1', 100);
    expect(res.consumedRows).toBe(1);
    expect(res.shortfall).toBe(60);
  });

  it('skips a stale ledger row that changed under a concurrent transaction', async () => {
    (prisma.marketingCampaign.findUnique as jest.Mock).mockResolvedValue(mockCampaign);
    const row = makeLedger('row-stale', 10, 100);
    (prisma.marketingFundingLedger.findMany as jest.Mock).mockResolvedValue([row]);
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
      throw new Error('stale_ledger');
    });
    const res = await service.consume('camp-1', 10);
    expect(res.consumedRows).toBe(0);
    expect(res.shortfall).toBe(10);
  });

  it('consumeInsightSpend never throws; shortfall is logged as warning', async () => {
    const consumeSpy = jest.spyOn(service as any, 'consume').mockResolvedValue({ consumedRows: 0, shortfall: 5 });
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    await service.consumeInsightSpend([{ campaignId: 'camp-1', spend: 5, date: new Date('2026-01-01') }]);
    expect(consumeSpy).toHaveBeenCalledWith('camp-1', 5, 'spend_sync', expect.any(Date));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unfunded marketing spend'));
  });

  it('consumeInsightSpend swallows consume failures (sync must not fail on funding gaps)', async () => {
    jest.spyOn(service as any, 'consume').mockRejectedValue(new Error('boom'));
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    await expect(service.consumeInsightSpend([{ campaignId: 'camp-1', spend: 1, date: new Date() }])).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Consumption failed'));
  });
});