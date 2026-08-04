import { CourierManagerService } from '../courier-manager.service';

describe('CourierManagerService — Steadfast dispatch error handling', () => {
  let service: CourierManagerService;
  let prisma: any;
  const originalFetch = global.fetch;

  const creds = {
    courier: 'steadfast',
    enabled: true,
    mode: 'production',
    apiKey: 'test-api-key',
    secretKey: 'test-secret-key',
    credentials: {},
  };

  const order = {
    id: 'order-1',
    displayId: 'ORD-1',
    total: 500,
    guestPhone: null,
    guestName: null,
    officeNotes: null,
    shippingAddress: { address: 'Dhaka', district: 'Dhaka', deliveryType: 'home' },
    customer: { name: 'Test', phone: '01712345678', email: null },
    items: [{ product: { name: 'Item' } }],
  };

  beforeEach(() => {
    prisma = {
      courierCredentials: { findUnique: jest.fn().mockResolvedValue(creds) },
      order: {
        findMany: jest.fn().mockResolvedValue([order]),
        update: jest.fn().mockResolvedValue(order),
      },
      dispatch: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      courierDispatchLog: { create: jest.fn().mockResolvedValue({}) },
      systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    service = new CourierManagerService(prisma as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(res: Response) {
    global.fetch = jest.fn().mockResolvedValue(res);
  }

  it('surfaces a plain-text 401 body (account inactive) instead of an empty non-JSON message', async () => {
    mockFetch(new Response('Account is not active!', { status: 401 }));

    const results = await service.dispatch('steadfast', ['order-1']);

    expect(results[0].ok).toBe(false);
    expect(results[0].message).toContain('Account is not active!');
    expect(results[0].message).not.toContain('non-JSON response (HTTP 401): ');
  });

  it('does not retry a permanent 4xx Steadfast error', async () => {
    mockFetch(new Response('Account is not active!', { status: 401 }));

    await service.dispatch('steadfast', ['order-1']);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces the Steadfast error message from a JSON 401 body without retrying', async () => {
    mockFetch(
      new Response(
        JSON.stringify({ status: 401, message: 'Unauthorized Access (invalid API credentials)' }),
        { status: 401 },
      ),
    );

    const results = await service.dispatch('steadfast', ['order-1']);

    expect(results[0].ok).toBe(false);
    expect(results[0].message).toContain('Unauthorized Access');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('still records a successful dispatch for a 200 response', async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          status: 200,
          consignment: {
            consignment_id: 'CID-1',
            tracking_code: 'TC-1',
            tracking_link: 'https://track/1',
          },
        }),
        { status: 200 },
      ),
    );

    const results = await service.dispatch('steadfast', ['order-1']);

    expect(results[0].ok).toBe(true);
    expect(results[0].consignmentId).toBe('CID-1');
    expect(results[0].trackingCode).toBe('TC-1');
    expect(prisma.order.update).toHaveBeenCalled();
    expect(prisma.dispatch.upsert).toHaveBeenCalled();
  });

  it('surfaces a plain-text error body from jsonFetch (get_balance)', async () => {
    mockFetch(new Response('Account is not active!', { status: 401 }));

    await expect(service.getSteadfastBalance()).rejects.toThrow(/Account is not active!/);
  });

  // --- Hotfix 1: full formatted shipping address ---

  it('sends the full formatted shipping address to Steadfast (not just the district)', async () => {
    prisma.order.findMany.mockResolvedValue([
      {
        ...order,
        shippingAddress: {
          addressLine: 'House 12, Road 5',
          thana: 'Dhanmondi',
          district: 'Dhaka',
          division: 'Dhaka Division',
          postCode: '1205',
        },
      },
    ]);
    mockFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await service.dispatch('steadfast', ['order-1']);

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.recipient_address).toBe(
      'House 12, Road 5, Dhanmondi, Dhaka, Dhaka Division, 1205',
    );
  });

  // --- Hotfix 2: effective courier office note ---

  it('legacy order with NULL office note dispatches with NO note (no silent default inheritance)', async () => {
    (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
      key: 'default_office_note',
      value: 'handle-with-care', // a LATER default must not leak into existing orders
    });
    prisma.order.findMany.mockResolvedValue([{ ...order, officeNotes: null }]);
    mockFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await service.dispatch('steadfast', ['order-1']);

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.note).toBeUndefined();
    expect(body.note).not.toBe('handle-with-care');
  });

  it('sends the order override office note when set', async () => {
    (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
      key: 'default_office_note',
      value: 'default',
    });
    prisma.order.findMany.mockResolvedValue([{ ...order, officeNotes: 'override' }]);
    mockFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await service.dispatch('steadfast', ['order-1']);

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.note).toBe('override');
  });

  it('an explicit empty office note is authoritative (default is NOT applied)', async () => {
    (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
      key: 'default_office_note',
      value: 'default',
    });
    prisma.order.findMany.mockResolvedValue([{ ...order, officeNotes: '' }]);
    mockFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await service.dispatch('steadfast', ['order-1']);

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.note).toBeUndefined();
  });
});
