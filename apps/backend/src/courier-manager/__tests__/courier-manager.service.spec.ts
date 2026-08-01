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
});
