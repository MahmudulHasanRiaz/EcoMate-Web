import { CourierManagerService } from '../courier-manager.service';
import { mapCourierStatusToDispatchStatus } from '../courier-status-mapper';
import { norm, matchRow, emptyIndexes } from '../../courier-settlement/reconciliation/matcher';

/**
 * Task 10 — settlement hardening (TDD RED first).
 * Owner-locked:
 *  (1) approval_pending NEVER settles — only delivered/partial_delivered/
 *      cancelled count. Anything ending `_approval_pending` (+ `exceptional`)
 *      must never resolve to DELIVERED via mapper fallback.
 *  (2) Truncation/strip: payload builders pre-check lengths (invoice 100,
 *      name 100, phone 40, address 490, note 480 — Steadfast doc values;
 *      per-courier overrides noted) + strip `{ } ; < > $` → space.
 *  (3) 401-no-loop on all dispatch paths; same-invoice retry idempotency
 *      for pathao merchant_order_id / redx merchant_invoice / carrybee
 *      merchant_order_id.
 */
describe('Task 10 — mapper approval_pending exclusion', () => {
  it('exchanged_approval_pending never resolves to DELIVERED', () => {
    expect(mapCourierStatusToDispatchStatus('pathao', 'exchanged_approval_pending')).toBeNull();
  });

  it('unknown *_approval_pending labels never resolve via keyword fallback', () => {
    expect(mapCourierStatusToDispatchStatus('pathao', 'some_new_approval_pending')).toBeNull();
    expect(mapCourierStatusToDispatchStatus('steadfast', 'future_approval_pending')).toBeNull();
    expect(mapCourierStatusToDispatchStatus('redx', 'custom_approval_pending')).toBeNull();
    expect(mapCourierStatusToDispatchStatus('carrybee', 'custom_approval_pending')).toBeNull();
  });

  it('exceptional never resolves to a workflow status', () => {
    expect(mapCourierStatusToDispatchStatus('steadfast', 'exceptional')).toBeNull();
  });

  it('confirmed delivered still resolves (no over-blocking)', () => {
    expect(mapCourierStatusToDispatchStatus('steadfast', 'delivered')).toBe('DELIVERED');
    expect(mapCourierStatusToDispatchStatus('pathao', 'order.delivered')).toBe('DELIVERED');
  });

  it('partial_delivered_approval_pending keeps PARTIAL (T5 locked)', () => {
    expect(mapCourierStatusToDispatchStatus('steadfast', 'partial_delivered_approval_pending')).toBe('PARTIAL');
  });
});

