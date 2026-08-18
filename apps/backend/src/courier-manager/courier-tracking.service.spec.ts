import { Test, TestingModule } from '@nestjs/testing';
import { CourierTrackingService } from './courier-tracking.service';
import { CourierTokenService } from './courier-token.service';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';

describe('CourierTrackingService.getDispatchTracking', () => {
  let service: CourierTrackingService;
  let prisma: any;
  let cache: any;

  const creds = {
    courier: 'steadfast',
    enabled: true,
    mode: 'sandbox',
    apiKey: 'api-key',
    secretKey: 'secret-key',
    credentials: {},
  };

  beforeEach(async () => {
    prisma = {
      courierReportCache: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
      courierCredentials: {
        findUnique: jest.fn().mockResolvedValue(creds),
      },
      courierAuthToken: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
      isRestoreWriteBlocked: jest.fn().mockResolvedValue(false),
    };
    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          consignment_id: 'CG-1',
          delivery_status: 'delivered',
          tracking_history: [
            { status: 'pending', message: 'Order Placed', time: '2026-08-01T10:00:00Z' },
            { status: 'delivered_customer', message: 'Delivered', time: '2026-08-03T12:00:00Z' },
          ],
        },
      }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourierTrackingService,
        CourierTokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<CourierTrackingService>(CourierTrackingService);
  });

  afterEach(() => {
    // @ts-expect-error allow resetting global fetch
    delete global.fetch;
  });

  it('returns fresh Redis cache without touching the courier API when force is false', async () => {
    cache.get.mockResolvedValue({
      courier: 'steadfast',
      phone: '01700000000',
      consignmentId: 'CG-1',
      configured: true,
      currentStatus: 'delivered',
      events: [],
      fetchedAt: new Date().toISOString(),
    });

    const result = await service.getDispatchTracking(
      'steadfast',
      '01700000000',
      'CG-1',
      null,
      { force: false },
    );

    expect(result?.currentStatus).toBe('delivered');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(prisma.courierReportCache.findUnique).not.toHaveBeenCalled();
  });

  it('force: true skips the fresh cache and fetches the latest status from the courier API', async () => {
    const stale = {
      courier: 'steadfast',
      phone: '01700000000',
      consignmentId: 'CG-1',
      configured: true,
      currentStatus: 'pending',
      events: [],
      fetchedAt: '2026-08-01T09:00:00.000Z',
    };
    cache.get.mockResolvedValue(stale); // fast path WOULD return stale — must be bypassed
    prisma.courierReportCache.findUnique.mockResolvedValue({
      report: stale,
      courierStatus: 'pending',
      fetchedAt: new Date('2026-08-01T09:00:00Z'),
      expiresAt: new Date(Date.now() + 300_000),
    });

    const result = await service.getDispatchTracking(
      'steadfast',
      '01700000000',
      'CG-1',
      null,
      { force: true },
    );

    expect(result?.currentStatus).toBe('delivered');
    expect(result?.currentMessage).toBe('Delivered');
    expect(result?.events).toHaveLength(2);
    expect(result?.stale).toBeUndefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // Force fetch persists back into the DB cache (latest state after sync)
    expect(prisma.courierReportCache.upsert).toHaveBeenCalled();
    expect(prisma.courierReportCache.upsert.mock.calls[0][0].update.courierStatus).toBe('delivered');
  });

  it('uses the current Packzy status_by_cid endpoint (legacy /status_by_consignment now 404s)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        delivery_status: 'partial_delivered',
      }),
    });

    const result = await service.getDispatchTracking(
      'steadfast',
      '01700000000',
      '282205529',
      null,
      { force: true },
    );

    const calledUrl = String((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(calledUrl).toContain('/status_by_cid/282205529');
    expect(calledUrl).not.toContain('/status_by_consignment/');
    expect(result?.currentStatus).toBe('partial');
  });

  it('parses the consignment-wrapped response shape', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        consignment: { status: 'delivered_customer' },
      }),
    });

    const result = await service.getDispatchTracking(
      'steadfast',
      '01700000000',
      'CG-1',
      null,
      { force: true },
    );

    expect(result?.currentStatus).toBe('delivered');
  });

  it('falls back to stale DB data when the courier API fails during a force fetch', async () => {
    const staleResult = {
      courier: 'steadfast',
      phone: '01700000000',
      consignmentId: 'CG-1',
      configured: true,
      currentStatus: 'in_transit',
      events: [],
      fetchedAt: '2026-08-02T09:00:00.000Z',
    };
    prisma.courierReportCache.findUnique.mockResolvedValue({
      report: staleResult,
      courierStatus: 'in_transit',
      fetchedAt: new Date('2026-08-02T09:00:00Z'),
      expiresAt: new Date(Date.now() - 1000),
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'upstream error',
    });

    const result = await service.getDispatchTracking(
      'steadfast',
      '01700000000',
      'CG-1',
      null,
      { force: true },
    );

    expect(result?.currentStatus).toBe('in_transit');
    expect(result?.stale).toBe(true);
  });

  it('reports unconfigured couriers without making an API call', async () => {
    prisma.courierCredentials.findUnique.mockResolvedValue({
      ...creds,
      enabled: false,
    });

    const result = await service.getDispatchTracking(
      'steadfast',
      '01700000000',
      'CG-1',
      null,
      { force: true },
    );

    expect(result?.configured).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns null for a missing consignment id', async () => {
    const result = await service.getDispatchTracking(
      'steadfast',
      '01700000000',
      '',
      null,
      { force: true },
    );
    expect(result).toBeNull();
  });

  describe('Pathao — official /orders/{id}/info endpoint (with legacy /tracking fallback)', () => {
    const pathaoCreds = {
      courier: 'pathao',
      enabled: true,
      mode: 'sandbox',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      username: 'user@merchant.com',
      password: 'pass',
      credentials: {},
    };

    function mockTokenResponse() {
      return {
        ok: true,
        json: async () => ({
          token_type: 'Bearer',
          expires_in: 432000,
          access_token: 'TOKEN-123',
          refresh_token: 'REFRESH-1',
        }),
      };
    }

    beforeEach(() => {
      prisma.courierCredentials.findUnique.mockResolvedValue(pathaoCreds);
    });

    it('queries /orders/{id}/info first and parses order_status (official vocabulary)', async () => {
      const calls: any[] = [];
      global.fetch = jest.fn().mockImplementation(async (url: string) => {
        calls.push(String(url));
        if (String(url).includes('issue-token')) return mockTokenResponse();
        return {
          ok: true,
          json: async () => ({
            data: {
              consignment_id: 'P-CG-1',
              merchant_order_id: 'INV-1',
              order_status: 'In Transit',
              order_status_slug: 'In Transit',
              updated_at: '2026-08-10 12:00:00',
            },
          }),
        };
      });

      const result = await service.getDispatchTracking(
        'pathao',
        '01700000000',
        'P-CG-1',
        null,
        { force: true },
      );

      expect(calls.some((u) => u.includes('/orders/P-CG-1/info'))).toBe(true);
      expect(calls.some((u) => u.includes('/orders/P-CG-1/tracking'))).toBe(false);
      expect(result?.currentStatus).toBe('In Transit');
      expect(result?.currentMessage).toBe('In Transit');
      expect(result?.configured).toBe(true);
    });

    it('parses order_status_slug when order_status is absent', async () => {
      global.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (String(url).includes('issue-token')) return mockTokenResponse();
        return {
          ok: true,
          json: async () => ({
            data: {
              consignment_id: 'P-CG-1',
              order_status_slug: 'Delivered',
            },
          }),
        };
      });

      const result = await service.getDispatchTracking(
        'pathao',
        '01700000000',
        'P-CG-1',
        null,
        { force: true },
      );

      expect(result?.currentStatus).toBe('Delivered');
    });

    it('falls back to the legacy /orders/{id}/tracking endpoint on HTTP 404', async () => {
      const calls: any[] = [];
      global.fetch = jest.fn().mockImplementation(async (url: string) => {
        calls.push(String(url));
        if (String(url).includes('issue-token')) return mockTokenResponse();
        if (String(url).includes('/info'))
          return { ok: false, status: 404, text: async () => 'Not Found' };
        return {
          ok: true,
          json: async () => ({
            data: {
              status: 'assign_for_delivery',
              timeline: [
                { status: 'pending', message: 'Order Placed', updated_at: '2026-08-10 09:00:00' },
                { status: 'assign_for_delivery', message: 'Rider assigned', updated_at: '2026-08-10 11:00:00' },
              ],
            },
          }),
        };
      });

      const result = await service.getDispatchTracking(
        'pathao',
        '01700000000',
        'P-CG-1',
        null,
        { force: true },
      );

      expect(calls.some((u) => u.includes('/orders/P-CG-1/tracking'))).toBe(true);
      expect(result?.currentStatus).toBe('assign_for_delivery');
      expect(result?.events).toHaveLength(2);
      expect(result?.events[1].message).toBe('Rider assigned');
    });

    it('uses the persisted token from the shared store instead of re-issuing on every call', async () => {
      // First call: no stored row → issues once. Subsequent calls: the
      // durable CourierAuthToken row is present → no token API call.
      prisma.courierAuthToken.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValue({
          courier: 'pathao',
          accessToken: 'DB-TOKEN',
          refreshToken: 'REFRESH-1',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        });
      global.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (String(url).includes('issue-token')) return mockTokenResponse();
        return {
          ok: true,
          json: async () => ({ data: { order_status: 'Pending' } }),
        };
      });

      await service.getDispatchTracking(
        'pathao',
        '01700000000',
        'P-CG-1',
        null,
        { force: true },
      );
      await service.getDispatchTracking(
        'pathao',
        '01700000000',
        'P-CG-1',
        null,
        { force: true },
      );
      await service.getDispatchTracking(
        'pathao',
        '01700000000',
        'P-CG-1',
        null,
        { force: true },
      );

      const tokenCalls = (global.fetch as jest.Mock).mock.calls.filter((c: any) =>
        String(c[0]).includes('issue-token'),
      );
      expect(tokenCalls.length).toBe(1);
    });
  });
});