import { MetaGraphService, MetaApiError } from './meta-graph.service';

describe('MetaGraphService', () => {
  let service: MetaGraphService;

  const jsonResponse = (body: any, ok = true, status = 200) => ({
    ok,
    status,
    json: async () => body,
  });

  beforeEach(() => {
    service = new MetaGraphService();
    global.fetch = jest.fn() as any;
  });

  afterEach(() => {
    delete (global as any).fetch;
  });

  it('GETs by default with access_token and params in the query string, no body', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ id: '123' }));

    const res = await service.request('me', 'EAAG-token', { fields: 'id,name' });

    expect(res).toEqual({ id: '123' });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(String(url)).toContain('https://graph.facebook.com/v21.0/me');
    expect(String(url)).toContain('access_token=EAAG-token');
    expect(String(url)).toContain('fields=id%2Cname');
  });

  it('POSTs an access_token exchange with a form-encoded body', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ access_token: 'EAAG-new', expires_in: 5184000 }),
    );

    const res = await service.request(
      'oauth/access_token',
      'EAAG-old',
      {},
      'POST',
      {
        grant_type: 'fb_exchange_token',
        client_id: 'app-123',
        client_secret: 'sec-456',
        fb_exchange_token: 'EAAG-old',
      },
    );

    expect(res.access_token).toBe('EAAG-new');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(String(url)).toContain('oauth/access_token');
    expect(init.body).toContain('grant_type=fb_exchange_token');
    expect(init.body).toContain('client_id=app-123');
    expect(init.body).toContain('client_secret=sec-456');
    expect(init.body).toContain('fb_exchange_token=EAAG-old');
  });

  it('POSTs campaign status updates as form-encoded body', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ success: true }));

    await service.request('2384345', 'EAAG-token', {}, 'POST', { status: 'PAUSED' });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('status=PAUSED');
  });

  it('still maps code 190 to MetaApiError on POST responses', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(
        { error: { code: 190, message: 'Session has expired' } },
        false,
        400,
      ),
    );

    await expect(
      service.request('2384345', 'EAAG-old', {}, 'POST', { status: 'PAUSED' }),
    ).rejects.toMatchObject({ name: 'MetaApiError', code: 190 });
  });

  it('keeps code-100 and generic error mapping on the error path', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ error: { code: 100, message: 'Invalid parameter' } }, false, 400),
    );
    await expect(service.request('me', 'x')).rejects.toMatchObject({
      name: 'MetaApiError',
      code: 100,
    });

    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ error: { message: 'boom' } }, false, 500),
    );
    await expect(service.request('me', 'x')).rejects.toMatchObject({
      name: 'MetaApiError',
    });
  });

  it('rethrows MetaApiError untouched without double wrapping', async () => {
    const err = new MetaApiError('Session has expired', 190, 458);
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ error: { code: 190, message: 'Session has expired' } }, false, 400),
    );
    await expect(service.request('me', 'x')).rejects.toBeInstanceOf(MetaApiError);
    expect(err).toBeInstanceOf(MetaApiError);
  });
});