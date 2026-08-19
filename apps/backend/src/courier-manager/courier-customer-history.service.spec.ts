import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { CourierCustomerHistoryService, CourierReport } from './courier-customer-history.service';

const PHONE = '01712345678';
const NOR_PHONE = '01712345678';

function mockPathaoApi(globalFetch: jest.Mock, rating: string, totalOrders: number) {
  globalFetch.mockImplementation((url: string) => {
    if (url.includes('/api/v1/login')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ access_token: 'TOKEN' }),
      } as any);
    }
    if (url.includes('/user/success')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { customer_rating: rating, total_orders: totalOrders } }),
      } as any);
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as any);
  });
}

function neverResolvedCache(prisma: any, row: any = null) {
  prisma.courierReportCache.findUnique.mockResolvedValue(row);
}

describe('CourierCustomerHistoryService', () => {
  let service: CourierCustomerHistoryService;
  let prisma: any;
  let globalFetchSpy: jest.Mock;

  beforeEach(() => {
    globalFetchSpy = jest.fn();
    jest.spyOn(global, 'fetch').mockImplementation(globalFetchSpy as any);

    prisma = {
      courierReportCache: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
      courierCredentials: {
        findUnique: jest.fn().mockResolvedValue({
          courier: 'pathao',
          enabled: true,
          username: 'user',
          password: 'pass',
          credentials: {},
        }),
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

  describe('Pathao rating normalization', () => {
    beforeEach(async () => await makeService());

    it.each([
      ['New Customer', 'new', null],
      ['new_customer', 'new', null],
      ['Excellent', 'normalized', 90],
      ['excellent', 'normalized', 90],
      ['Good', 'normalized', 80],
      ['good_customer', 'normalized', 80],
      ['Moderate', 'normalized', 70],
      ['average_customer', 'normalized', 70],
      ['Risky', 'normalized', 40],
      ['bad_customer', 'normalized', 40],
    ] as [string, string, number | null][])(
      'rating "%s" resolves to source %s with ratio %s',
      async (rating, expectedSource, expectedRatio) => {
        mockPathaoApi(globalFetchSpy, rating, 25);
        const res = await service.getCustomerHistory('pathao', PHONE);
        expect(res.report).not.toBeNull();
        expect(res.report!.source).toBe(expectedSource);
        expect(res.report!.successRatio).toBe(expectedRatio);
        expect(res.report!.rating).toBe(rating);
      },
    );

    it('never fabricates success/cancel counts for a new customer', async () => {
      mockPathaoApi(globalFetchSpy, 'New Customer', 25);
      const res = await service.getCustomerHistory('pathao', PHONE);
      expect(res.report).toEqual({
        success: 0,
        cancel: 0,
        total: 25,
        successRatio: null,
        source: 'new',
        rating: 'New Customer',
        schemaVersion: 2,
      });
    });

    it('builds normalized counts from the calibrated ratio', async () => {
      mockPathaoApi(globalFetchSpy, 'Excellent', 20);
      const res = await service.getCustomerHistory('pathao', PHONE);
      expect(res.report).toMatchObject({
        success: 18,
        cancel: 2,
        total: 20,
        successRatio: 90,
        source: 'normalized',
      });
    });

    it('rounds normalized counts non-trivially (90% of 7 = 6)', async () => {
      mockPathaoApi(globalFetchSpy, 'Excellent', 7);
      const res = await service.getCustomerHistory('pathao', PHONE);
      expect(res.report).toMatchObject({ success: 6, cancel: 1, total: 7, successRatio: 90 });
    });

    it('unknown rating is neutral (never the old 50% default)', async () => {
      mockPathaoApi(globalFetchSpy, 'VIP Customer', 12);
      const res = await service.getCustomerHistory('pathao', PHONE);
      expect(res.report).toMatchObject({ source: 'new', successRatio: null, success: 0 });
    });

    it('total_orders = 0 yields no report (zero history, not 0% success)', async () => {
      mockPathaoApi(globalFetchSpy, 'Good', 0);
      const res = await service.getCustomerHistory('pathao', PHONE);
      expect(res.report).toBeNull();
      expect(res.fresh).toBe(false);
      expect(prisma.courierReportCache.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ courierStatus: 'no_data' }),
        }),
      );
    });

    it('honors a configured calibration override from system settings', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        key: 'pathao_rating_calibration',
        value: JSON.stringify({ excellent: 95, good: 200, moderate: -5 }),
      });
      mockPathaoApi(globalFetchSpy, 'Excellent', 20);
      const res = await service.getCustomerHistory('pathao', PHONE);
      expect(res.report!.successRatio).toBe(95);
      expect(res.report!.success).toBe(19);

      globalFetchSpy.mockReset();
      mockPathaoApi(globalFetchSpy, 'Good', 20);
      const res2 = await service.getCustomerHistory('pathao', PHONE);
      expect(res2.report!.successRatio).toBe(80);
    });

    it('falls back to defaults when calibration JSON is invalid', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        key: 'pathao_rating_calibration',
        value: 'not-json{',
      });
      mockPathaoApi(globalFetchSpy, 'Risky', 20);
      const res = await service.getCustomerHistory('pathao', PHONE);
      expect(res.report!.successRatio).toBe(40);
    });
  });

  describe('Cache handling and schema versioning', () => {
    beforeEach(async () => await makeService());

    it('serves a fresh schema-v2 cached pathao report without refetching', async () => {
      neverResolvedCache(prisma, {
        courier: 'pathao',
        phone: NOR_PHONE,
        report: {
          success: 18,
          cancel: 2,
          total: 20,
          successRatio: 90,
          source: 'normalized',
          rating: 'Excellent',
          schemaVersion: 2,
        },
        courierStatus: 'fresh',
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 100000),
      });
      const res = await service.getCustomerHistory('pathao', PHONE);
      expect(res.cached).toBe(true);
      expect(res.fresh).toBe(true);
      expect(res.report).toMatchObject({ source: 'normalized', successRatio: 90 });
      expect(globalFetchSpy).not.toHaveBeenCalled();
    });

    it('refetches legacy pathao cache rows without schema metadata (ambiguous synthesized data)', async () => {
      neverResolvedCache(prisma, {
        courier: 'pathao',
        phone: NOR_PHONE,
        report: { success: 12, cancel: 13, total: 25, successRatio: 50 },
        courierStatus: 'fresh',
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 100000),
      });
      mockPathaoApi(globalFetchSpy, 'Excellent', 20);
      const res = await service.getCustomerHistory('pathao', PHONE);
      expect(globalFetchSpy).toHaveBeenCalled();
      expect(res.report).toMatchObject({ success: 18, successRatio: 90, source: 'normalized' });
      expect(prisma.courierReportCache.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ courierStatus: 'fresh' }),
        }),
      );
    });

    it('coerces legacy non-pathao cache rows to actual counts without refetching', async () => {
      neverResolvedCache(prisma, {
        courier: 'steadfast',
        phone: NOR_PHONE,
        report: { success: 3, cancel: 1, total: 4, successRatio: 75 },
        courierStatus: 'fresh',
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 100000),
      });
      const res = await service.getCustomerHistory('steadfast', PHONE);
      expect(res.cached).toBe(true);
      expect(res.report).toMatchObject({ source: 'actual', successRatio: 75, success: 3, total: 4 });
      expect(globalFetchSpy).not.toHaveBeenCalled();
    });

    it('stamps non-pathao fetched reports as actual', async () => {
      const creds = { courier: 'steadfast', enabled: true, apiKey: 'k', secretKey: 's', credentials: {} };
      prisma.courierCredentials.findUnique.mockResolvedValue(creds);
      globalFetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ total_delivered: 3, total_cancelled: 1 }),
      } as any);
      const res = await service.getCustomerHistory('steadfast', PHONE);
      expect(res.report).toMatchObject({ success: 3, cancel: 1, total: 4, successRatio: 75, source: 'actual' });
      expect(prisma.courierReportCache.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            report: expect.objectContaining({ schemaVersion: 2, source: 'actual' }),
          }),
        }),
      );
    });
  });
});