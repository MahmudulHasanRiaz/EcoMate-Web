import { OutboxRelayService } from '../outbox-relay.service';

describe('OutboxRelayService', () => {
  const queryRaw = jest.fn();
  const outboxUpdate = jest.fn();
  const prisma = {
    $queryRaw: queryRaw,
    trackingOutbox: { update: outboxUpdate },
  } as any;
  const trackingQueue = { add: jest.fn() } as any;
  const settings = { get: jest.fn() } as any;
  const service = new OutboxRelayService(prisma, trackingQueue, settings);

  beforeEach(() => {
    jest.clearAllMocks();
    settings.get.mockResolvedValue('true');
  });

  it('claims PENDING rows and enqueues one job per row with a composite jobId', async () => {
    queryRaw.mockResolvedValue([
      { id: 'outbox-1', snapshotId: 'snap-1', attemptCount: 0 },
      { id: 'outbox-2', snapshotId: 'snap-2', attemptCount: 0 },
    ]);
    trackingQueue.add.mockResolvedValue({ id: 'job' });

    const enqueued = await service.poll(50, 'relay-1');

    expect(enqueued).toBe(2);
    expect(trackingQueue.add).toHaveBeenCalledTimes(2);
    expect(trackingQueue.add).toHaveBeenNthCalledWith(
      1,
      'send',
      { snapshotId: 'snap-1', outboxId: 'outbox-1', attemptCount: 0 },
      {
        jobId: 'outbox-1:0',
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );
    expect(trackingQueue.add).toHaveBeenNthCalledWith(
      2,
      'send',
      { snapshotId: 'snap-2', outboxId: 'outbox-2', attemptCount: 0 },
      expect.objectContaining({ jobId: 'outbox-2:0' }),
    );
    // Rows were claimed via raw SQL with the instance id and batch size.
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw.mock.calls[0][0].strings.join('')).toContain('SKIP LOCKED');
    expect(queryRaw.mock.calls[0][0].strings.join('')).toContain('"TrackingOutbox"');
  });

  it('releases the lock and excludes the row from the count when enqueue fails', async () => {
    queryRaw.mockResolvedValue([
      { id: 'outbox-1', snapshotId: 'snap-1', attemptCount: 1 },
      { id: 'outbox-2', snapshotId: 'snap-2', attemptCount: 2 },
    ]);
    trackingQueue.add
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValueOnce({ id: 'job' });

    const enqueued = await service.poll();

    expect(enqueued).toBe(1);
    expect(outboxUpdate).toHaveBeenCalledTimes(1);
    expect(outboxUpdate).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: { status: 'PENDING', lockedAt: null, lockedBy: null },
    });
    // The successfully enqueued row keeps its CLAIMED lock.
    expect(outboxUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'outbox-2' } }),
    );
  });

  it('returns 0 without claiming or enqueueing when the relay is disabled', async () => {
    settings.get.mockResolvedValue('false');

    const enqueued = await service.poll();

    expect(enqueued).toBe(0);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(trackingQueue.add).not.toHaveBeenCalled();
  });

  it('skips starting the interval when the relay is disabled', async () => {
    settings.get.mockResolvedValue('false');

    await service.start();

    expect(queryRaw).not.toHaveBeenCalled();
    await service.stop(); // no-op, no timer
  });
});