describe('Task 10 — payload truncation/strip', () => {
  let service: CourierManagerService;
  let prisma: any;
  const tokenStore: any = { getAccessToken: jest.fn().mockResolvedValue('TOK') };
  const originalFetch = global.fetch;

  function credsFor(courier: string) {
    return {
      courier,
      enabled: true,
      mode: 'sandbox',
      apiKey: 'test-api-key',
      secretKey: 'test-secret-key',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      clientContext: 'merchant',
      username: 'user@merchant.com',
      password: 'pass',
      storeId: '1',
      credentials: {},
    };
  }

  const longName = 'A'.repeat(150);
  const evilAddress = 'House 1 {Flat 2}; Road <3> $4 '.repeat(30); // >490 chars + stripped chars
  const evilNote = 'note {with}; <evil> $chars '.repeat(30); // >480 chars + stripped chars

  function evilOrder(displayId = 'ORD-1'): any {
    return {
      id: 'order-1',
      displayId,
      total: 500,
      payments: [],
      customerFirstName: longName,
      customerLastName: '',
      customerPhone: '01712345678',
      customerEmail: null,
      guestName: null,
      guestPhone: null,
      secondaryPhone: null,
      officeNotes: evilNote,
      shippingAddress: { address: evilAddress, district: 'Dhaka', deliveryType: 'home', deliveryAreaId: 12 },
      customer: { name: longName, phone: '01712345678', email: null },
      items: [{ product: { name: 'Item {evil}; $x' }, price: 500 }],
    };
  }

  beforeEach(() => {
    prisma = {
      courierCredentials: {
        findUnique: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(credsFor(where.courier)),
        ),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ timeline: [] }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      dispatch: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn().mockResolvedValue({}) },
      courierDispatchLog: { create: jest.fn().mockResolvedValue({}) },
      systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    service = new CourierManagerService(prisma as any, tokenStore as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('pathao builder: name ≤100, phone ≤40, address ≤220 (Pathao doc cap, owner Q10), no { } ; < > $', () => {
    const payload: any = service.buildPathaoOrderPayload(evilOrder(), '1');
    expect(String(payload.recipient_name).length).toBeLessThanOrEqual(100);
    expect(String(payload.recipient_phone).length).toBeLessThanOrEqual(40);
    expect(String(payload.recipient_address).length).toBeLessThanOrEqual(220);
    for (const v of [payload.recipient_name, payload.recipient_address, payload.merchant_order_id]) {
      expect(String(v)).not.toMatch(/[{}$;<>]/);
    }
    expect(String(payload.merchant_order_id).length).toBeLessThanOrEqual(100);
  });

  it('pathao builder: item_weight from product weightGram, 0.5 kg fallback, 10 kg clamp (owner Q12)', () => {
    const weighted = evilOrder();
    weighted.items = [
      { product: { name: 'A', weightGram: 800 }, price: 100, quantity: 2 },
    ];
    expect(
      (service.buildPathaoOrderPayload(weighted, '1') as any).item_weight,
    ).toBe(1.6);

    const unweighted = evilOrder();
    expect(
      (service.buildPathaoOrderPayload(unweighted, '1') as any).item_weight,
    ).toBe(0.5);

    const heavy = evilOrder();
    heavy.items = [
      { product: { name: 'B', weightGram: 30000 }, price: 100, quantity: 1 },
    ];
    expect(
      (service.buildPathaoOrderPayload(heavy, '1') as any).item_weight,
    ).toBe(10);
  });

  it('steadfast dispatch: invoice/name/phone/address/note truncated + stripped', async () => {
    const order = evilOrder('ORD-' + 'X'.repeat(150));
    prisma.order.findMany.mockResolvedValue([order]);
    prisma.dispatch.findMany.mockResolvedValue([]);
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 200,
          consignment: { consignment_id: 'CID-1', tracking_code: 'TC-1', tracking_link: 'https://track/1' },
        }),
        { status: 200 },
      ),
    );
    const results = await service.dispatch('steadfast', ['order-1']);
    expect(results[0].ok).toBe(true);
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(String(body.invoice).length).toBeLessThanOrEqual(100);
    expect(String(body.recipient_name).length).toBeLessThanOrEqual(100);
    expect(String(body.recipient_phone).length).toBeLessThanOrEqual(40);
    expect(String(body.recipient_address).length).toBeLessThanOrEqual(490);
    expect(String(body.note).length).toBeLessThanOrEqual(480);
    for (const v of [body.invoice, body.recipient_name, body.recipient_address, body.note]) {
      expect(String(v)).not.toMatch(/[{}$;<>]/);
    }
  });

  it('sync matcher norm() tolerates server-cut text (truncate 100 + case-insensitive)', () => {
    const full = 'ORD-' + 'X'.repeat(150);
    const cut = full.slice(0, 100);
    expect(norm(full)).toBe(norm(cut));
    const idx = emptyIndexes();
    idx.orderByDisplayId.set(norm(cut), { id: 'o1' });
    const r = matchRow({ rowNumber: 1, displayId: full }, ['displayId'], idx);
    expect(r.orderId).toBe('o1');
  });
});

