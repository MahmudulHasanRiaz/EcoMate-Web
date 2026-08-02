import { DlqService } from '../dlq.service';

describe('DlqService (tracking-dlq mirror + DEAD stats)', () => {
  const outboxCount = jest.fn();
  const queueAdd = jest.fn();
  const queueCount = jest.fn();

  const prisma = { trackingOutbox: { count: outboxCount } } as any;
  const dlqQueue = { add: queueAdd, count: queueCount } as any;
  const service = new DlqService(prisma, dlqQueue);

  beforeEach(() => {
    jest.clearAllMocks();
    outboxCount.mockResolvedValue(0);
    queueAdd.mockResolvedValue({ id: 'dlq-1' });
    queueCount.mockResolvedValue(0);
  });

  it('getStats returns the DB DEAD outbox count (primary KPI) and the DLQ queue depth', async () => {
    outboxCount.mockResolvedValue(7);
    queueCount.mockResolvedValue(3);

    await expect(service.getStats()).resolves.toEqual({ deadCount: 7, dlqDepth: 3 });
    expect(outboxCount).toHaveBeenCalledWith({ where: { status: 'DEAD' } });
    expect(queueCount).toHaveBeenCalledTimes(1);
  });

  it('mirror enqueues a tracking-dlq job with the deterministic <outboxId>:<attemptCount>:dlq jobId', async () => {
    await service.mirror('outbox-1', 'snap-1', 'meta', 'invalid token', 3);

    expect(queueAdd).toHaveBeenCalledWith(
      'dlq',
      {
        outboxId: 'outbox-1',
        snapshotId: 'snap-1',
        provider: 'meta',
        errorMsg: 'invalid token',
      },
      { jobId: 'outbox-1:3:dlq', removeOnComplete: 0 },
    );
  });

  it('mirror defaults provider/errorMsg to null and attemptCount to 0', async () => {
    await service.mirror('outbox-1', 'snap-1');

    expect(queueAdd).toHaveBeenCalledWith(
      'dlq',
      { outboxId: 'outbox-1', snapshotId: 'snap-1', provider: null, errorMsg: null },
      { jobId: 'outbox-1:0:dlq', removeOnComplete: 0 },
    );
  });

  it('a mirror enqueue failure does not propagate (best-effort ops visibility)', async () => {
    queueAdd.mockRejectedValue(new Error('redis down'));

    await expect(
      service.mirror('outbox-1', 'snap-1', 'meta', 'boom', 2),
    ).resolves.toBeUndefined();
  });

  it('getStats propagates a stats failure (explicit query, not best-effort)', async () => {
    queueCount.mockRejectedValue(new Error('redis down'));

    await expect(service.getStats()).rejects.toThrow('redis down');
  });
});
