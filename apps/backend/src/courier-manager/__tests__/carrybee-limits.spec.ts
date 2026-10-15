import { CourierManagerService } from '../courier-manager.service';

/**
 * Review blockers: Carrybee silent clamps must become pre-flight rejections.
 * RED phase — these tests MUST fail before the fix (clamp sends, no throw).
 */
describe('Carrybee over-limit pre-flight rejections', () => {
  const originalFetch = global.fetch;
  const tokenStore: any = {
    getAccessToken: jest.fn().mockResolvedValue('TOK'),
  };

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

  const baseOrder: any = {
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
    shippingAddress: { address: 'House 5, Road 3, Banani', district: 'Dhaka' },
    customer: { name: 'Test', phone: '01712345678', email: null },
    items: [{ product: { name: 'Item' } }],
  };

  let prisma: any;
  let service: CourierManagerService;

  function orderWith(overrides: Record<string, unknown>) {
    return { ...baseOrder, ...overrides };
  }

  beforeEach(() => {
    prisma = {
      courierCredentials: {
        findUnique: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(credsFor(where.courier)),
        ),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([baseOrder]),
        findUnique: jest.fn().mockResolvedValue({ timeline: [] }),
        findFirst: jest.fn().mockResolvedValue({ id: 'order-1' }),
        update: jest.fn().mockResolvedValue(baseOrder),
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

  it('HIGH: 150001 COD order throws before fetch; message names collectable_amount + 100000', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderWith({ total: 150001, payments: [] }),
    ]);
    global.fetch = jest.fn();

    const results = await service.dispatch('carrybee', ['order-1']);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(results[0].ok).toBe(false);
    expect(results[0].message).toContain('collectable_amount');
    expect(results[0].message).toContain('100000');
  });

  it('MEDIUM: order with >200 lines is rejected before fetch', async () => {
    prisma.order.findMany.mockResolvedValue([
      orderWith({
        items: Array.from({ length: 201 }, (_, i) => ({
          product: { name: `Item ${i}` },
        })),
      }),
    ]);
    global.fetch = jest.fn();

    const results = await service.dispatch('carrybee', ['order-1']);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(results[0].ok).toBe(false);
    expect(results[0].message).toContain('item_quantity');
    expect(results[0].message).toContain('200');
  });

  it("LOW-a: empty-string cityId is omitted (never sent as 0)", async () => {
    prisma.order.findMany.mockResolvedValue([
      orderWith({
        shippingAddress: {
          address: 'House 5, Road 3, Banani',
          district: 'Dhaka',
          cityId: '',
          zoneId: '',
          areaId: '',
        },
      }),
    ]);
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: false,
          message: 'Order created successfully',
          data: { order: { consignment_id: 'CB-1' } },
        }),
        { status: 201 },
      ),
    );

    const results = await service.dispatch('carrybee', ['order-1']);

    expect(results[0].ok).toBe(true);
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).not.toHaveProperty('city_id');
    expect(body).not.toHaveProperty('zone_id');
    expect(body).not.toHaveProperty('area_id');
  });
});
