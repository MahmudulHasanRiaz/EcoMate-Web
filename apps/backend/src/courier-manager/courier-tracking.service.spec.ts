import { Test, TestingModule } from '@nestjs/testing';
import { CourierTrackingService } from './courier-tracking.service';
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
});