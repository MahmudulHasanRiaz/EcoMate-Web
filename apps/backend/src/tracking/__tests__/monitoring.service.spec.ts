import { Prisma } from '@prisma/client';
import { MonitoringService } from '../monitoring.service';
import { DlqService } from '../dlq.service';

describe('MonitoringService — Phase 6 aggregate queries', () => {
  const snapshotGroupBy = jest.fn();
  const dispatchGroupBy = jest.fn();
  const snapshotCount = jest.fn();
  const contextCount = jest.fn();
  const outboxFindMany = jest.fn();

  const prisma = {
    trackingSnapshot: { groupBy: snapshotGroupBy, count: snapshotCount },
    trackingDispatch: { groupBy: dispatchGroupBy },
    trackingContext: { count: contextCount },
    trackingOutbox: { findMany: outboxFindMany },
  } as any;

  const dlq = { getStats: jest.fn() } as unknown as DlqService;
  const service = new MonitoringService(prisma, dlq);

  const hours = 24;
  const cutoff = expect.any(Date);

  beforeEach(() => {
    jest.clearAllMocks();
    snapshotGroupBy.mockResolvedValue([]);
    dispatchGroupBy.mockResolvedValue([]);
    snapshotCount.mockResolvedValue(0);
    contextCount.mockResolvedValue(0);
    outboxFindMany.mockResolvedValue([]);
    (dlq.getStats as jest.Mock).mockResolvedValue({ deadCount: 5, dlqDepth: 2 });
  });

  it('getVolumeByEventType groups snapshots by eventType over the window', async () => {
    snapshotGroupBy.mockResolvedValue([
      { eventType: 'Purchase', _count: 12 },
      { eventType: 'AddToCart', _count: 34 },
    ]);

    await expect(service.getVolumeByEventType(hours)).resolves.toEqual([
      { eventType: 'Purchase', count: 12 },
      { eventType: 'AddToCart', count: 34 },
    ]);
    expect(snapshotGroupBy).toHaveBeenCalledWith({
      by: ['eventType'],
      _count: true,
      where: { createdAt: { gte: cutoff } },
    });
  });

  it('getDispatchFunnel defaults every status to 0 and fills matched rows', async () => {
    dispatchGroupBy.mockResolvedValue([
      { status: 'PENDING', _count: 3 },
      { status: 'SENT', _count: 7 },
      { status: 'DEAD', _count: 1 },
    ]);

    await expect(service.getDispatchFunnel('meta', hours)).resolves.toEqual({
      pending: 3,
      sending: 0,
      sent: 7,
      retry: 0,
      failed: 0,
      dead: 1,
      skipped: 0,
      deduped: 0,
    });
    expect(dispatchGroupBy).toHaveBeenCalledWith({
      by: ['status'],
      _count: true,
      where: { provider: 'meta', createdAt: { gte: cutoff } },
    });
  });

  it('getDispatchFunnel covers every DISPATCH_STATUS key (funnel completeness)', async () => {
    dispatchGroupBy.mockResolvedValue([
      { status: 'PENDING', _count: 1 },
      { status: 'SENDING', _count: 1 },
      { status: 'SENT', _count: 1 },
      { status: 'RETRY', _count: 1 },
      { status: 'FAILED', _count: 1 },
      { status: 'DEAD', _count: 1 },
      { status: 'SKIPPED', _count: 1 },
      { status: 'DEDUPED', _count: 1 },
    ]);

    const funnel = await service.getDispatchFunnel('meta', hours);
    expect(Object.values(funnel)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(Object.keys(funnel).sort()).toEqual(
      ['dead', 'deduped', 'failed', 'pending', 'retry', 'sending', 'sent', 'skipped'].sort(),
    );
  });

  it('getDeadStats delegates to DlqService.getStats', async () => {
    await expect(service.getDeadStats()).resolves.toEqual({ deadCount: 5, dlqDepth: 2 });
    expect(dlq.getStats).toHaveBeenCalledTimes(1);
  });

  it('getRetryHistogram groups by attemptCount and sorts ascending', async () => {
    dispatchGroupBy.mockResolvedValue([
      { attemptCount: 3, _count: 2 },
      { attemptCount: 1, _count: 10 },
      { attemptCount: 2, _count: 4 },
    ]);

    await expect(service.getRetryHistogram()).resolves.toEqual([
      { attemptCount: 1, count: 10 },
      { attemptCount: 2, count: 4 },
      { attemptCount: 3, count: 2 },
    ]);
    expect(dispatchGroupBy).toHaveBeenCalledWith({
      by: ['attemptCount'],
      _count: true,
      where: { attemptCount: { gt: 0 } },
    });
  });

  it('getTopFailures groups non-null errorMsg for FAILED/DEAD, truncates to 300 chars, orders by count desc', async () => {
    const long = 'x'.repeat(400);
    dispatchGroupBy.mockResolvedValue([
      { errorMsg: long, _count: 9 },
      { errorMsg: 'timeout', _count: 3 },
    ]);

    const result = await service.getTopFailures(5);
    expect(result).toEqual([
      { errorMsg: 'x'.repeat(300), count: 9 },
      { errorMsg: 'timeout', count: 3 },
    ]);
    expect(dispatchGroupBy).toHaveBeenCalledWith({
      by: ['errorMsg'],
      _count: true,
      where: { errorMsg: { not: null }, status: { in: ['FAILED', 'DEAD'] } },
      orderBy: { _count: { errorMsg: 'desc' } },
      take: 5,
    });
  });

  it('getTopFailures defaults limit to 10', async () => {
    dispatchGroupBy.mockResolvedValue([]);
    await service.getTopFailures();
    expect(dispatchGroupBy).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
  });

  it('getFreshness computes mean and nearest-rank p95 of capture->dispatch latency in seconds', async () => {
    const base = new Date('2026-08-02T00:00:00.000Z');
    const rows = Array.from({ length: 20 }, (_, i) => ({
      createdAt: base,
      // 1..20 seconds of capture->dispatch latency
      dispatchedAt: new Date(base.getTime() + (i + 1) * 1000),
    }));
    outboxFindMany.mockResolvedValue(rows);

    const stats = await service.getFreshness(hours);
    expect(stats.avgCaptureToDispatchSec).toBeCloseTo(10.5, 5);
    // nearest-rank p95: ceil(0.95 * 20) = 19th sorted value (1-based) => 19 sec
    expect(stats.p95CaptureToDispatchSec).toBeCloseTo(19, 5);
    expect(outboxFindMany).toHaveBeenCalledWith({
      where: { dispatchedAt: { not: null }, createdAt: { gte: cutoff } },
      select: { createdAt: true, dispatchedAt: true },
    });
  });

  it('getFreshness returns zeros when no dispatched outbox is in the window', async () => {
    outboxFindMany.mockResolvedValue([]);
    await expect(service.getFreshness(hours)).resolves.toEqual({
      avgCaptureToDispatchSec: 0,
      p95CaptureToDispatchSec: 0,
    });
  });

  it('getDedupKeyUsage counts event_id/external_id snapshots and meta fbp/fbc context rows', async () => {
    snapshotCount.mockResolvedValueOnce(50).mockResolvedValueOnce(40);
    contextCount.mockResolvedValueOnce(30).mockResolvedValueOnce(12);

    await expect(service.getDedupKeyUsage(hours)).resolves.toEqual([
      { key: 'event_id', events: 50 },
      { key: 'external_id', events: 40 },
      { key: 'fbp', events: 30 },
      { key: 'fbc', events: 12 },
    ]);
    expect(snapshotCount).toHaveBeenNthCalledWith(1, {
      where: { createdAt: { gte: cutoff } },
    });
    expect(snapshotCount).toHaveBeenNthCalledWith(2, {
      where: {
        createdAt: { gte: cutoff },
        payload: { path: ['externalId'], not: Prisma.DbNull },
      },
    });
    expect(contextCount).toHaveBeenNthCalledWith(1, {
      where: {
        createdAt: { gte: cutoff },
        identifiers: { path: ['meta', 'fbp', 'value'], not: Prisma.DbNull },
      },
    });
    expect(contextCount).toHaveBeenNthCalledWith(2, {
      where: {
        createdAt: { gte: cutoff },
        identifiers: { path: ['meta', 'fbc', 'value'], not: Prisma.DbNull },
      },
    });
  });
});
