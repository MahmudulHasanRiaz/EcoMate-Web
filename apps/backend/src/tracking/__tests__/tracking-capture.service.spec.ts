import { TrackingCaptureService, TrackingCaptureInput } from '../tracking-capture.service';
import { SCHEMA_VERSION } from '../tracking.constants';

describe('TrackingCaptureService', () => {
  const snapshotCreateMany = jest.fn();
  const snapshotFindUnique = jest.fn();
  const outboxCreateMany = jest.fn();
  const dispatchEventCreate = jest.fn();
  const tx = {
    trackingSnapshot: { createMany: snapshotCreateMany, findUnique: snapshotFindUnique },
    trackingOutbox: { createMany: outboxCreateMany },
    trackingDispatchEvent: { create: dispatchEventCreate },
  };
  const transactionMock = jest.fn((cb) => cb(tx));
  const prisma = { $transaction: transactionMock } as any;
  const service = new TrackingCaptureService(prisma);

  const baseInput: TrackingCaptureInput = {
    eventId: 'evt-1',
    eventType: 'AddToCart',
    orderId: 'ord-1',
    ctxId: 'ctx-1',
    eventTime: 1722585600,
    actionSource: 'web',
    payload: {
      value: 12.5,
      currency: 'USD',
      content_ids: ['sku-1'],
      contents: [{ id: 'sku-1', quantity: 1 }],
      customer: { email: 'buyer@example.com' },
    },
    configSnapshot: { providers: { meta: { pixelId: 'PIXEL' } } },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('captures a snapshot + outbox and returns CAPTURED', async () => {
    snapshotCreateMany.mockResolvedValue({ count: 1 });
    snapshotFindUnique.mockResolvedValue({ id: 'snap-1' });
    outboxCreateMany.mockResolvedValue({ count: 1 });

    const result = await service.capture(baseInput);

    expect(transactionMock).toHaveBeenCalled();
    expect(result).toEqual({ status: 'CAPTURED', snapshotId: 'snap-1' });

    // Snapshot: canonical, raw, provider-agnostic — schemaVersion + BigInt eventTime
    const [snapCall] = snapshotCreateMany.mock.calls;
    expect(snapCall[0].skipDuplicates).toBe(true);
    expect(snapCall[0].data[0]).toMatchObject({
      eventId: 'evt-1',
      eventType: 'AddToCart',
      orderId: 'ord-1',
      ctxId: 'ctx-1',
      actionSource: 'web',
      schemaVersion: SCHEMA_VERSION,
      payload: baseInput.payload,
    });
    expect(snapCall[0].data[0].eventTime).toBe(BigInt(1722585600));

    // Outbox: linked to the just-created snapshot, PENDING with retry/priority defaults
    const [outboxCall] = outboxCreateMany.mock.calls;
    expect(outboxCall[0].skipDuplicates).toBe(true);
    expect(outboxCall[0].data[0]).toMatchObject({
      snapshotId: 'snap-1',
      configSnapshot: baseInput.configSnapshot,
      status: 'PENDING',
      priority: 0,
    });
    expect(outboxCall[0].data[0].nextAttemptAt).toBeInstanceOf(Date);
  });

  it('returns DEDUPED for a repeat eventId without touching the outbox', async () => {
    snapshotCreateMany.mockResolvedValue({ count: 0 });
    snapshotFindUnique.mockResolvedValue({ id: 'snap-1' });

    const result = await service.capture(baseInput);

    expect(result).toEqual({ status: 'DEDUPED' });
    // The dedup marker (provider-null 'capture dedup' dispatch event) is the
    // durable signal feeding the monitoring dedupRate — findUnique only used to
    // resolve the required snapshotId FK.
    expect(snapshotFindUnique).toHaveBeenCalledWith({
      where: { eventId: 'evt-1' },
      select: { id: true },
    });
    expect(dispatchEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        snapshotId: 'snap-1',
        eventId: 'evt-1',
        provider: null,
        toStatus: 'DEDUPED',
        message: 'capture dedup',
      }),
    });
    expect(outboxCreateMany).not.toHaveBeenCalled();
  });

  it('sets priority 10 for Purchase and Refund events, 0 otherwise', async () => {
    snapshotCreateMany.mockResolvedValue({ count: 1 });
    snapshotFindUnique.mockResolvedValue({ id: 'snap-x' });

    await service.capture({ ...baseInput, eventId: 'evt-purchase', eventType: 'Purchase' });
    await service.capture({ ...baseInput, eventId: 'evt-refund', eventType: 'Refund' });
    await service.capture({ ...baseInput, eventId: 'evt-ctc', eventType: 'InitiateCheckout' });

    const priorities = outboxCreateMany.mock.calls.map((c) => c[0].data[0].priority);
    expect(priorities).toEqual([10, 10, 0]);
  });

  it('uses a caller-supplied transaction instead of opening a new one', async () => {
    snapshotCreateMany.mockResolvedValue({ count: 1 });
    snapshotFindUnique.mockResolvedValue({ id: 'snap-tx' });

    const result = await service.capture(baseInput, tx as any);

    expect(transactionMock).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'CAPTURED', snapshotId: 'snap-tx' });
  });

  describe('ensureValidatedDispatch', () => {
    const snapshotFind = jest.fn();
    const outboxFind = jest.fn();
    const outboxUpdate = jest.fn();
    const dispatchFind = jest.fn();
    const dispatchUpdate = jest.fn();
    const dispatchCreate = jest.fn();
    const dispatchEventCreate2 = jest.fn();
    const svc = new TrackingCaptureService({} as any);
    // ensureValidatedDispatch reads this.prisma directly (not via $transaction)
    svc.prisma = {
      trackingSnapshot: { findUnique: snapshotFind },
      trackingOutbox: { findUnique: outboxFind, update: outboxUpdate },
      trackingDispatch: { findUnique: dispatchFind, update: dispatchUpdate, create: dispatchCreate },
      trackingDispatchEvent: { create: dispatchEventCreate2 },
    } as any;

    beforeEach(() => jest.clearAllMocks());

    it('revives a SKIPPED dispatch row for a validated-mode provider', async () => {
      snapshotFind.mockResolvedValue({ id: 'snap-1' });
      outboxFind.mockResolvedValue({ id: 'ob-1', status: 'SENT' });
      dispatchFind.mockResolvedValue({ id: 'd-1', status: 'SKIPPED', orderId: 'ord-1', ctxId: 'ctx-1', attemptCount: 0 });

      const result = await svc.ensureValidatedDispatch('purchase_ord-uuid', ['meta']);

      expect(result.requeued).toBe(true);
      expect(result.providers).toEqual(['meta']);
      expect(dispatchUpdate).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        data: { status: 'PENDING', errorMsg: null },
      });
      expect(outboxUpdate).toHaveBeenCalledWith({
        where: { id: 'ob-1' },
        data: expect.objectContaining({ status: 'PENDING', nextAttemptAt: expect.any(Date) }),
      });
    });

    it('creates a new PENDING row when provider never dispatched', async () => {
      snapshotFind.mockResolvedValue({ id: 'snap-2' });
      outboxFind.mockResolvedValue({ id: 'ob-2', status: 'SENT' });
      dispatchFind.mockResolvedValue(null); // no row for this provider

      const result = await svc.ensureValidatedDispatch('purchase_ord-uuid', ['tiktok']);

      expect(result.requeued).toBe(true);
      expect(result.providers).toEqual(['tiktok']);
      expect(dispatchCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'PENDING', provider: 'tiktok' }),
      });
    });

    it('skips already-SENT rows to prevent duplicate delivery', async () => {
      snapshotFind.mockResolvedValue({ id: 'snap-3' });
      outboxFind.mockResolvedValue({ id: 'ob-3', status: 'SENT' });
      dispatchFind.mockResolvedValue({ id: 'd-3', status: 'SENT', orderId: null, ctxId: null, attemptCount: 1 });

      const result = await svc.ensureValidatedDispatch('purchase_ord-uuid', ['meta']);

      expect(result.requeued).toBe(false);
      expect(result.providers).toEqual([]);
      expect(dispatchUpdate).not.toHaveBeenCalled();
      expect(outboxUpdate).not.toHaveBeenCalled();
    });

    it('returns no requeue when snapshot does not exist', async () => {
      snapshotFind.mockResolvedValue(null);
      const result = await svc.ensureValidatedDispatch('purchase_nonexistent', ['meta']);
      expect(result.requeued).toBe(false);
      expect(result.providers).toEqual([]);
    });

    it('returns no requeue when providers list is empty', async () => {
      const result = await svc.ensureValidatedDispatch('purchase_ord-uuid', []);
      expect(result.requeued).toBe(false);
      expect(result.providers).toEqual([]);
    });

    it('revives EVERY capture-time destination of the provider (destination scope)', async () => {
      snapshotFind.mockResolvedValue({ id: 'snap-multi' });
      outboxFind.mockResolvedValue({
        id: 'ob-multi',
        status: 'SENT',
        configSnapshot: {
          destinations: [
            { provider: 'meta', destinationId: 'primary', pixelId: '111' },
            { provider: 'meta', destinationId: 'secondary', pixelId: '222' },
          ],
        },
      });
      dispatchFind.mockResolvedValue({
        id: 'd-x',
        status: 'SKIPPED',
        orderId: 'ord-1',
        ctxId: 'ctx-1',
        attemptCount: 0,
      });

      const result = await svc.ensureValidatedDispatch('purchase_ord-uuid', ['meta']);

      expect(result.requeued).toBe(true);
      // Backward-compatible field stays provider-granular…
      expect(result.providers).toEqual(['meta']);
      // …and the new field reports the destination granularity.
      expect(result.destinations.sort()).toEqual(['meta:primary', 'meta:secondary']);
      // One revive per destination, keyed by the destination-aware composite.
      expect(dispatchFind).toHaveBeenCalledWith({
        where: {
          snapshotId_provider_destinationId: {
            snapshotId: 'snap-multi',
            provider: 'meta',
            destinationId: 'primary',
          },
        },
      });
      expect(dispatchFind).toHaveBeenCalledWith({
        where: {
          snapshotId_provider_destinationId: {
            snapshotId: 'snap-multi',
            provider: 'meta',
            destinationId: 'secondary',
          },
        },
      });
    });

    it('does not revive another provider’s destinations', async () => {
      snapshotFind.mockResolvedValue({ id: 'snap-mixed' });
      outboxFind.mockResolvedValue({
        id: 'ob-mixed',
        status: 'SENT',
        configSnapshot: {
          destinations: [
            { provider: 'meta', destinationId: 'primary', pixelId: '111' },
            { provider: 'tiktok', destinationId: 'default', pixelId: 'tt-1' },
          ],
        },
      });
      dispatchFind.mockResolvedValue({
        id: 'd-y',
        status: 'SKIPPED',
        orderId: null,
        ctxId: null,
        attemptCount: 0,
      });

      const result = await svc.ensureValidatedDispatch('purchase_ord-uuid', ['meta']);

      expect(result.destinations).toEqual(['meta:primary']);
      // Only the meta destination was looked up.
      const lookedUp = dispatchFind.mock.calls.map(
        (c) => c[0].where.snapshotId_provider_destinationId.destinationId,
      );
      expect(lookedUp).toEqual(['primary']);
    });

    it('falls back to the legacy single destination for a pre-Step-3 snapshot', async () => {
      snapshotFind.mockResolvedValue({ id: 'snap-legacy' });
      outboxFind.mockResolvedValue({ id: 'ob-legacy', status: 'SENT' });
      dispatchFind.mockResolvedValue({
        id: 'd-z',
        status: 'SKIPPED',
        orderId: null,
        ctxId: null,
        attemptCount: 0,
      });

      const result = await svc.ensureValidatedDispatch('purchase_ord-uuid', ['meta']);

      expect(result.destinations).toEqual(['meta:default']);
    });
  });
});
