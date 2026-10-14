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
    customerFirstName: 'Test',
    customerLastName: 'User',
    customerPhone: null,
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

  it('persists dispatch-time courierAmount on the dispatch row (COD alert source of truth)', async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          status: 200,
          consignment: {
            consignment_id: 'CID-9',
            tracking_code: 'TC-9',
            tracking_link: 'https://track/9',
          },
        }),
        { status: 200 },
      ),
    );

    await service.dispatch('steadfast', ['order-1']);

    // Fixture order: total 500, no payments → collectable 500 (same value as cod_amount sent).
    expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ courierAmount: 500 }),
      }),
    );
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

  describe('getCollectableAmount', () => {
    it('returns 0 when order is already fully PAID', () => {
      expect(service.getCollectableAmount({ total: 1000, paymentStatus: 'PAID' })).toBe(0);
      expect(service.getCollectableAmount({ total: 1000, paymentOptionType: 'FULL_PAYMENT' })).toBe(0);
    });

    it('subtracts verified PAID advance payments from total', () => {
      const partialOrder = {
        total: 1000,
        paymentStatus: 'PARTIAL_PAID',
        paymentOptionType: 'PARTIAL_PAYMENT',
        payments: [
          { status: 'PAID', amount: 250 },
          { status: 'UNPAID', amount: 750 },
        ],
      };
      expect(service.getCollectableAmount(partialOrder)).toBe(750);
    });

    it('falls back to partialAmount if payment rows are not loaded', () => {
      const partialOrder = {
        total: 1000,
        paymentStatus: 'PARTIAL_PAID',
        paymentOptionType: 'PARTIAL_PAYMENT',
        partialAmount: 300,
      };
      expect(service.getCollectableAmount(partialOrder)).toBe(700);
    });

    it('returns full total for unpaid COD orders', () => {
      expect(service.getCollectableAmount({ total: 850, paymentOptionType: 'CASH_ON_DELIVERY' })).toBe(850);
    });
  });

  describe('bulkCreateSteadfastOrders COD amount', () => {
    it('sends actual remaining due amount (not full total) when order has advance payment', async () => {
      const mockOrderWithAdvance = {
        id: 'ord-bulk-1',
        displayId: 'ORD-BULK-001',
        total: 1500,
        guestName: 'Bulk Buyer',
        paymentStatus: 'PARTIAL_PAID',
        paymentOptionType: 'PARTIAL_PAYMENT',
        partialAmount: 500,
        payments: [{ status: 'PAID', amount: 500 }],
        shippingAddress: { address: 'Mirpur, Dhaka' },
        officeNotes: null,
      };

      (prisma.courierCredentials.findUnique as jest.Mock).mockResolvedValue({
        courier: 'steadfast',
        enabled: true,
        apiKey: 'test-api-key',
        secretKey: 'test-secret-key',
      });

      mockFetch(
        new Response(
          JSON.stringify({
            status: 200,
            data: [{ invoice: 'ORD-BULK-001', status: 'success', consignment_id: '123' }],
          }),
          { status: 200 },
        ),
      );

      await service.bulkCreateSteadfastOrders([mockOrderWithAdvance]);

      const postCall = (global.fetch as jest.Mock).mock.calls.find((c) =>
        c[0].includes('/create_order/bulk-order'),
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall[1].body);
      expect(body.data[0].cod_amount).toBe(1000); // 1500 - 500 = 1000, NOT 1500
    });
  });
});


describe('CourierManagerService — order secondary phone to couriers', () => {
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

  const order: any = {
    id: 'order-1',
    displayId: 'ORD-1',
    total: 500,
    guestPhone: '01712345678',
    guestName: 'Test',
    secondaryPhone: '+8801800000002',
    officeNotes: null,
    shippingAddress: { address: 'Dhaka', district: 'Dhaka', deliveryType: 'home', phone: '01999999999' },
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

  it('prefers order.secondaryPhone for Steadfast alternative_phone', async () => {
    mockFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await service.dispatch('steadfast', ['order-1']);

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.alternative_phone).toBe('01800000002');
  });

  it('falls back to the shipping address phone when no secondaryPhone exists', async () => {
    prisma.order.findMany.mockResolvedValue([{ ...order, secondaryPhone: null }]);
    mockFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await service.dispatch('steadfast', ['order-1']);

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.alternative_phone).toBe('01999999999');
  });
});

