import { TrackingContextService } from '../tracking-context.service';

describe('TrackingContextService', () => {
  const upsertMock = jest.fn();
  const queryRawMock = jest.fn();
  const tx = { $queryRaw: queryRawMock, trackingContext: { upsert: upsertMock } };
  const transactionMock = jest.fn((cb) => cb(tx));
  const prisma = { $transaction: transactionMock } as any;
  const service = new TrackingContextService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    upsertMock.mockClear();
    queryRawMock.mockClear();
    transactionMock.mockClear();
  });

  it('upserts via a transaction with server-set ip/userAgent and serialized merge', async () => {
    queryRawMock.mockResolvedValue([]); // no existing row
    await service.upsertContext('ctx-1', { identifiers: { meta: { fbp: 'x' } } }, '1.2.3.4', 'UA');
    expect(transactionMock).toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalled();
    const [call] = upsertMock.mock.calls;
    expect(call[0].where).toEqual({ ctxId: 'ctx-1' });
    expect(call[0].create.ip).toBe('1.2.3.4');
    expect(call[0].create.userAgent).toBe('UA');
    expect(call[0].create.externalId).toBeDefined(); // server-generated
  });

  it('merges into the existing row and never trusts browser ip/ua', async () => {
    // Raw DB row from SELECT *: identifiers is the parsed JSON value, url/referrer are columns.
    const existing = {
      id: 'id-1', ctxId: 'ctx-1', externalId: 'ext-1', ip: '9.9.9.9', userAgent: 'UA-old',
      url: null, referrer: null, identifiers: { meta: { fbp: { value: 'old', firstSeenAt: 't' } } },
      firstSeenAt: new Date(), lastSeenAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    };
    queryRawMock.mockResolvedValue([existing]);
    await service.upsertContext('ctx-1', { identifiers: { meta: { fbp: 'new' } } }, '5.5.5.5', 'UA-new');
    expect(upsertMock).toHaveBeenCalled();
    const call = upsertMock.mock.calls[0][0];
    expect(call.update.identifiers.meta.fbp.value).toBe('new'); // rotating: replaced
    expect(call.update.ip).toBeUndefined();                     // ip/ua never overwritten
    expect(call.update.userAgent).toBeUndefined();
  });

  it('getByCtxId returns the row or null', async () => {
    // This test is calling the real service method, which uses this.prisma.trackingContext.findUnique
    // We need to mock the service's prisma.trackingContext
    const findUniqueForGetByCtxId = jest.fn().mockResolvedValue(null);
    service.prisma = { trackingContext: { findUnique: findUniqueForGetByCtxId } } as any;
    await expect(service.getByCtxId('nope')).resolves.toBeNull();
    expect(findUniqueForGetByCtxId).toHaveBeenCalledWith({ where: { ctxId: 'nope' } });
  });

  describe('privacy P0 — URL sanitization choke point', () => {
    beforeEach(() => {
      // The getByCtxId test above swaps service.prisma; restore the
      // transaction-backed mock for these tests.
      service.prisma = prisma;
    });

    it('strips sensitive query params from url and referrer before persistence', async () => {
      queryRawMock.mockResolvedValue([]);
      await service.upsertContext(
        'ctx-token',
        {
          identifiers: {},
          url: 'https://ecomate.example/checkout/thank-you?orderId=uuid-1&t=viewtoken',
          referrer: 'https://facebook.com/post?token=fb-secret',
        },
        '1.2.3.4',
        'UA',
      );
      const call = upsertMock.mock.calls[0][0];
      expect(call.create.url).toBe('https://ecomate.example/checkout/thank-you');
      expect(call.create.referrer).toBe('https://facebook.com/post');
      expect(JSON.stringify(call.create)).not.toContain('viewtoken');
      expect(JSON.stringify(call.create)).not.toContain('fb-secret');
    });

    it('keeps clean URLs unchanged', async () => {
      queryRawMock.mockResolvedValue([]);
      await service.upsertContext(
        'ctx-clean',
        { identifiers: {}, url: 'https://ecomate.example/p/1', referrer: 'https://google.com/' },
        '1.2.3.4',
        'UA',
      );
      const call = upsertMock.mock.calls[0][0];
      expect(call.create.url).toBe('https://ecomate.example/p/1');
      expect(call.create.referrer).toBe('https://google.com/');
    });

    it('update path applies the same sanitization (latest-url merge)', async () => {
      const existing = {
        id: 'id-1', ctxId: 'ctx-1', externalId: 'ext-1', ip: '9.9.9.9', userAgent: 'UA-old',
        url: 'https://ecomate.example/old?t=oldtoken', referrer: null,
        identifiers: {}, firstSeenAt: new Date(), lastSeenAt: new Date(),
        createdAt: new Date(), updatedAt: new Date(),
      };
      queryRawMock.mockResolvedValue([existing]);
      await service.upsertContext(
        'ctx-1',
        { identifiers: {}, url: 'https://ecomate.example/new?t=newtoken' },
        '5.5.5.5',
        'UA-new',
      );
      const call = upsertMock.mock.calls[0][0];
      expect(call.update.url).toBe('https://ecomate.example/new');
      expect(JSON.stringify(call.update)).not.toContain('newtoken');
    });

    it('does not sanitize identifiers (fbp/fbc must stay verbatim)', async () => {
      queryRawMock.mockResolvedValue([]);
      await service.upsertContext(
        'ctx-ids',
        {
          identifiers: { meta: { fbp: 'fb.1.1723400000000.1234567890', fbc: 'fb.1.9.fbclidvalue' } },
          url: 'https://ecomate.example/?t=leak',
        },
        '1.2.3.4',
        'UA',
      );
      const call = upsertMock.mock.calls[0][0];
      expect(call.create.identifiers.meta.fbp.value).toBe('fb.1.1723400000000.1234567890');
      expect(call.create.identifiers.meta.fbc.value).toBe('fb.1.9.fbclidvalue');
      expect(call.create.url).toBe('https://ecomate.example/');
    });
  });
});