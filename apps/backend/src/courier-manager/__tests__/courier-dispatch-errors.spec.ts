import { CourierManagerService } from '../courier-manager.service';
import { CourierDispatchError, redactSecrets } from '../courier-manager.service';

describe('CourierManagerService — Fix 5 dispatch error bodies + retry discipline', () => {
  let service: CourierManagerService;
  let prisma: any;
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
    shippingAddress: { address: 'Dhaka', district: 'Dhaka', deliveryType: 'home' },
    customer: { name: 'Test', phone: '01712345678', email: null },
    items: [{ product: { name: 'Item' } }],
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

  function mockFetchSequence(responses: Response[]) {
    const queue = [...responses];
    let last = queue[queue.length - 1];
    global.fetch = jest.fn().mockImplementation(() => {
      const next = queue.shift() ?? last;
      last = next;
      return Promise.resolve(next.clone());
    });
  }

  function lastTimelineNotes(): string[] {
    return prisma.order.update.mock.calls
      .map((c: any) => c[0]?.data?.timeline)
      .filter(Boolean)
      .flat()
      .map((e: any) => e.note)
      .filter(Boolean);
  }

  describe('redactSecrets()', () => {
    it('masks Api-Key / Secret-Key / token / password values in body text', () => {
      const raw =
        'headers {"Api-Key": "live-key-123", "Secret-Key": "shh"} ' +
        'Authorization: Bearer tok_abc password=supersecret "client_secret": "cs42"';
      const out = redactSecrets(raw);
      expect(out).not.toContain('live-key-123');
      expect(out).not.toContain('shh');
      expect(out).not.toContain('tok_abc');
      expect(out).not.toContain('supersecret');
      expect(out).not.toContain('cs42');
      expect(out).toContain('[REDACTED]');
    });

    it('leaves courier field names and validation text intact', () => {
      const raw = `{"status":400,"errors":{"recipient_name":["too short"]}}`;
      expect(redactSecrets(raw)).toBe(raw);
    });

    it('does not mangle prose without a separator (password must be ...)', () => {
      expect(redactSecrets('password must be 8 characters')).toBe(
        'password must be 8 characters',
      );
      expect(
        redactSecrets("field 'recipient_name' password must be 3-100 chars"),
      ).toBe("field 'recipient_name' password must be 3-100 chars");
    });

    it('still redacts separator-style secrets (colon / equals / bearer)', () => {
      expect(redactSecrets('Api-Key: live-key-123')).toContain('[REDACTED]');
      expect(redactSecrets('Api-Key: live-key-123')).not.toContain(
        'live-key-123',
      );
      expect(redactSecrets('password=supersecret')).toContain('[REDACTED]');
      expect(redactSecrets('password=supersecret')).not.toContain(
        'supersecret',
      );
      expect(redactSecrets('Authorization: Bearer tok_abc')).toContain(
        '[REDACTED]',
      );
      expect(redactSecrets('Authorization: Bearer tok_abc')).not.toContain(
        'tok_abc',
      );
    });
  });

  describe('steadfast single create_order', () => {
    it('4xx field rejection: full body captured, errors attached, NO retry (attempts==1)', async () => {
      mockFetchSequence([
        new Response(
          JSON.stringify({
            status: 400,
            errors: { recipient_name: ['The name is too long.'] },
          }),
          { status: 400 },
        ),
      ]);

      const results = await service.dispatch('steadfast', ['order-1']);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(results[0].ok).toBe(false);
      expect(results[0].courier).toBe('steadfast');
      expect(results[0].status).toBe(400);
      // Exact field+rule naming for the UI/timeline.
      expect(results[0].message).toContain("field 'recipient_name'");
      expect(results[0].message).toContain('The name is too long.');
      expect(results[0].errors).toEqual({
        recipient_name: ['The name is too long.'],
      });
      // Failure lands on the order timeline with the same field+rule text.
      expect(
        lastTimelineNotes().some((n) => n.includes("field 'recipient_name'")),
      ).toBe(true);
    });

    it('401 surfaces a fix-keys hint and never retries', async () => {
      mockFetchSequence([
        new Response(
          JSON.stringify({ status: 401, message: 'Unauthorized Access' }),
          { status: 401 },
        ),
      ]);

      const results = await service.dispatch('steadfast', ['order-1']);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(results[0].ok).toBe(false);
      expect(results[0].message).toMatch(/fix.*keys.*do not retry/i);
    });

    it('429 surfaces a backoff hint with the Steadfast 60-minute lockout note, no retry', async () => {
      mockFetchSequence([new Response('Too many requests', { status: 429 })]);

      const results = await service.dispatch('steadfast', ['order-1']);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(results[0].ok).toBe(false);
      expect(results[0].status).toBe(429);
      expect(results[0].message).toMatch(/back ?off|do not retry/i);
      expect(results[0].message).toMatch(/60 minutes/);
    });

    it('5xx is retried with backoff and reuses the SAME invoice (no double-book)', async () => {
      mockFetchSequence([
        new Response('upstream boom', { status: 500 }),
        new Response(
          JSON.stringify({
            status: 200,
            consignment: {
              consignment_id: 'CID-R1',
              tracking_code: 'TC-R1',
              tracking_link: 'https://track/r1',
            },
          }),
          { status: 200 },
        ),
      ]);

      const results = await service.dispatch('steadfast', ['order-1']);

      expect(results[0].ok).toBe(true);
      expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
      const bodies = (global.fetch as jest.Mock).mock.calls.map((c: any) =>
        JSON.parse(c[1].body),
      );
      // Retry safety: duplicate invoices are refused, so the retry MUST reuse
      // the same invoice or the parcel could never be rebooked.
      expect(bodies[0].invoice).toBe('ORD-1');
      expect(bodies[1].invoice).toBe('ORD-1');
    });

    it('network failure is retried, then surfaces the last error when exhausted', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('socket hang up'));

      const results = await service.dispatch('steadfast', ['order-1']);

      expect(results[0].ok).toBe(false);
      expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(1);
      expect(results[0].message).toMatch(/socket hang up|failed after retries/i);
    });

    it('2xx non-JSON body is redacted (no raw secret in the failure message)', async () => {
      mockFetchSequence([
        new Response('gateway page Api-Key: live-secret-xyz', { status: 200 }),
      ]);

      const results = await service.dispatch('steadfast', ['order-1']);

      expect(results[0].ok).toBe(false);
      expect(results[0].message).not.toContain('live-secret-xyz');
      expect(results[0].message).toContain('[REDACTED]');
    });
  });

  describe('pathao single order', () => {
    it('parses the error envelope (message/type/code) without retrying 4xx', async () => {
      mockFetchSequence([
        new Response(
          JSON.stringify({
            message: 'Validation failed',
            type: 'error',
            code: 422,
            errors: { recipient_name: ['Name length should be between 3 to 100 characters.'] },
          }),
          { status: 422 },
        ),
      ]);

      const results = await service.dispatch('pathao', ['order-1']);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(results[0].ok).toBe(false);
      expect(results[0].courier).toBe('pathao');
      expect(results[0].status).toBe(422);
      expect(results[0].message).toContain("field 'recipient_name'");
      expect(results[0].message).toContain('3 to 100');
      expect(results[0].errors).toEqual({
        recipient_name: ['Name length should be between 3 to 100 characters.'],
      });
    });

    it('a non-JSON error body does not throw a raw SyntaxError inside the loop', async () => {
      mockFetchSequence([new Response('<html>gateway exploded</html>', { status: 502 })]);

      const results = await service.dispatch('pathao', ['order-1']);

      // 502 is retryable: more than one attempt, eventual graceful failure.
      expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(1);
      expect(results[0].ok).toBe(false);
      expect(results[0].message).not.toMatch(/SyntaxError|Unexpected token/);
    });
  });

  describe('redx single parcel', () => {
    it('422 surfaces message + errors object with no retry', async () => {
      mockFetchSequence([
        new Response(
          JSON.stringify({
            message: 'Validation error',
            errors: { customer_phone: ['Invalid phone number'] },
          }),
          { status: 422 },
        ),
      ]);

      const results = await service.dispatch('redx', ['order-1']);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(results[0].ok).toBe(false);
      expect(results[0].courier).toBe('redx');
      expect(results[0].status).toBe(422);
      expect(results[0].message).toContain("field 'customer_phone'");
      expect(results[0].errors).toEqual({
        customer_phone: ['Invalid phone number'],
      });
    });

    it('retries 5xx and succeeds on the next attempt', async () => {
      mockFetchSequence([
        new Response('redx down', { status: 503 }),
        new Response(JSON.stringify({ data: { tracking_id: 'RX-9' } }), {
          status: 200,
        }),
      ]);

      const results = await service.dispatch('redx', ['order-1']);

      expect(results[0].ok).toBe(true);
      expect(results[0].trackingCode).toBe('RX-9');
      expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
    });
  });

  describe('carrybee single shipment', () => {
    it('422 causes surface per-field rules with no retry', async () => {
      mockFetchSequence([
        new Response(
          JSON.stringify({
            error: true,
            message: 'Validation error',
            causes: {
              mobile: [{ type: 'invalid_format', attribute: {} }],
            },
          }),
          { status: 422 },
        ),
      ]);

      const results = await service.dispatch('carrybee', ['order-1']);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(results[0].ok).toBe(false);
      expect(results[0].courier).toBe('carrybee');
      expect(results[0].status).toBe(422);
      expect(results[0].message).toContain("field 'mobile'");
      expect(results[0].message).toContain('invalid_format');
      expect(results[0].errors).toEqual({
        mobile: [{ type: 'invalid_format', attribute: {} }],
      });
    });

    it('retries 5xx/network with backoff instead of failing immediately', async () => {
      mockFetchSequence([
        new Response('carrybee down', { status: 500 }),
        new Response(
          JSON.stringify({ success: true, data: { consignment_id: 'CB-9' } }),
          { status: 200 },
        ),
      ]);

      const results = await service.dispatch('carrybee', ['order-1']);

      expect(results[0].ok).toBe(true);
      expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
    });
  });

  describe('steadfast bulk', () => {
    it("reads per-entry `error` codes (not `message`, never literal 'Failed')", async () => {
      mockFetchSequence([
        new Response(
          JSON.stringify({
            status: 200,
            message: 'We have a response for you.',
            data: [
              {
                invoice: 'ORD-1',
                consignment_id: 1424107,
                tracking_code: '15BAEB8A',
                status: 'success',
                tracking_link: 'https://steadfast.com.bd/tl/a1b2c3d4',
              },
              {
                invoice: 'ORD-1-DUP',
                consignment_id: null,
                tracking_code: null,
                status: null,
                error: '["THIS_INVOICE_ALREADY_EXISTS"]',
              },
            ],
          }),
          { status: 200 },
        ),
      ]);

      const result = await service.bulkCreateSteadfastOrders([
        { ...order, displayId: 'ORD-1' },
        { ...order, displayId: 'ORD-1-DUP' },
      ]);

      expect(result.success).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].orderId).toBe('ORD-1-DUP');
      expect(result.failed[0].message).not.toBe('Failed');
      expect(result.failed[0].message).toContain('THIS_INVOICE_ALREADY_EXISTS');
      // Field+rule naming, matching the single-dispatch UI language.
      expect(result.failed[0].message).toContain("field 'invoice'");
      expect((result.failed[0] as any).errors).toEqual({
        codes: ['THIS_INVOICE_ALREADY_EXISTS'],
        invoice: 'ORD-1-DUP',
      });
    });

    it('supports the extended-bulk shape (status error + sentence array)', async () => {
      mockFetchSequence([
        new Response(
          JSON.stringify({
            status: 200,
            message: 'Processed bulk order entries.',
            data: [
              {
                invoice: 'ORD-1',
                status: 'error',
                error: ['The recipient phone format is invalid.'],
                consignment_id: null,
                tracking_code: null,
              },
            ],
          }),
          { status: 200 },
        ),
      ]);

      const result = await service.bulkCreateSteadfastOrders([
        { ...order, displayId: 'ORD-1' },
      ]);

      expect(result.success).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].message).toContain(
        'The recipient phone format is invalid.',
      );
    });
  });

  describe('thrown error shape', () => {
    it('CourierDispatchError carries {courier, status, message, errors, orderId}', () => {
      const err = new CourierDispatchError({
        courier: 'pathao',
        status: 422,
        message: "Pathao: field 'recipient_name' must be 3–100 chars",
        errors: { recipient_name: ['must be 3–100 chars'] },
        orderId: 'order-1',
      });
      const res = err.getResponse() as any;
      expect(res).toEqual({
        courier: 'pathao',
        status: 422,
        message: "Pathao: field 'recipient_name' must be 3–100 chars",
        errors: { recipient_name: ['must be 3–100 chars'] },
        orderId: 'order-1',
      });
      expect(err.message).toContain("field 'recipient_name'");
    });
  });
});