describe('CourierManagerService — order snapshot is recipient source of truth (D-A)', () => {
  let service: CourierManagerService;
  let prisma: any;
  const originalFetch = global.fetch;

  const creds = {
    courier: 'pathao',
    enabled: true,
    mode: 'sandbox',
    apiKey: 'test-api-key',
    secretKey: 'test-secret-key',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    username: 'user@merchant.com',
    password: 'pass',
    credentials: {},
  };

  // Snapshot updated by staff (PUT /orders/:id customerInfo); the linked
  // CustomerProfile still carries pre-correction values and must be ignored.
  const order: any = {
    id: 'order-snap-1',
    displayId: 'ORD-SNAP-1',
    total: 1000,
    payments: [],
    customerFirstName: 'MR',
    customerLastName: 'Joy',
    customerPhone: '01712345678',
    customerEmail: 'mr.joy@example.com',
    guestName: null,
    guestPhone: null,
    secondaryPhone: null,
    officeNotes: null,
    shippingAddress: { address: 'Dhaka', district: 'Dhaka' },
    customer: { name: 'STALE PROFILE', phone: 'STALE', email: 'stale@x.com' },
    items: [{ product: { name: 'Item' } }],
  };

  const tokenStore: any = {
    getAccessToken: jest.fn().mockResolvedValue('TOK'),
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
        create: jest.fn().mockResolvedValue({}),
      },
      courierDispatchLog: { create: jest.fn().mockResolvedValue({}) },
      systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    service = new CourierManagerService(prisma as any, tokenStore as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(res: Response) {
    global.fetch = jest.fn().mockResolvedValue(res);
  }

  it('pathao recipient_name uses order snapshot full name, not profile', async () => {
    mockFetch(
      new Response(
        JSON.stringify({ data: { consignment_id: 'CID-P1' } }),
        { status: 200 },
      ),
    );

    await service.dispatch('pathao', ['order-snap-1']);

    const orderCall = (global.fetch as jest.Mock).mock.calls.find((c) =>
      String(c[0]).includes('/aladdin/api/v1/orders'),
    );
    expect(orderCall).toBeDefined();
    const body = JSON.parse(orderCall[1].body);
    expect(body.recipient_name).toBe('MR Joy');
    expect(body.recipient_phone).toBe('01712345678');
  });

  it('steadfast recipient uses snapshot name/phone/email, not profile', async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          status: 200,
          consignment: {
            consignment_id: 'CID-S1',
            tracking_code: 'TC-S1',
            tracking_link: 'https://track/s1',
          },
        }),
        { status: 200 },
      ),
    );

    await service.dispatch('steadfast', ['order-snap-1']);

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.recipient_name).toBe('MR Joy');
    expect(body.recipient_phone).toBe('01712345678');
    expect(body.recipient_email).toBe('mr.joy@example.com');
  });

  it('bulk steadfast recipient uses snapshot, not profile', async () => {
    (prisma.courierCredentials.findUnique as jest.Mock).mockResolvedValue({
      courier: 'steadfast',
      enabled: true,
      apiKey: 'test-api-key',
      secretKey: 'test-secret-key',
    });
    mockFetch(
      new Response(
        JSON.stringify({
          status: 200,
          data: [{ invoice: 'ORD-SNAP-1', status: 'success', consignment_id: '123' }],
        }),
        { status: 200 },
      ),
    );

    await service.bulkCreateSteadfastOrders([order]);

    const postCall = (global.fetch as jest.Mock).mock.calls.find((c) =>
      String(c[0]).includes('/create_order/bulk-order'),
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall[1].body);
    expect(body.data[0].recipient_name).toBe('MR Joy');
    expect(body.data[0].recipient_phone).toBe('01712345678');
  });

  it('falls back to guestPhone when snapshot phone is empty', async () => {
    prisma.order.findMany.mockResolvedValue([
      { ...order, customerPhone: null, guestPhone: '01999999999' },
    ]);
    mockFetch(
      new Response(
        JSON.stringify({
          status: 200,
          consignment: {
            consignment_id: 'CID-S2',
            tracking_code: 'TC-S2',
            tracking_link: 'https://track/s2',
          },
        }),
        { status: 200 },
      ),
    );

    await service.dispatch('steadfast', ['order-snap-1']);

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.recipient_phone).toBe('01999999999');
  });
});

