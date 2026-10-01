/**
 * Purchase delivery metrics (plan §3.2, §3.4, §9.5).
 *
 * These tests lock the semantic distinctions the whole feature rests on:
 *
 *   Attempts   — HTTP send attempts, incremented per retry (attempt axis).
 *   Dispatched — delivery-target rows that actually sent (row axis, 0 or 1).
 *   Accepted / Rejected / Unknown — row-level verdicts, each derived ONLY from
 *                provider evidence and never by subtracting two other numbers.
 *
 * A retry reuses the same dispatch row, so 2 attempts ending in 1 success is
 * ONE dispatched event that was accepted — never "sent twice".
 */
import { Test } from '@nestjs/testing';
import { OrderOthersService } from '../order-others.service';
import { PrismaService } from '../../prisma/prisma.service';

const SNAPSHOT = {
  id: 's1',
  eventId: 'purchase_o1',
  eventType: 'Purchase',
  eventTime: 1_700_000_000n,
  actionSource: 'website',
  payload: { value: 500, currency: 'BDT', customer: { email: 'a@b.com' } },
  createdAt: new Date(),
  ctxId: null,
};

const ORDER = {
  id: 'o1',
  displayId: 'ORD-1',
  createdAt: new Date(),
  customerId: null,
  guestName: null, guestPhone: null,
  customerEmail: null, customerPhone: null,
  customerFirstName: null, customerLastName: null,
  customerCity: null, customerState: null, customerZip: null,
  customerCountry: 'BD',
  shippingAddress: {}, billingAddress: {},
  ipAddress: null, userAgent: null, trackingSessionId: null,
  source: 'ECOMMERCE', salesChannel: 'WEBSITE',
  sourcePlatform: null, sourceType: null, sourceEntity: null,
  attribution: null,
};

function makePrisma(over: { dispatches?: any[]; events?: any[]; deadOutbox?: number } = {}) {
  return {
    order: { findUnique: jest.fn().mockResolvedValue(ORDER), findFirst: jest.fn().mockResolvedValue(null) },
    trackingSnapshot: {
      findMany: jest.fn().mockResolvedValue([SNAPSHOT]),
      findUnique: jest.fn().mockResolvedValue(SNAPSHOT),
    },
    trackingDispatch: { findMany: jest.fn().mockResolvedValue(over.dispatches ?? []) },
    trackingDispatchEvent: { findMany: jest.fn().mockResolvedValue(over.events ?? []) },
    trackingOutbox: { count: jest.fn().mockResolvedValue(over.deadOutbox ?? 0) },
    customerProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    orderAttribution: { findUnique: jest.fn().mockResolvedValue(null) },
  } as any;
}

const d = (provider: string, destinationId: string, status: string, attemptCount: number, responseBody: string | null) => ({
  provider, destinationId, pixelId: null, status, attemptCount,
  httpStatus: 200, responseBody, errorMsg: null, providerEventId: null,
  payloadSnapshot: null, updatedAt: new Date(), createdAt: new Date(),
});

