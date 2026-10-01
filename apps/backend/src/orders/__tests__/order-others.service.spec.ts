import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { OrderOthersService } from '../order-others.service';
import { PrismaService } from '../../prisma/prisma.service';

const DAY = 86_400_000;

function makePrisma(overrides: any = {}) {
  const baseOrder = {
    id: 'o1', displayId: 'ORD-1', createdAt: new Date(), customerId: 'c1',
    guestName: 'Rahim Uddin', guestPhone: '+8801711111111',
    customerEmail: 'rahim@example.com', customerPhone: '+8801711111111',
    customerFirstName: 'Rahim', customerLastName: 'Uddin',
    customerCity: 'Dhaka', customerState: 'Dhaka', customerZip: '1216',
    customerCountry: 'BD',
    shippingAddress: { addressLine: 'House 12', district: 'Dhaka' },
    billingAddress: {},
    ipAddress: '203.0.113.9', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120',
    trackingSessionId: 'ctx-1', source: 'ECOMMERCE', salesChannel: 'WEBSITE',
    sourcePlatform: 'FACEBOOK', sourceType: 'AD', sourceEntity: null,
    attribution: null,
    ...(overrides.order ?? {}),
  };

  return {
    order: {
      findUnique: jest.fn().mockResolvedValue(baseOrder),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    trackingSnapshot: {
      findMany: jest.fn().mockResolvedValue([]),
      // buildEvent re-reads the row it was handed an id for.
      findUnique: jest.fn(async ({ where }: any) => (overrides.snapshotById ?? {})[where.id] ?? null),
    },
    trackingDispatch: { findMany: jest.fn().mockResolvedValue([]) },
    trackingDispatchEvent: { findMany: jest.fn().mockResolvedValue([]) },
    trackingOutbox: { count: jest.fn().mockResolvedValue(0) },
    customerProfile: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1', name: 'Rahim Uddin', phone: '+8801711111111',
        email: 'rahim@example.com', createdAt: new Date(),
        lastOrderAt: new Date(), lastOrderIp: '203.0.113.9',
        customerAddresses: [],
      }),
    },
    orderAttribution: { findUnique: jest.fn().mockResolvedValue(null) },
    ...(overrides.rest ?? {}),
  } as any;
}