describe('CourierManagerService — Fix 5a Mx. prefix for short names', () => {
  let service: CourierManagerService;
  let prisma: any;
  const originalFetch = global.fetch;
  const tokenStore: any = {
    getAccessToken: jest.fn().mockResolvedValue('TOK'),
  };

  const creds = {
    courier: 'any',
    enabled: true,
    mode: 'sandbox',
    apiKey: 'test-api-key',
    secretKey: 'test-secret-key',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    clientContext: 'merchant',
    storeId: '1',
    username: 'user@merchant.com',
    password: 'pass',
    credentials: {},
  };

  // 2-char snapshot name (below Pathao's doc-verified min 3 — the ONLY
  // courier that prepends Mx.; Steadfast/RedX/Carrybee go verbatim).
  const shortOrder: any = {
    id: 'order-short-1',
    displayId: 'ORD-SHORT-1',
    total: 1000,
    payments: [],
    customerFirstName: 'Jo',
    customerLastName: '',
    customerPhone: '01712345678',
    customerEmail: 'jo@example.com',
    guestName: null,
    guestPhone: null,
    secondaryPhone: null,
    officeNotes: null,
    shippingAddress: { address: 'Dhaka', district: 'Dhaka' },
    customer: { name: 'STALE', phone: 'STALE', email: 'stale@x.com' },
    items: [{ product: { name: 'Item' } }],
  };

  beforeEach(() => {
    prisma = {
      courierCredentials: { findUnique: jest.fn().mockResolvedValue(creds) },
      order: {
        findMany: jest.fn().mockResolvedValue([shortOrder]),
        findUnique: jest.fn().mockResolvedValue({ timeline: [] }),
        update: jest.fn().mockResolvedValue(shortOrder),
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
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(res: Response) {
    global.fetch = jest.fn().mockResolvedValue(res);
  }

  function timelineNotes(): string[] {
    return prisma.order.update.mock.calls
      .map((c: any) => c[0]?.data?.timeline)
      .filter(Boolean)
      .flat()
      .map((e: any) => e.note);
  }

  it("sends 'Mx. Jo' to Pathao for a 2-char snapshot name", async () => {
    mockFetch(
      new Response(JSON.stringify({ data: { consignment_id: 'CID-PX' } }), {
        status: 200,
      }),
    );

    const results = await service.dispatch('pathao', ['order-short-1']);

    expect(results[0].ok).toBe(true);
    const orderCall = (global.fetch as jest.Mock).mock.calls.find((c) =>
      String(c[0]).includes('/aladdin/api/v1/orders'),
    );
    expect(JSON.parse(orderCall[1].body).recipient_name).toBe('Mx. Jo');
  });

  it('stores the sent name on the dispatch record + timeline, never mutates the stored order', async () => {
    const before = JSON.parse(JSON.stringify(shortOrder));
    mockFetch(
      new Response(JSON.stringify({ data: { consignment_id: 'CID-PX' } }), {
        status: 200,
      }),
    );

    await service.dispatch('pathao', ['order-short-1']);

    const orderCall = (global.fetch as jest.Mock).mock.calls.find((c) =>
      String(c[0]).includes('/aladdin/api/v1/orders'),
    );
    expect(JSON.parse(orderCall[1].body).recipient_name).toBe('Mx. Jo');
    expect(prisma.dispatch.upsert).toHaveBeenCalled();
    expect(
      prisma.dispatch.upsert.mock.calls[0][0].create.notes,
    ).toContain('Mx. Jo');
    expect(timelineNotes()).toContain(
      "courier name sent as 'Mx. Jo' — order keeps 'Jo'",
    );
    // Stored snapshot untouched: no name fields written back, object intact.
    for (const call of prisma.order.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty('customerFirstName');
      expect(call[0].data).not.toHaveProperty('customerLastName');
      expect(call[0].data).not.toHaveProperty('guestName');
    }
    expect(shortOrder.customerFirstName).toBe('Jo');
    expect(shortOrder).toEqual(before);
  });

  it('sends a Steadfast short name verbatim (no documented minimum — no prefix, no timeline note)', async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          status: 200,
          consignment: {
            consignment_id: 'CID-SX',
            tracking_code: 'TC-SX',
            tracking_link: 'https://track/sx',
          },
        }),
        { status: 200 },
      ),
    );

    await service.dispatch('steadfast', ['order-short-1']);

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.recipient_name).toBe('Jo');
    expect(body.recipient_name).not.toContain('Mx.');
    // No transform → no dispatch notes, no timeline note.
    expect(
      prisma.dispatch.upsert.mock.calls[0][0].create.notes,
    ).toBeUndefined();
    expect(timelineNotes()).not.toContain(
      "courier name sent as 'Mx. Jo' — order keeps 'Jo'",
    );
  });

  it('sends short names in the Steadfast bulk payload verbatim (no documented minimum)', async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          status: 200,
          data: [
            {
              invoice: 'ORD-SHORT-1',
              status: 'success',
              consignment_id: 'B1',
              tracking_code: 'T1',
              tracking_link: 'https://track/b1',
            },
          ],
        }),
        { status: 200 },
      ),
    );
    prisma.order.findFirst = jest.fn().mockResolvedValue({ id: 'order-short-1' });

    await service.bulkCreateSteadfastOrders([shortOrder]);

    const postCall = (global.fetch as jest.Mock).mock.calls.find((c) =>
      String(c[0]).includes('/create_order/bulk-order'),
    );
    expect(JSON.parse(postCall[1].body).data[0].recipient_name).toBe('Jo');
  });

  it('sends a RedX short name verbatim (no documented minimum — no prefix, no timeline note)', async () => {
    mockFetch(
      new Response(JSON.stringify({ data: { tracking_id: 'RX-1' } }), {
        status: 200,
      }),
    );

    const results = await service.dispatch('redx', ['order-short-1']);

    expect(results[0].ok).toBe(true);
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.customer_name).toBe('Jo');
    expect(body.customer_name).not.toContain('Mx.');
    expect(prisma.dispatch.create).toHaveBeenCalled();
    expect(
      prisma.dispatch.create.mock.calls[0][0].data.notes,
    ).toBeUndefined();
    expect(
      timelineNotes().some((n) =>
        n.includes("courier name sent as 'Mx. Jo'"),
      ),
    ).toBe(false);
  });

  it('sends a Carrybee short name verbatim (exempt from Mx. prefix)', async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          error: false,
          message: 'Order created successfully',
          data: { order: { consignment_id: 'CB-1' } },
        }),
        { status: 201 },
      ),
    );

    const results = await service.dispatch('carrybee', ['order-short-1']);

    expect(results[0].ok).toBe(true);
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.recipient_name).toBe('Jo');
    expect(body.recipient_name).not.toContain('Mx.');
  });

  it('surfaces a field error for a missing name instead of sending a placeholder', async () => {
    prisma.order.findMany.mockResolvedValue([
      {
        ...shortOrder,
        customerFirstName: null,
        customerLastName: null,
        guestName: null,
      },
    ]);
    mockFetch(
      new Response(
        JSON.stringify({
          status: 200,
          consignment: {
            consignment_id: 'CID-NEVER',
            tracking_code: 'TC-NEVER',
            tracking_link: 'https://track/never',
          },
        }),
        { status: 200 },
      ),
    );

    const results = await service.dispatch('steadfast', ['order-short-1']);

    expect(results[0].ok).toBe(false);
    expect(results[0].message).toContain('recipient_name');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('bulk skips empty-name entries per-entry instead of aborting the batch', async () => {
    const goodOrder: any = {
      ...shortOrder,
      id: 'order-good-1',
      displayId: 'ORD-GOOD-1',
      customerFirstName: 'Good',
      customerLastName: 'Buyer',
    };
    const badOrder: any = {
      ...shortOrder,
      id: 'order-bad-1',
      displayId: 'ORD-BAD-1',
      customerFirstName: null,
      customerLastName: null,
      guestName: null,
    };
    mockFetch(
      new Response(
        JSON.stringify({
          status: 200,
          data: [
            {
              invoice: 'ORD-GOOD-1',
              status: 'success',
              consignment_id: 'B-GOOD',
              tracking_code: 'T-GOOD',
              tracking_link: 'https://track/good',
            },
          ],
        }),
        { status: 200 },
      ),
    );
    prisma.order.findFirst = jest.fn().mockResolvedValue({ id: 'order-good-1' });

    let result: any;
    await expect(
      (async () => {
        result = await service.bulkCreateSteadfastOrders([goodOrder, badOrder]);
      })(),
    ).resolves.not.toThrow();

    expect(result.success).toHaveLength(1);
    expect(result.success[0].orderId).toBe('ORD-GOOD-1');
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].orderId).toBe('ORD-BAD-1');
    expect(result.failed[0].message).toContain(
      "Courier: field 'recipient_name' is required",
    );
    // The bad entry never reaches the courier API payload.
    const postCall = (global.fetch as jest.Mock).mock.calls.find((c) =>
      String(c[0]).includes('/create_order/bulk-order'),
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall[1].body);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].invoice).toBe('ORD-GOOD-1');
  });

  it('fires a timeline note when a long name is truncated for the courier', async () => {
    const longName = 'A'.repeat(101);
    prisma.order.findMany.mockResolvedValue([
      { ...shortOrder, customerFirstName: longName, customerLastName: '' },
    ]);
    mockFetch(
      new Response(JSON.stringify({ data: { consignment_id: 'CID-CUT' } }), {
        status: 200,
      }),
    );

    await service.dispatch('pathao', ['order-short-1']);

    const orderCall = (global.fetch as jest.Mock).mock.calls.find((c) =>
      String(c[0]).includes('/aladdin/api/v1/orders'),
    );
    const sent = JSON.parse(orderCall[1].body).recipient_name;
    expect(sent).toBe('A'.repeat(100));
    expect(timelineNotes()).toContain(
      `courier name sent as '${'A'.repeat(100)}' — order keeps '${longName}'`,
    );
  });
  it('appends no timeline note and no dispatch notes when the name needed no transform', async () => {
    prisma.order.findMany.mockResolvedValue([
      { ...shortOrder, customerFirstName: 'MR', customerLastName: 'Joy' },
    ]);
    mockFetch(
      new Response(JSON.stringify({ data: { consignment_id: 'CID-OK' } }), {
        status: 200,
      }),
    );

    await service.dispatch('pathao', ['order-short-1']);

    const orderCall = (global.fetch as jest.Mock).mock.calls.find((c) =>
      String(c[0]).includes('/aladdin/api/v1/orders'),
    );
    expect(JSON.parse(orderCall[1].body).recipient_name).toBe('MR Joy');
    expect(timelineNotes()).not.toContain(
      expect.stringContaining('courier name sent as'),
    );
    const createArg = prisma.dispatch.upsert.mock.calls[0][0].create;
    expect(createArg).not.toHaveProperty('notes');
  });
});

describe('CourierManagerService — Steadfast return-status client (Task 5)', () => {
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

  beforeEach(() => {
    prisma = {
      courierCredentials: { findUnique: jest.fn().mockResolvedValue(creds) },
    };
    service = new CourierManagerService(prisma as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('GETs /status_with_return_status_by_cid and returns the doc-shaped delivery_status', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ status: 200, delivery_status: 'cancelled_return_rider_assigned' }),
        { status: 200 },
      ),
    );

    const result = await service.getSteadfastReturnStatus('123456');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/status_with_return_status_by_cid/123456'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Api-Key': 'test-api-key', 'Secret-Key': 'test-secret-key' }),
      }),
    );
    expect(result).toEqual({ deliveryStatus: 'cancelled_return_rider_assigned' });
  });

  it('throws when Steadfast is not configured (never an unauthenticated call)', async () => {
    prisma.courierCredentials.findUnique.mockResolvedValue(null);
    global.fetch = jest.fn();

    await expect(service.getSteadfastReturnStatus('123456')).rejects.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws when the answer carries no delivery_status (fail-closed)', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 200 }), { status: 200 }),
    );

    await expect(service.getSteadfastReturnStatus('123456')).rejects.toThrow(
      /delivery_status/,
    );
  });
});
