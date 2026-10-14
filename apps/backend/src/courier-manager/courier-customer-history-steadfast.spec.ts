import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import {
  CourierCustomerHistoryService,
  buildSteadfastReport,
  parseSteadfastScoreResponse,
} from './courier-customer-history.service';

const PHONE = '01712345678';

function steadfastCreds(prisma: any) {
  prisma.courierCredentials.findUnique.mockResolvedValue({
    courier: 'steadfast',
    enabled: true,
    apiKey: 'k',
    secretKey: 's',
    credentials: {},
  });
}

function scorePayload(extra: Record<string, unknown> = {}) {
  return {
    status: 200,
    phone: PHONE,
    delivery_ratio: 92,
    cancellation_ratio: 7,
    volume_band: 'high',
    volume_range: '50+',
    delivered_count: 58,
    cancelled_count: 5,
    total_reports: 0,
    fraud_categories: [],
    score: null,
    level: null,
    reasons: [],
    scoring_disabled: true,
    doubtful_reports: false,
    ...extra,
  };
}

describe('CourierCustomerHistoryService — Steadfast fraud-check score endpoint', () => {
  let service: CourierCustomerHistoryService;
  let prisma: any;
  let globalFetchSpy: jest.Mock;

  beforeEach(() => {
    globalFetchSpy = jest.fn();
    jest.spyOn(global, 'fetch').mockImplementation(globalFetchSpy as any);

    prisma = {
      courierReportCache: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      courierCredentials: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function makeService() {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourierCustomerHistoryService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(CourierCustomerHistoryService);
  }

  function fetchUrls(): string[] {
    return globalFetchSpy.mock.calls.map((c) => String(c[0]));
  }

  it('calls GET /fraud_check/score/{phone} — never the old /fraud_check/{phone}', async () => {
    await makeService();
    steadfastCreds(prisma);
    globalFetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(scorePayload()),
    } as any);

    const res = await service.getCustomerHistory('steadfast', PHONE);

    expect(res.report).not.toBeNull();
    const urls = fetchUrls();
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(`/fraud_check/score/${PHONE}`);
    expect(urls.some((u) => /\/fraud_check\/(?!score)/.test(u))).toBe(false);
  });

  it('maps ratios round-DOWN each (92.9/7.9 → 92/7, sum 99 — never 100-derived)', async () => {
    await makeService();
    steadfastCreds(prisma);
    globalFetchSpy.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve(
          scorePayload({ delivery_ratio: 92.9, cancellation_ratio: 7.9 }),
        ),
    } as any);

    const res = await service.getCustomerHistory('steadfast', PHONE);
    const fraud = (res.report as any).steadfastFraud;

    expect(fraud.deliveryRatio).toBe(92);
    expect(fraud.cancellationRatio).toBe(7);
    expect(fraud.deliveryRatio + fraud.cancellationRatio).toBe(99);
    // 100 - 92 would be 8: proves the cancellation side was floored on its
    // own, never derived from the delivery side.
    expect(fraud.cancellationRatio).not.toBe(100 - fraud.deliveryRatio);
  });

  it('maps band + range + counts + categories verbatim', async () => {
    await makeService();
    steadfastCreds(prisma);
    globalFetchSpy.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve(
          scorePayload({
            volume_band: 'medium',
            volume_range: '25+',
            delivered_count: 14,
            cancelled_count: 2,
            total_reports: 5,
            fraud_categories: { no_response: 3, refused: 1 },
          }),
        ),
    } as any);

    const res = await service.getCustomerHistory('steadfast', PHONE);
    const fraud = (res.report as any).steadfastFraud;

    expect(fraud.volumeBand).toBe('medium');
    expect(fraud.volumeRange).toBe('25+');
    expect(fraud.deliveredCount).toBe(14);
    expect(fraud.cancelledCount).toBe(2);
    expect(fraud.totalReports).toBe(5);
    expect(fraud.fraudCategories).toEqual({ no_response: 3, refused: 1 });
    expect(res.report).toMatchObject({
      success: 14,
      cancel: 2,
      total: 16,
      successRatio: 92,
      source: 'actual',
    });
  });

  it.each([
    ['none', null],
    ['low', '7'],
    ['medium', '10+'],
    ['high', '50+'],
    ['very_high', '100+'],
  ])('volume band %s with range %s is stored verbatim', async (band, range) => {
    await makeService();
    steadfastCreds(prisma);
    globalFetchSpy.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve(scorePayload({ volume_band: band, volume_range: range })),
    } as any);

    const res = await service.getCustomerHistory('steadfast', PHONE);
    const fraud = (res.report as any).steadfastFraud;
    expect(fraud.volumeBand).toBe(band);
    expect(fraud.volumeRange).toBe(range);
  });

  it('null counts/ratios stay null (never 0/clean) with an "unknown" record', async () => {
    await makeService();
    steadfastCreds(prisma);
    globalFetchSpy.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve(
          scorePayload({
            delivery_ratio: null,
            cancellation_ratio: null,
            volume_band: 'none',
            volume_range: null,
            delivered_count: null,
            cancelled_count: null,
            total_reports: 0,
            fraud_categories: [],
          }),
        ),
    } as any);

    const res = await service.getCustomerHistory('steadfast', PHONE);

    expect(res.report).not.toBeNull();
    const fraud = (res.report as any).steadfastFraud;
    expect(fraud.deliveryRatio).toBeNull();
    expect(fraud.cancellationRatio).toBeNull();
    expect(fraud.deliveredCount).toBeNull();
    expect(fraud.cancelledCount).toBeNull();
    expect(res.report!.successRatio).toBeNull();
    // Persisted nulls, not zeros — the UI renders these as "তথ্য নেই".
    const stored = prisma.courierReportCache.upsert.mock.calls[0][0].create
      .report as any;
    expect(stored.steadfastFraud.deliveryRatio).toBeNull();
    expect(stored.steadfastFraud.deliveredCount).toBeNull();
    expect(stored.successRatio).toBeNull();
  });

  it('never persists score/level/reasons (scoring disabled upstream)', async () => {
    await makeService();
    steadfastCreds(prisma);
    globalFetchSpy.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve(
          scorePayload({ score: 82, level: 'good', reasons: ['high cancel'] }),
        ),
    } as any);

    const res = await service.getCustomerHistory('steadfast', PHONE);

    const stored = prisma.courierReportCache.upsert.mock.calls[0][0].create
      .report as any;
    expect(stored.score).toBeUndefined();
    expect(stored.level).toBeUndefined();
    expect(stored.reasons).toBeUndefined();
    expect(stored.steadfastFraud.score).toBeUndefined();
    // The ratio comes from the floored delivery_ratio, never the score.
    expect(res.report!.successRatio).toBe(92);
  });

  it('fraud_categories sum may sit below total_reports (no validation)', async () => {
    const parsed = parseSteadfastScoreResponse(
      scorePayload({
        total_reports: 5,
        fraud_categories: { no_response: 3, refused: 1 },
      }) as any,
    );
    expect(parsed.fraudCategories).toEqual({ no_response: 3, refused: 1 });
    expect(parsed.totalReports).toBe(5);
    expect(buildSteadfastReport(parsed)).toBeTruthy();
  });

  it('429 backs off and retries the SAME score endpoint (shared limit, one call shape)', async () => {
    await makeService();
    steadfastCreds(prisma);
    globalFetchSpy
      .mockResolvedValueOnce({ ok: false, status: 429 } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(scorePayload()),
      } as any);

    const started = Date.now();
    const res = await service.getCustomerHistory('steadfast', PHONE);
    const elapsed = Date.now() - started;

    expect(res.report).not.toBeNull();
    expect((res.report as any).steadfastFraud.deliveryRatio).toBe(92);
    const urls = fetchUrls();
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.includes('/fraud_check/score/'))).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(150);
  });

  it('dashboard check reads the SAME stored record via the single reader (never disagrees)', async () => {
    await makeService();
    const stored = {
      success: 58,
      cancel: 5,
      total: 63,
      successRatio: 92,
      source: 'actual',
      schemaVersion: 3,
      steadfastFraud: {
        deliveryRatio: 92,
        cancellationRatio: 7,
        volumeBand: 'high',
        volumeRange: '50+',
        deliveredCount: 58,
        cancelledCount: 5,
        totalReports: 2,
        fraudCategories: { no_response: 2 },
      },
    };
    prisma.courierReportCache.findUnique.mockResolvedValue({
      courier: 'steadfast',
      phone: PHONE,
      report: stored,
      courierStatus: 'fresh',
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 100000),
    });
    const readerSpy = jest.spyOn(
      service as any,
      'readCachedSteadfastReport',
    );

    const viaEndpoint = await service.getCustomerHistory('steadfast', PHONE);
    const viaDashboard = await service.getSteadfastCheck(PHONE);

    expect(viaEndpoint.report).toEqual(viaDashboard.report);
    expect(viaEndpoint.report).toMatchObject({
      successRatio: 92,
      steadfastFraud: expect.objectContaining({ deliveryRatio: 92 }),
    });
    expect(globalFetchSpy).not.toHaveBeenCalled();
    expect(readerSpy).toHaveBeenCalledTimes(2);
  });
});