async function serviceFor(over: { dispatches?: any[]; events?: any[]; deadOutbox?: number } = {}) {
  const prisma = makePrisma(over);
  const moduleRef = await Test.createTestingModule({
    providers: [OrderOthersService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return moduleRef.get(OrderOthersService) as OrderOthersService;
}

async function rowFor(dispatches: any[], events: any[] = []) {
  const svc = await serviceFor({ dispatches, events });
  const out: any = await svc.getForOrder('o1');
  return out.purchase.events[0].dispatches;
}

describe('Purchase delivery metrics', () => {
  it('1 attempt + provider acceptance', async () => {
    const rows = await rowFor([d('meta', 'px', 'SENT', 1, JSON.stringify({ events: [{ event_id: 'e' }] }))]);
    expect(rows[0]).toMatchObject({ attempts: 1, dispatched: 1, accepted: 1, rejected: 0, unknown: 0 });
  });

  it('2 attempts + final success = 2 attempts but ONE dispatched event', async () => {
    // The Part 12 case. A retry reuses the row, so dispatched must stay 1.
    const rows = await rowFor([
      d('meta', 'px', 'SENT', 2, JSON.stringify({ events: [{ event_id: 'e' }] })),
    ]);
    expect(rows[0].attempts).toBe(2);
    expect(rows[0].dispatched).toBe(1);
    expect(rows[0].accepted).toBe(1);
  });

  it('a retry never increments the dispatched-row count', async () => {
    const one = await rowFor([d('meta', 'px', 'SENT', 1, JSON.stringify({ events: [{}] }))]);
    const many = await rowFor([d('meta', 'px', 'SENT', 9, JSON.stringify({ events: [{}] }))]);
    expect(many[0].dispatched).toBe(one[0].dispatched);
    expect(many[0].attempts).toBeGreaterThan(one[0].attempts);
  });

  it('3 attempts, all failed, with the transition log available', async () => {
    const events = [
      { id: '1', provider: 'meta', fromStatus: 'SENDING', toStatus: 'FAILED', attempt: 1, message: 'x', createdAt: new Date() },
      { id: '2', provider: 'meta', fromStatus: 'RETRY', toStatus: 'FAILED', attempt: 2, message: 'x', createdAt: new Date() },
      { id: '3', provider: 'meta', fromStatus: 'RETRY', toStatus: 'FAILED', attempt: 3, message: 'x', createdAt: new Date() },
    ];
    const rows = await rowFor([d('meta', 'px', 'FAILED', 3, null)], events);
    expect(rows[0]).toMatchObject({ attempts: 3, dispatched: 1, failed: 1, rejected: 1, failedAttempts: 3 });
    expect(rows[0].failedAttemptsAvailable).toBe(true);
  });

  it('skipped dispatch reports zero attempts and zero dispatches', async () => {
    const rows = await rowFor([d('meta', 'px', 'SKIPPED', 0, null)]);
    expect(rows[0]).toMatchObject({ attempts: 0, dispatched: 0, skipped: 1, accepted: 0, rejected: 0, unknown: 1 });
  });

  it('a rejected provider response is rejected, not accepted', async () => {
    const body = JSON.stringify({ events: [{ event_id: 'e', errors: [{ code: 2804050 }] }] });
    const rows = await rowFor([d('meta', 'px', 'SENT', 1, body)]);
    expect(rows[0].acceptanceBasis).toBe('rejected');
    expect(rows[0].accepted).toBe(0);
    expect(rows[0].rejected).toBe(1);
  });

  it('unparseable acceptance evidence is unknown, never accepted', async () => {
    const rows = await rowFor([d('meta', 'px', 'SENT', 1, '<html>truncated')]);
    expect(rows[0].acceptanceBasis).toBe('http_accepted');
    expect(rows[0].accepted).toBe(0);
    expect(rows[0].unknown).toBe(1);
  });

  it('multiple destinations on one provider are counted separately', async () => {
    const rows = await rowFor([
      d('meta', 'px-1', 'SENT', 1, JSON.stringify({ events: [{}] })),
      d('meta', 'px-2', 'SENT', 2, JSON.stringify({ events: [{}] })),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ destinationId: 'px-1', dispatched: 1, attempts: 1 });
    expect(rows[1]).toMatchObject({ destinationId: 'px-2', dispatched: 1, attempts: 2 });
  });

  it('never exposes an attempts-minus-accepted metric', async () => {
    const rows = await rowFor([d('meta', 'px', 'SENT', 5, JSON.stringify({ events: [{}] }))]);
    const row = rows[0] as any;
    // Rejected and Unknown are counted from provider evidence, never derived.
    expect(row).not.toHaveProperty('notAccepted');
    expect(row).not.toHaveProperty('attemptsMinusAccepted');
    expect(row).not.toHaveProperty('pending');
    // 5 attempts with 1 acceptance must NOT imply a "4 not accepted" figure.
    expect(Object.keys(row)).not.toContain('notAccepted');
  });

  it('failedAttempts is null (not 0) once the transition log is purged', async () => {
    const svc = await serviceFor({
      dispatches: [d('meta', 'px', 'SENT', 3, null)],
      events: [],
    });
    // Force the order to look older than the 30-day transition-log horizon.
    (svc as any).prisma.order.findUnique.mockResolvedValue({
      ...ORDER,
      createdAt: new Date(Date.now() - 60 * 86_400_000),
    });
    const out: any = await svc.getForOrder('o1');
    const row = out.purchase.events[0].dispatches[0];
    expect(row.failedAttempts).toBeNull();
    expect(row.failedAttemptsAvailable).toBe(false);
    expect(row.attempts).toBe(3);
  });

  it('a DEAD outbox is reported separately, never folded into dispatch rows', async () => {
    const svc = await serviceFor({ dispatches: [d('meta', 'px', 'SENT', 1, null)], deadOutbox: 2 });
    const out: any = await svc.getForOrder('o1');
    expect(out.purchase.events[0].outbox.dead).toBe(2);
    // No dispatch row may claim DEAD — that is an outbox-only status.
    expect(out.purchase.events[0].dispatches.some((r: any) => r.status === 'DEAD')).toBe(false);
  });

  it('one order yields at most one Purchase snapshot (unique event identity)', async () => {
    // TrackingSnapshot @@unique([orderId, eventType]) makes two independent
    // Purchase snapshots for one order impossible; the read model returns the
    // single canonical event rather than inventing a second.
    const svc = await serviceFor({ dispatches: [] });
    const out: any = await svc.getForOrder('o1');
    expect(out.purchase.events).toHaveLength(1);
    expect(out.purchase.events[0].eventType).toBe('Purchase');
  });

  it('never labels the acceptance column as "Delivered"', async () => {
    const svc = await serviceFor({
      dispatches: [
        d('meta', 'px', 'SENT', 1, JSON.stringify({ events: [{}] })),
        d('ga4', 'g', 'SENT', 1, '{}'),
      ],
    });
    const out: any = await svc.getForOrder('o1');
    expect(out.purchase.events[0].acceptanceColumnLabel).not.toMatch(/delivered/i);
  });
});
