import { TrackingCaptureService, TrackingCaptureInput } from '../tracking-capture.service';
import { SCHEMA_VERSION } from '../tracking.constants';

describe('TrackingCaptureService', () => {
  const snapshotCreateMany = jest.fn();
  const snapshotFindUnique = jest.fn();
  const outboxCreateMany = jest.fn();
  const tx = {
    trackingSnapshot: { createMany: snapshotCreateMany, findUnique: snapshotFindUnique },
    trackingOutbox: { createMany: outboxCreateMany },
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

  it('returns DEDUPED for a repeat eventId without throwing or touching the outbox', async () => {
    snapshotCreateMany.mockResolvedValue({ count: 0 });

    const result = await service.capture(baseInput);

    expect(result).toEqual({ status: 'DEDUPED' });
    expect(snapshotFindUnique).not.toHaveBeenCalled();
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
});
