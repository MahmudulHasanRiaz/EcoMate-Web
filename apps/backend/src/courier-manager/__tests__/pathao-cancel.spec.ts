import { BadRequestException } from '@nestjs/common';
import { CourierManagerService } from '../courier-manager.service';

/**
 * Pathao pickup/order cancel (owner directive, 2026-10-21).
 *
 * The Pathao merchant cancel endpoint is a POST to
 * /aladdin/api/v1/orders/{consignment_id}/cancel with no request body
 * (the shape used by Pathao merchant integrations). It cancels the booking
 * BEFORE collection — the dispatch-cancel eligibility gate blocks every
 * post-pickup dispatch, so this client is only ever called pre-pickup.
 */
describe('CourierManagerService — cancelPathaoOrder', () => {
  const originalFetch = global.fetch;
  let service: CourierManagerService;
  let prisma: any;
  let tokenStore: any;

  const creds = {
    courier: 'pathao',
    enabled: true,
    mode: 'sandbox',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    username: 'user@merchant.com',
    password: 'pass',
    storeId: '1',
    credentials: {},
  };

  beforeEach(() => {
    prisma = {
      courierCredentials: { findUnique: jest.fn().mockResolvedValue(creds) },
    };
    tokenStore = { getAccessToken: jest.fn().mockResolvedValue('TOK') };
    service = new CourierManagerService(prisma, tokenStore);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('POSTs the documented cancel endpoint with the bearer token and no body', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'success',
          code: 200,
          message: 'Order cancelled successfully',
          data: true,
        }),
        { status: 200 },
      ),
    );
    global.fetch = fetchMock as any;

    const result = await service.cancelPathaoOrder('PA-1', 'Order cancelled by staff');

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://courier-api-sandbox.pathao.com/aladdin/api/v1/orders/PA-1/cancel',
    );
    expect(options.method).toBe('POST');
    expect((options.headers as any).Authorization).toBe('Bearer TOK');
    // Pathao's documented integrations POST an empty body.
    expect(options).not.toHaveProperty('body');
    expect(result).toMatchObject({ type: 'success', code: 200 });
  });

  it('an error envelope on HTTP 200 is a rejection', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'error',
          code: 400,
          message: 'Order already picked up',
        }),
        { status: 200 },
      ),
    ) as any;

    await expect(
      service.cancelPathaoOrder('PA-1', 'Order cancelled by staff'),
    ).rejects.toThrow(/Pathao cancel rejected: Order already picked up/i);
  });

  it('a non-2xx response throws and never reports a cancel', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response('{"message":"not found"}', { status: 404 }),
    ) as any;

    await expect(
      service.cancelPathaoOrder('PA-1', 'Order cancelled by staff'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a consignment id', async () => {
    await expect(
      service.cancelPathaoOrder('  ', 'Order cancelled by staff'),
    ).rejects.toThrow(/consignmentId is required/i);
  });
});