describe('Task 10 — 401-no-loop + invoice uniqueness on all couriers', () => {
  let service: CourierManagerService;
  let prisma: any;
  const tokenStore: any = { getAccessToken: jest.fn().mockResolvedValue('TOK') };
  const originalFetch = global.fetch;

  function credsFor(courier: string) {
    return {
      courier,
      enabled: true,
      mode: 'sandbox',
      apiKey: 'test-api-key',
      secretKey: 'test-secret-key',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      clientContext: 'merchant',
      username: 'user@merchant.com',
      password: 'pass',
      storeId: '1',
      credentials: {},
    };
  }

  const order: any = {
    id: 'order-1',
    displayId: 'ORD-1',
    total: 500,
    payments: [],
    customerFirstName: 'Test',
    customerLastName: 'User',
    customerPhone: '01712345678',
    customerEmail: null,
    guestName: null,
    guestPhone: null,
    secondaryPhone: null,
    officeNotes: null,
    shippingAddress: { address: 'House 1, Road 2, Dhaka', district: 'Dhaka', deliveryType: 'home', deliveryAreaId: 12 },
    customer: { name: 'Test', phone: '01712345678', email: null },
    items: [{ product: { name: 'Item' }, price: 500 }],
  };

  beforeEach(() => {
    prisma = {
      courierCredentials: {
        findUnique: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(credsFor(where.courier)),
        ),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([order]),
        findUnique: jest.fn().mockResolvedValue({ timeline: [] }),
        findFirst: jest.fn().mockResolvedValue({ id: 'order-1' }),
        update: jest.fn().mockResolvedValue(order),
      },
      dispatch: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
      courierDispatchLog: { create: jest.fn().mockResolvedValue({}) },
      systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    service = new CourierManagerService(prisma as any, tokenStore as any);
    tokenStore.getAccessToken.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it.each(['pathao', 'redx', 'carrybee'])('%s: 401 never retried (attempts==1) with fix-keys hint', async (courier) => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }),
    );
    const results = await service.dispatch(courier, ['order-1']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].status).toBe(401);
    expect(results[0].message).toMatch(/fix.*keys.*do not retry/i);
  });

  it.each(['pathao', 'redx', 'carrybee'])('%s: 429 never retried with back-off hint', async (courier) => {
    global.fetch = jest.fn().mockResolvedValue(new Response('Too many', { status: 429 }));
    const results = await service.dispatch(courier, ['order-1']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].status).toBe(429);
    expect(results[0].message).toMatch(/back ?off|do not retry/i);
  });

  it('pathao retry reuses the same merchant_order_id', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { consignment_id: 'C1' } }), { status: 200 }),
      );
    const results = await service.dispatch('pathao', ['order-1']);
    expect(results[0].ok).toBe(true);
    const bodies = (global.fetch as jest.Mock).mock.calls.map((c: any) => JSON.parse(c[1].body));
    expect(bodies[0].merchant_order_id).toBe('ORD-1');
    expect(bodies[1].merchant_order_id).toBe('ORD-1');
  });

  it('redx retry reuses the same merchant_invoice_id', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tracking_id: 'RX-1' }), { status: 200 }),
      );
    const results = await service.dispatch('redx', ['order-1']);
    expect(results[0].ok).toBe(true);
    const bodies = (global.fetch as jest.Mock).mock.calls.map((c: any) => JSON.parse(c[1].body));
    expect(bodies[0].merchant_invoice_id).toBe('ORD-1');
    expect(bodies[1].merchant_invoice_id).toBe('ORD-1');
  });

  it('carrybee retry reuses the same merchant_order_id', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: false, data: { order: { consignment_id: 'CB-1' } } }),
          { status: 201 },
        ),
      );
    const results = await service.dispatch('carrybee', ['order-1']);
    expect(results[0].ok).toBe(true);
    const bodies = (global.fetch as jest.Mock).mock.calls.map((c: any) => JSON.parse(c[1].body));
    expect(bodies[0].merchant_order_id).toBe('ORD-1');
    expect(bodies[1].merchant_order_id).toBe('ORD-1');
  });
});
