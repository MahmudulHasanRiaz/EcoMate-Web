import { TrackingDispatcherService, DispatchJob } from '../tracking-dispatcher.service';
import {
  DispatchResult,
  TrackingProviderAdapter,
} from '../adapters';
import { buildAdapterRegistry } from '../adapters';

jest.mock('../adapters', () => ({
  ...jest.requireActual('../adapters'),
  buildAdapterRegistry: jest.fn(),
}));

const mockBuildAdapterRegistry = buildAdapterRegistry as jest.MockedFunction<
  typeof buildAdapterRegistry
>;

const okResult = (over: Partial<DispatchResult> = {}) => ({
  ok: true,
  retryable: false,
  providerEventId: 'purchase_ord-1',
  httpStatus: 200,
  rawResponse: '{"ok":true}',
  ...over,
});

const buildPayload = (eventType = 'Purchase') => ({
  eventName: eventType,
  eventId: 'purchase_ord-1',
  eventTime: 1722585600,
  eventType,
});

describe('TrackingDispatcherService (outbox -> adapters -> dispatch rows)', () => {
  const snapshotFindUnique = jest.fn();
  const outboxFindUnique = jest.fn();
  const outboxUpdate = jest.fn();
  const dispatchFindUnique = jest.fn();
  const dispatchCreate = jest.fn();
  const dispatchUpdate = jest.fn();
  const dispatchEventCreate = jest.fn();
  const contextGetByCtxId = jest.fn();
  const settingsGet = jest.fn();
  const getTestEventCode = jest.fn();
  const configGet = jest.fn();
  const dlqMirror = jest.fn();
  const replayArchive = jest.fn();

  const prisma = {
    trackingSnapshot: { findUnique: snapshotFindUnique },
    trackingOutbox: { findUnique: outboxFindUnique, update: outboxUpdate },
    trackingDispatch: {
      findUnique: dispatchFindUnique,
      create: dispatchCreate,
      update: dispatchUpdate,
    },
    trackingDispatchEvent: { create: dispatchEventCreate },
  } as any;
  const context = { getByCtxId: contextGetByCtxId } as any;
  const settings = { get: settingsGet, getTestEventCode } as any;
  const config = { get: configGet } as any;
  const dlq = { mirror: dlqMirror } as any;
  const replay = { archive: replayArchive } as any;
  const service = new TrackingDispatcherService(prisma, context, settings, config, dlq, replay);

  const snapshot = {
    id: 'snap-1',
    eventId: 'purchase_ord-1',
    eventType: 'Purchase',
    orderId: 'ord-1',
    ctxId: 'ctx-1',
    eventTime: BigInt(1722585600),
    actionSource: 'website',
    schemaVersion: 1,
    payload: { value: 100, currency: 'BDT', orderId: 'ord-1' },
  };
  const outbox = {
    id: 'outbox-1',
    snapshotId: 'snap-1',
    configSnapshot: { enabledProviders: ['meta', 'tiktok'], successPolicy: 'ALL_SENT' },
    status: 'CLAIMED',
    attemptCount: 0,
  };
  const contextRow = {
    ctxId: 'ctx-1',
    externalId: 'ext-1',
    ip: '1.2.3.4',
    userAgent: 'Mozilla/5.0',
    url: 'https://ecomate.example/checkout',
    referrer: 'https://ecomate.example/product/sku-1',
    identifiers: {
      meta: {
        fbp: { value: 'fbp.1', firstSeenAt: '' },
        fbc: { value: 'fbc.2', firstSeenAt: '' },
      },
      google: {
        gaClientId: { value: 'ga-1', firstSeenAt: '' },
        gclid: { value: 'gcl-1', firstSeenAt: '' },
      },
      tiktok: { ttclid: { value: 'ttc-1', firstSeenAt: '' } },
    },
  };

  const metaSend = jest.fn();
  const tiktokSend = jest.fn();
  const fakeMeta: TrackingProviderAdapter = {
    provider: 'meta',
    version: 1,
    providerApiVersion: 'v22.0',
    supports: () => true,
    build: (snapshot) => buildPayload(snapshot.eventType),
    send: metaSend,
  };
  const fakeTiktok: TrackingProviderAdapter = {
    provider: 'tiktok',
    version: 1,
    providerApiVersion: 'v1.3',
    supports: () => true,
    build: (snapshot) => buildPayload(snapshot.eventType),
    send: tiktokSend,
  };

  const job: DispatchJob = { snapshotId: 'snap-1', outboxId: 'outbox-1', attemptCount: 0 };

  beforeEach(() => {
    jest.clearAllMocks();
    snapshotFindUnique.mockResolvedValue(snapshot);
    outboxFindUnique.mockResolvedValue(outbox);
    contextGetByCtxId.mockResolvedValue(contextRow);
    dispatchFindUnique.mockResolvedValue(null);
    dispatchCreate.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: `d-${data.provider}`,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    dispatchUpdate.mockResolvedValue({});
    dispatchEventCreate.mockResolvedValue({});
    outboxUpdate.mockResolvedValue({});
    settingsGet.mockResolvedValue(null);
    getTestEventCode.mockResolvedValue(null);
    configGet.mockReturnValue(undefined);
    dlqMirror.mockResolvedValue(undefined);
    replayArchive.mockResolvedValue(undefined);
    mockBuildAdapterRegistry.mockReturnValue([fakeMeta, fakeTiktok]);
    metaSend.mockResolvedValue(okResult());
    tiktokSend.mockResolvedValue(okResult());
  });

  it('dispatches every eligible provider independently and SENTs the outbox when all succeed', async () => {
    await service.process(job, 'job-1');

    expect(metaSend).toHaveBeenCalledTimes(1);
    expect(tiktokSend).toHaveBeenCalledTimes(1);

    // find-or-create under @@unique([snapshotId, provider]) — one row per provider.
    const creates = dispatchCreate.mock.calls.map((c) => c[0].data);
    expect(creates).toHaveLength(2);
    expect(creates.map((d) => d.provider).sort()).toEqual(['meta', 'tiktok']);
    expect(creates.find((d) => d.provider === 'meta')).toMatchObject({
      snapshotId: 'snap-1',
      eventId: 'purchase_ord-1',
      orderId: 'ord-1',
      ctxId: 'ctx-1',
      providerEventId: 'purchase_ord-1',
      status: 'PENDING',
      adapterVersion: 1,
      providerApiVersion: 'v22.0',
      payloadVersion: 1,
      normalizerVersion: 1,
    });

    // Each provider advanced its own row to SENT with attemptCount++ and versions.
    expect(dispatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd-meta' },
        data: expect.objectContaining({ status: 'SENT', attemptCount: 1, httpStatus: 200 }),
      }),
    );
    expect(dispatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd-tiktok' },
        data: expect.objectContaining({ status: 'SENT', attemptCount: 1, httpStatus: 200 }),
      }),
    );

    // Outbox reached SENT with dispatchedAt.
    expect(outboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({ status: 'SENT', dispatchedAt: expect.any(Date) }),
      }),
    );

    // TrackingDispatchEvent rows appended for dispatch + outbox transitions.
    expect(dispatchEventCreate).toHaveBeenCalled();
    const toStatuses = dispatchEventCreate.mock.calls.map((c) => c[0].data.toStatus);
    expect(toStatuses).toContain('SENT');
  });

  it('keeps the outbox PENDING (retryable) and clears the lock when a provider fails transiently', async () => {
    tiktokSend.mockResolvedValue({
      ok: false,
      retryable: true,
      httpStatus: 500,
      rawResponse: 'upstream down',
    });

    await service.process(job, 'job-1');

    // SENT provider untouched; failing provider -> RETRY with attemptCount++.
    expect(metaSend).toHaveBeenCalledTimes(1);
    expect(dispatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd-tiktok' },
        data: expect.objectContaining({
          status: 'RETRY',
          attemptCount: 1,
          httpStatus: 500,
          errorMsg: 'upstream down',
        }),
      }),
    );

    // Outbox CLAIMED -> PENDING with backoff, lock cleared.
    expect(outboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({
          status: 'PENDING',
          attemptCount: 1,
          lockedAt: null,
          lockedBy: null,
          nextAttemptAt: expect.any(Date),
        }),
      }),
    );

    // Outbox transition event appended.
    expect(dispatchEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: null,
          fromStatus: 'CLAIMED',
          toStatus: 'PENDING',
          attempt: 1,
        }),
      }),
    );
  });

  it('never re-runs terminal SENT dispatch rows (work-set) but re-runs RETRY rows', async () => {
    dispatchFindUnique
      .mockResolvedValueOnce({ id: 'd-meta', provider: 'meta', status: 'SENT', attemptCount: 1 })
      .mockResolvedValueOnce({ id: 'd-tiktok', provider: 'tiktok', status: 'RETRY', attemptCount: 2 });

    await service.process(job, 'job-2');

    expect(metaSend).not.toHaveBeenCalled(); // SENT -> never re-send
    expect(tiktokSend).toHaveBeenCalledTimes(1); // RETRY -> re-run
    expect(dispatchCreate).not.toHaveBeenCalled(); // upsert found the existing rows

    expect(dispatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd-tiktok' },
        data: expect.objectContaining({ status: 'SENT', attemptCount: 3 }),
      }),
    );

    // All dispatch rows terminal -> outbox SENT.
    expect(outboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT' }),
      }),
    );
  });

  it('records SKIPPED for an unsupported provider and SENTs the outbox as a NOOP when zero are eligible', async () => {
    const fakeGa4: TrackingProviderAdapter = {
      provider: 'ga4',
      version: 1,
      providerApiVersion: 'mp/collect',
      supports: (eventType) => eventType !== 'Purchase', // instant mode suppresses Purchase
      build: jest.fn(),
      send: jest.fn(),
    };
    mockBuildAdapterRegistry.mockReturnValue([fakeGa4]);
    outboxFindUnique.mockResolvedValue({
      ...outbox,
      configSnapshot: { enabledProviders: ['ga4'], successPolicy: 'ALL_SENT' },
    });

    await service.process(job, 'job-1');

    expect(fakeGa4.send).not.toHaveBeenCalled();
    expect(dispatchCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provider: 'ga4', status: 'SKIPPED', adapterVersion: null }),
      }),
    );
    expect(outboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({ status: 'SENT', dispatchedAt: expect.any(Date) }),
      }),
    );
  });

  it('marks the outbox DEAD (with lastError) when a required provider permanently fails under ALL_SENT', async () => {
    tiktokSend.mockResolvedValue({
      ok: false,
      retryable: false,
      httpStatus: 400,
      rawResponse: 'invalid token',
    });

    await service.process(job, 'job-1');

    expect(dispatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd-tiktok' },
        data: expect.objectContaining({ status: 'FAILED', errorMsg: 'invalid token' }),
      }),
    );
    expect(outboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({
          status: 'DEAD',
          lastError: expect.stringContaining('invalid token'),
        }),
      }),
    );
  });

  it('marks the outbox DEAD once retry attempts exceed the max', async () => {
    tiktokSend.mockResolvedValue({
      ok: false,
      retryable: true,
      httpStatus: 500,
      rawResponse: 'still down',
    });
    outboxFindUnique.mockResolvedValue({ ...outbox, attemptCount: 5 });

    await service.process(job, 'job-1');

    expect(outboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({ status: 'DEAD' }),
      }),
    );
  });

  it('marks a provider SKIPPED when build() refuses the payload', async () => {
    fakeMeta.build = () => null;

    await service.process(job, 'job-1');

    expect(metaSend).not.toHaveBeenCalled();
    expect(dispatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd-meta' },
        data: expect.objectContaining({ status: 'SKIPPED' }),
      }),
    );
    // tiktok succeeded + meta SKIPPED -> all terminal -> SENT.
    expect(outboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT' }),
      }),
    );
  });

  it('maps the context view (externalId/ip/fbp/fbc/gaClientId/gclid/ttclid) for adapter build()', async () => {
    let capturedCtx: any;
    fakeMeta.build = (snapshot, ctx) => {
      capturedCtx = ctx;
      return buildPayload(snapshot.eventType);
    };

    await service.process(job, 'job-1');

    expect(capturedCtx).toMatchObject({
      externalId: 'ext-1',
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0',
      url: 'https://ecomate.example/checkout',
      referrer: 'https://ecomate.example/product/sku-1',
      fbp: 'fbp.1',
      fbc: 'fbc.2',
      gaClientId: 'ga-1',
      gclid: 'gcl-1',
      ttclid: 'ttc-1',
    });
  });

  it('never creates duplicate dispatch rows when the same snapshot is re-processed', async () => {
    await service.process(job, 'job-1');
    expect(dispatchCreate).toHaveBeenCalledTimes(2);
    expect(metaSend).toHaveBeenCalledTimes(1);
    expect(tiktokSend).toHaveBeenCalledTimes(1);

    // Re-claimed run: rows now SENT -> work-set skips them, no creates, no sends.
    dispatchFindUnique.mockResolvedValue({
      id: 'd-meta',
      provider: 'meta',
      status: 'SENT',
      attemptCount: 1,
    });
    await service.process(job, 'job-2');

    expect(dispatchCreate).toHaveBeenCalledTimes(2); // unchanged — upsert, not create
    expect(metaSend).toHaveBeenCalledTimes(1);
    expect(tiktokSend).toHaveBeenCalledTimes(1);
  });

  it('returns early without touching dispatch rows when the outbox is already terminal', async () => {
    outboxFindUnique.mockResolvedValue({ ...outbox, status: 'SENT' });

    await service.process(job, 'job-1');

    expect(metaSend).not.toHaveBeenCalled();
    expect(dispatchFindUnique).not.toHaveBeenCalled();
    expect(dispatchCreate).not.toHaveBeenCalled();
    expect(outboxUpdate).not.toHaveBeenCalled();
  });

  it('propagates the business eventTime (BigInt column) into the adapter payload as a number', async () => {
    let captured: any;
    fakeMeta.build = (snapshot) => {
      captured = snapshot;
      return buildPayload(snapshot.eventType);
    };

    await service.process(job, 'job-1');

    expect(captured.eventTime).toBe(Number(snapshot.eventTime)); // Number(BigInt(1722585600))
    expect(typeof captured.eventTime).toBe('number');
  });

  it('releases a stuck CLAIMED outbox (PENDING, lock cleared) when process() throws', async () => {
    snapshotFindUnique.mockRejectedValueOnce(new Error('boom'));

    await expect(service.process(job, 'job-1')).rejects.toThrow('boom');

    // Best-effort release fired: row re-claimable — PENDING, attempts++, lock cleared.
    expect(outboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({
          status: 'PENDING',
          attemptCount: 1,
          lockedAt: null,
          lockedBy: null,
          nextAttemptAt: expect.any(Date),
        }),
      }),
    );
  });

  it('mirrors the DEAD outbox to the DLQ (deterministic job identity) on a permanent provider failure', async () => {
    tiktokSend.mockResolvedValue({
      ok: false,
      retryable: false,
      httpStatus: 400,
      rawResponse: 'invalid token',
    });

    await service.process(job, 'job-1');

    expect(dlqMirror).toHaveBeenCalledWith(
      'outbox-1',
      'snap-1',
      null,
      expect.stringContaining('invalid token'),
      outbox.attemptCount,
    );
  });

  it('mirrors the DEAD outbox to the DLQ once retry attempts exceed the max', async () => {
    tiktokSend.mockResolvedValue({
      ok: false,
      retryable: true,
      httpStatus: 500,
      rawResponse: 'still down',
    });
    outboxFindUnique.mockResolvedValue({ ...outbox, attemptCount: 5 });

    await service.process(job, 'job-1');

    expect(dlqMirror).toHaveBeenCalledWith(
      'outbox-1',
      'snap-1',
      null,
      expect.stringContaining('max attempts'),
      5,
    );
  });

  it('never mirrors a terminal SENT outbox', async () => {
    await service.process(job, 'job-1');

    expect(outboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT' }),
      }),
    );
    expect(dlqMirror).not.toHaveBeenCalled();
  });

  it('a DLQ mirror failure does not affect the dispatch result (best-effort)', async () => {
    tiktokSend.mockResolvedValue({
      ok: false,
      retryable: false,
      httpStatus: 400,
      rawResponse: 'invalid token',
    });
    dlqMirror.mockRejectedValue(new Error('redis down'));

    await expect(service.process(job, 'job-1')).resolves.toBeUndefined();

    expect(outboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({ status: 'DEAD' }),
      }),
    );
  });

  it('archives the DEAD outbox (snapshot + payload + configSnapshot + pinned versions) for replay', async () => {
    tiktokSend.mockResolvedValue({
      ok: false,
      retryable: false,
      httpStatus: 400,
      rawResponse: 'invalid token',
    });

    await service.process(job, 'job-1');

    expect(replayArchive).toHaveBeenCalledTimes(1);
    const arg = replayArchive.mock.calls[0][0];
    expect(arg).toMatchObject({
      snapshotId: 'snap-1',
      eventId: 'purchase_ord-1',
      eventType: 'Purchase',
      eventTime: BigInt(1722585600),
      configSnapshot: outbox.configSnapshot,
    });
    // The archived payload is the enriched canonical payload (eventType/eventId/eventTime present).
    expect(arg.payload).toMatchObject({
      eventType: 'Purchase',
      eventId: 'purchase_ord-1',
      eventTime: Number(snapshot.eventTime),
      value: 100,
    });
    // Versions pinned from the dispatched adapters.
    expect(arg.versions).toMatchObject({
      schemaVersion: 1,
      payloadVersion: 1,
      normalizerVersion: 1,
      adapterVersion: 1,
      providerApiVersion: 'v22.0',
      providers: {
        meta: { adapterVersion: 1, providerApiVersion: 'v22.0' },
        tiktok: { adapterVersion: 1, providerApiVersion: 'v1.3' },
      },
    });
  });

  it('a replay archive write failure does not affect the dispatch result (best-effort)', async () => {
    tiktokSend.mockResolvedValue({
      ok: false,
      retryable: false,
      httpStatus: 400,
      rawResponse: 'invalid token',
    });
    replayArchive.mockRejectedValue(new Error('archive write failed'));

    await expect(service.process(job, 'job-1')).resolves.toBeUndefined();

    expect(outboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({ status: 'DEAD' }),
      }),
    );
  });
});
