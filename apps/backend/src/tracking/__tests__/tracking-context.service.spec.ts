import { TrackingContextService } from '../tracking-context.service';
import { mergeContext } from '../context-merge';

describe('TrackingContextService', () => {
  const upsertMock = jest.fn();
  const findUniqueMock = jest.fn();
  const tx = { trackingContext: { upsert: upsertMock, findUnique: findUniqueMock } };
  const transactionMock = jest.fn((cb) => cb(tx));
  const prisma = { $transaction: transactionMock } as any;
  const service = new TrackingContextService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    upsertMock.mockClear();
    findUniqueMock.mockClear();
    transactionMock.mockClear();
  });

  it('upserts via a transaction with server-set ip/userAgent and serialized merge', async () => {
    findUniqueMock.mockResolvedValue(null);
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
    const existing = {
      id: 'id-1', ctxId: 'ctx-1', externalId: 'ext-1', ip: '9.9.9.9', userAgent: 'UA-old',
      url: null, referrer: null, identifiers: { meta: { fbp: { value: 'old', firstSeenAt: 't' } } },
      firstSeenAt: new Date(), lastSeenAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    };
    findUniqueMock.mockResolvedValue(existing);
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
});