async function buildService(prisma: any) {
  const moduleRef = await Test.createTestingModule({
    providers: [OrderOthersService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return moduleRef.get(OrderOthersService);
}

const SNAPSHOT_BASE = {
  id: 's1', eventId: 'purchase_o1', eventType: 'Purchase',
  eventTime: 1_700_000_000n, actionSource: 'website',
  payload: {}, createdAt: new Date(), ctxId: 'ctx-1',
};

describe('OrderOthersService', () => {
  it('throws NotFound for a missing order', async () => {
    const prisma = makePrisma();
    prisma.order.findUnique = jest.fn().mockResolvedValue(null);
    const service = await buildService(prisma);
    await expect(service.getForOrder('missing')).rejects.toThrow(NotFoundException);
  });

  it('returns the order snapshot separately from the customer profile', async () => {
    const service = await buildService(makePrisma());
    const out: any = await service.getForOrder('o1');
    const snap = out.sections.snapshot;
    expect(snap.find((x: any) => x.key === 'customerName').value).toBe('Rahim Uddin');
    expect(out.customerProfile.name).toBe('Rahim Uddin');
    // Explicit separation is part of the contract.
    expect(out.sections.snapshot).not.toBe(out.sections.customerProfile);
  });

  it('surfaces a snapshot-vs-profile divergence in fieldDiffs', async () => {
    const prisma = makePrisma();
    prisma.customerProfile.findUnique.mockResolvedValue({
      id: 'c1', name: 'Md Rahim', phone: '+8801711111111', email: 'new@example.com',
      createdAt: new Date(), lastOrderAt: new Date(), lastOrderIp: '1.1.1.1',
      customerAddresses: [],
    });
    const service = await buildService(prisma);
    const out: any = await service.getForOrder('o1');
    const diffKeys = out.customerProfile.fieldDiffs.map((d: any) => d.key).sort();
    expect(diffKeys).toEqual(['email', 'name']);
    const nameDiff = out.customerProfile.fieldDiffs.find((d: any) => d.key === 'name');
    expect(nameDiff.snapshotValue).toBe('Rahim Uddin');
    expect(nameDiff.currentValue).toBe('Md Rahim');
  });

  it('reports no attribution signal when the column is null', async () => {
    const service = await buildService(makePrisma());
    const out: any = await service.getForOrder('o1');
    expect(out.sections.attributionRaw[0].state).toBe('not_collected');
  });

  it('separates raw attribution from resolved attribution', async () => {
    const prisma = makePrisma();
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1', displayId: 'ORD-1', createdAt: new Date(), customerId: 'c1',
      guestName: null, guestPhone: null, customerEmail: null, customerPhone: null,
      customerFirstName: null, customerLastName: null, customerCity: null,
      customerState: null, customerZip: null, customerCountry: 'BD',
      shippingAddress: {}, billingAddress: {},
      ipAddress: '1.1.1.1', userAgent: 'UA', trackingSessionId: 'ctx',
      source: 'ECOMMERCE', salesChannel: 'WEBSITE',
      sourcePlatform: 'FACEBOOK', sourceType: 'AD', sourceEntity: null,
      attribution: {
        utm: { source: 'facebook', medium: 'cpc', campaign: 'eid', content: null, term: null },
        clickIds: { fbclid: 'abc' },
        referrer: 'https://fb.com', landingUrl: 'https://shop/x',
        device: { timezone: 'Asia/Dhaka' },
        resolved: { platform: 'FACEBOOK', type: 'AD' },
        touch: { firstSeenAt: null, ageDays: 2, windowDays: 30, withinWindow: true },
        capturedAt: new Date().toISOString(),
      },
    });
    prisma.orderAttribution.findUnique.mockResolvedValue({
      method: 'fbclid', confidence: 95, explanation: 'session match',
      attributionVersion: 1, attributedAt: new Date(), sessionId: 's1',
      campaignId: 'c-1', adSetId: null, adId: null,
      campaign: { name: 'Eid Sale' }, adSet: null, ad: null,
    });
    const service = await buildService(prisma);
    const out: any = await service.getForOrder('o1');

    const raw = out.sections.attributionRaw;
    expect(raw.find((x: any) => x.key === 'utmSource').value).toBe('facebook');

    const resolved = out.sections.attributionResolved;
    expect(resolved.find((x: any) => x.key === 'method').value).toBe('fbclid');
    expect(resolved.find((x: any) => x.key === 'campaign').value).toBe('Eid Sale');
  });

  it('marks the transition log unavailable past the retention horizon', async () => {
    const prisma = makePrisma();
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1', displayId: 'ORD-1',
      createdAt: new Date(Date.now() - 45 * DAY), // older than 30 days
      customerId: 'c1', guestName: null, guestPhone: null,
      customerEmail: null, customerPhone: null, customerFirstName: null,
      customerLastName: null, customerCity: null, customerState: null,
      customerZip: null, customerCountry: 'BD', shippingAddress: {},
      billingAddress: {}, ipAddress: null, userAgent: null, trackingSessionId: null,
      source: 'ECOMMERCE', salesChannel: 'WEBSITE', sourcePlatform: null,
      sourceType: null, sourceEntity: null, attribution: null,
    });
    const service = await buildService(prisma);
    const out: any = await service.getForOrder('o1');
    expect(out.retention.transitionLogAvailable).toBe(false);
    expect(out.retention.transitionLogPurgeDays).toBe(30);
    expect(out.retention.dispatchRetentionDays).toBe(365);
  });

  it('never returns a credential field, and redacts the raw view', async () => {
    const prisma = makePrisma({ snapshotById: { s1: { ...SNAPSHOT_BASE, payload: { value: 100, currency: 'BDT', access_token: 'LEAK_ME' } } } });
    prisma.trackingSnapshot.findMany.mockResolvedValue([{ ...SNAPSHOT_BASE, payload: { value: 100, currency: 'BDT', access_token: 'LEAK_ME' } }]);
    prisma.trackingDispatch.findMany.mockResolvedValue([{
      id: 'd1', provider: 'meta', destinationId: 'default', pixelId: 'px1',
      status: 'SENT', attemptCount: 2, httpStatus: 200,
      responseBody: '{"events":[{"event_id":"e1"}]}', errorMsg: null,
      providerEventId: 'e1',
      payloadSnapshot: {
        value: { event_name: 'Purchase', api_key: 'LEAK_ME_TOO' },
        truncated: false, redactedPaths: ['api_key'],
      },
      updatedAt: new Date(), createdAt: new Date(),
    }]);

    const service = await buildService(prisma);
    const out: any = await service.getForOrder('o1');
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('LEAK_ME_TOO');
    expect(serialized).not.toContain('api_key":"LEAK_ME');
  });

  it('exposes failedAttempts as null (not 0) when the transition log is gone', async () => {
    const prisma = makePrisma({
      snapshotById: { s1: SNAPSHOT_BASE },
      order: {
        id: 'o1', displayId: 'ORD-1',
        createdAt: new Date(Date.now() - 60 * DAY),
        customerId: null, guestName: null, guestPhone: null, customerEmail: null,
        customerPhone: null, customerFirstName: null, customerLastName: null,
        customerCity: null, customerState: null, customerZip: null,
        customerCountry: 'BD', shippingAddress: {}, billingAddress: {},
        ipAddress: null, userAgent: null, trackingSessionId: null,
        source: 'ECOMMERCE', salesChannel: 'WEBSITE', sourcePlatform: null,
        sourceType: null, sourceEntity: null, attribution: null,
      },
    });
    prisma.trackingSnapshot.findMany.mockResolvedValue([SNAPSHOT_BASE]);
    prisma.trackingDispatch.findMany.mockResolvedValue([{
      id: 'd1', provider: 'meta', destinationId: 'default', pixelId: null,
      status: 'SENT', attemptCount: 3, httpStatus: 200, responseBody: null,
      errorMsg: null, providerEventId: null, payloadSnapshot: null,
      updatedAt: new Date(), createdAt: new Date(),
    }]);
    prisma.trackingDispatchEvent.findMany.mockResolvedValue([]);

    const service = await buildService(prisma);
    const out: any = await service.getForOrder('o1');
    const row = out.purchase.events[0].dispatches[0];
    // NOT 0 — 0 would falsely imply no attempt ever failed.
    expect(row.failedAttempts).toBeNull();
    expect(row.failedAttemptsAvailable).toBe(false);
    // The durable attempt count is still exact.
    expect(row.attempts).toBe(3);
    expect(row.dispatched).toBe(1);
  });

  it('never exposes an attempts-minus-accepted derived metric', async () => {
    const prisma = makePrisma({ snapshotById: { s1: SNAPSHOT_BASE } });
    prisma.trackingSnapshot.findMany.mockResolvedValue([SNAPSHOT_BASE]);
    prisma.trackingDispatch.findMany.mockResolvedValue([{
      id: 'd1', provider: 'meta', destinationId: 'default', pixelId: null,
      status: 'SENT', attemptCount: 3, httpStatus: 200,
      responseBody: '{"events":[{"event_id":"e1"}]}', errorMsg: null,
      providerEventId: null, payloadSnapshot: null,
      updatedAt: new Date(), createdAt: new Date(),
    }]);
    prisma.trackingDispatchEvent.findMany.mockResolvedValue([
      { id: 'e1', provider: 'meta', fromStatus: 'SENDING', toStatus: 'FAILED', attempt: 1, message: 'x', createdAt: new Date() },
      { id: 'e2', provider: 'meta', fromStatus: 'RETRY', toStatus: 'SENT', attempt: 3, message: 'y', createdAt: new Date() },
    ]);

    const service = await buildService(prisma);
    const out: any = await service.getForOrder('o1');
    const row = out.purchase.events[0].dispatches[0];
    // 3 attempts but ONE dispatch row: retry is not a second business event.
    expect(row.attempts).toBe(3);
    expect(row.dispatched).toBe(1);
    expect(row.accepted).toBe(1);
    expect(row.acceptanceBasis).toBe('accepted');
    expect(row.failedAttempts).toBe(1);
    // The meaningless subtraction is simply not a field.
    expect(row).not.toHaveProperty('notAccepted');
    expect(row).not.toHaveProperty('attemptsMinusAccepted');
  });

  it('queries by displayId, not the internal UUID', async () => {
    const prisma = makePrisma();
    await buildService(prisma).then((s) => s.getForOrder('o1'));
    expect(prisma.trackingSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: 'ORD-1' } }),
    );
  });

  it('never selects credential tables', async () => {
    const prisma = makePrisma();
    const service = await buildService(prisma);
    await service.getForOrder('o1');
    // The service must not even have a handle on credential models.
    expect((prisma as any).courierCredentials).toBeUndefined();
    expect((prisma as any).marketingConnection).toBeUndefined();
  });

  it('derives browser and OS from the stored User-Agent', async () => {
    const service = await buildService(makePrisma());
    const out: any = await service.getForOrder('o1');
    const device = out.sections.device;
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const prisma2 = makePrisma();
    prisma2.order.findUnique.mockResolvedValue({
      id: 'o1', displayId: 'ORD-1', createdAt: new Date(), customerId: null,
      guestName: null, guestPhone: null, customerEmail: null, customerPhone: null,
      customerFirstName: null, customerLastName: null, customerCity: null,
      customerState: null, customerZip: null, customerCountry: 'BD',
      shippingAddress: {}, billingAddress: {}, ipAddress: '1.1.1.1', userAgent: ua,
      trackingSessionId: null, source: 'ECOMMERCE', salesChannel: 'WEBSITE',
      sourcePlatform: null, sourceType: null, sourceEntity: null, attribution: null,
    });
    const out2: any = await (await buildService(prisma2)).getForOrder('o1');
    const d2 = out2.sections.device;
    expect(d2.find((x: any) => x.key === 'browser').value).toBe('Chrome');
    expect(d2.find((x: any) => x.key === 'os').value).toBe('Windows');
    expect(d2.find((x: any) => x.key === 'deviceType').value).toBe('desktop');
    // Never collected stays honest rather than being invented.
    expect(d2.find((x: any) => x.key === 'screen').state).toBe('null');
    expect(device.length).toBeGreaterThan(0);
  });
});
