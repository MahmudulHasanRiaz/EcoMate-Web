/**
 * P2 §6 — analytics freshness: marketing consumption drops `analytics:*`.
 *
 * Consumptions feed the P&L Marketing Cost line (spend-date basis, D10);
 * the @Optional cache keeps unit tests provider-free (no-op path).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { MarketingConsumptionService } from '../marketing-consumption.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingService } from '../../accounting/accounting.service';
import { CacheService } from '../../cache/cache.service';

describe('MarketingConsumptionService analytics invalidation', () => {
  let service: MarketingConsumptionService;
  const mockPrisma: any = {
    marketingCampaign: { findUnique: jest.fn() },
    marketingFundingLedger: { findMany: jest.fn() },
  };
  const mockCache: any = {
    invalidateByPrefix: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingConsumptionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AccountingService, useValue: {} },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();
    service = module.get(MarketingConsumptionService);
    mockPrisma.marketingCampaign.findUnique.mockResolvedValue({
      id: 'c1',
      adAccountId: 'a1',
    });
    mockPrisma.marketingFundingLedger.findMany.mockResolvedValue([]);
  });

  it('drops analytics:* after consume writes (shortfall path)', async () => {
    const res = await service.consume('c1', 100, 'spend_sync', new Date());
    expect(res).toEqual({ consumedRows: 0, shortfall: 100 });
    expect(mockCache.invalidateByPrefix).toHaveBeenCalledWith('analytics:');
  });

  it('skips invalidation when nothing is consumed (amount <= 0)', async () => {
    await service.consume('c1', 0);
    expect(mockPrisma.marketingCampaign.findUnique).not.toHaveBeenCalled();
    expect(mockCache.invalidateByPrefix).not.toHaveBeenCalled();
  });
});
