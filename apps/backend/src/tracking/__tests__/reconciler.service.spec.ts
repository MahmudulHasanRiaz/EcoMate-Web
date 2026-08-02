import { ReconcilerService } from '../reconciler.service';
import { getRetryBackoffMs } from '../outbox-relay.service';

describe('ReconcilerService', () => {
  const outboxCount = jest.fn();
  const outboxFindMany = jest.fn();
  const outboxUpdateMany = jest.fn();
  const snapshotFindMany = jest.fn();
  const dispatchFindMany = jest.fn();
  const dispatchUpdateMany = jest.fn();
  const dispatchEventCreate = jest.fn();

  const prisma = {
    trackingOutbox: {
      count: outboxCount,
      findMany: outboxFindMany,
      updateMany: outboxUpdateMany,
    },
    trackingSnapshot: { findMany: snapshotFindMany },
    trackingDispatch: {
      findMany: dispatchFindMany,
      updateMany: dispatchUpdateMany,
    },
    trackingDispatchEvent: { create: dispatchEventCreate },
  } as any;

  const service = new ReconcilerService(prisma);

  const now = new Date('2026-08-02T00:00:00.000Z');
  const staleClaimedOutbox = {
    id: 'outbox-1',
    snapshotId: 'snap-1',
    attemptCount: 2,
  };
  const snapshot = {
    id: 'snap-1',
    eventId: 'purchase_ord-1',
    orderId: 'ord-1',
    ctxId: 'ctx-1',
  };
  const hungDispatch = {
    id: 'dispatch-1',
    snapshotId: 'snap-1',
    eventId: 'purchase_ord-1',
    orderId: 'ord-1',
    ctxId: 'ctx-1',
    provider: 'meta',
    queueJobId: 'job-1',
    attemptCount: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    outboxCount.mockResolvedValue(0);
    outboxFindMany.mockResolvedValue([]);
    outboxUpdateMany.mockResolvedValue({ count: 0 });
    snapshotFindMany.mockResolvedValue([]);
    dispatchFindMany.mockResolvedValue([]);
    dispatchUpdateMany.mockResolvedValue({ count: 0 });
    dispatchEventCreate.mockResolvedValue({});
  });

  it('releases a stale CLAIMED outbox row (lock cleared, attemptCount++, backoff) and appends a dispatch event', async () => {
    outboxFindMany.mockResolvedValue([staleClaimedOutbox]);
    snapshotFindMany.mockResolvedValue([snapshot]);
    outboxUpdateMany.mockResolvedValue({ count: 1 });

    const summary = await service.reconcile(now);

    expect(summary).toEqual({ released: 1, retried: 0 });

    // Bulk release touches only rows still inside the stale CLAIMED window.
    expect(outboxUpdateMany).toHaveBeenCalledWith({
      where: { status: 'CLAIMED', lockedAt: { lt: expect.any(Date) } },
      data: {
        status: 'PENDING',
        attemptCount: { increment: 1 },
        lockedAt: null,
        lockedBy: null,
      },
    });
    // updateMany cannot express per-row backoff — nextAttemptAt is applied per row
    // from the pre-read attemptCount (guarded so a re-claimed row is never stomped).
    expect(outboxUpdateMany).toHaveBeenCalledWith({
      where: { id: 'outbox-1', status: 'PENDING', lockedAt: null },
      data: { nextAttemptAt: expect.any(Date) },
    });
    const [{ data: backoffData }] = outboxUpdateMany.mock.calls.find(
      (c) => c[0].where.id === 'outbox-1',
    );
    const expected = now.getTime() + getRetryBackoffMs(3); // attemptCount 2 -> 3 = 1h
    expect(backoffData.nextAttemptAt.getTime()).toBe(expected);

    // A TrackingDispatchEvent records CLAIMED -> PENDING for the audit trail.
    expect(dispatchEventCreate).toHaveBeenCalledWith({
      data: {
        snapshotId: 'snap-1',
        eventId: 'purchase_ord-1',
        orderId: 'ord-1',
        ctxId: 'ctx-1',
        provider: null,
        queueJobId: null,
        fromStatus: 'CLAIMED',
        toStatus: 'PENDING',
        attempt: 3,
        message: 'reconciler: stale claim released',
      },
    });
    // No SENDING rows were touched.
    expect(dispatchUpdateMany).not.toHaveBeenCalled();
  });

  it('marks a hung SENDING dispatch row RETRY (retryable) and appends a dispatch event', async () => {
    dispatchFindMany.mockResolvedValue([hungDispatch]);
    dispatchUpdateMany.mockResolvedValue({ count: 1 });

    const summary = await service.reconcile(now);

    expect(summary).toEqual({ released: 0, retried: 1 });

    expect(dispatchUpdateMany).toHaveBeenCalledWith({
      where: { status: 'SENDING', updatedAt: { lt: expect.any(Date) } },
      data: { status: 'RETRY' },
    });
    expect(dispatchEventCreate).toHaveBeenCalledWith({
      data: {
        snapshotId: 'snap-1',
        eventId: 'purchase_ord-1',
        orderId: 'ord-1',
        ctxId: 'ctx-1',
        provider: 'meta',
        queueJobId: 'job-1',
        fromStatus: 'SENDING',
        toStatus: 'RETRY',
        attempt: 1,
        message: 'reconciler: hung dispatch marked retry',
      },
    });
    // No CLAIMED outbox rows were touched.
    expect(outboxUpdateMany).not.toHaveBeenCalled();
  });

  it('leaves fresh CLAIMED outbox rows and fresh SENDING dispatch rows alone', async () => {
    const summary = await service.reconcile(now);

    expect(summary).toEqual({ released: 0, retried: 0 });
    expect(outboxUpdateMany).not.toHaveBeenCalled();
    expect(dispatchUpdateMany).not.toHaveBeenCalled();
    expect(dispatchEventCreate).not.toHaveBeenCalled();
  });

  it('audits (logs, never mutates) PENDING rows that are already due for claim', async () => {
    outboxCount.mockResolvedValue(3);

    const summary = await service.reconcile(now);

    expect(summary).toEqual({ released: 0, retried: 0 });
    expect(outboxCount).toHaveBeenCalledWith({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
    });
    expect(outboxUpdateMany).not.toHaveBeenCalled();
    expect(dispatchUpdateMany).not.toHaveBeenCalled();
  });

  it('onModuleInit starts the 60s interval and onModuleDestroy stops it', async () => {
    jest.useFakeTimers();
    try {
      const startSpy = jest.spyOn(service, 'start').mockResolvedValue(undefined);
      await service.onModuleInit();
      expect(startSpy).toHaveBeenCalledTimes(1);
      startSpy.mockRestore();

      const stopSpy = jest.spyOn(service, 'stop').mockResolvedValue(undefined);
      await service.onModuleDestroy();
      expect(stopSpy).toHaveBeenCalledTimes(1);
      stopSpy.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });
});
