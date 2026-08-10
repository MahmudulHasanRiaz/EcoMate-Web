import { Prisma } from '@prisma/client';
import { MonitoringService } from '../monitoring.service';
import { DlqService } from '../dlq.service';

describe('MonitoringService — Phase 6 aggregate queries', () => {
  const snapshotGroupBy = jest.fn();
  const dispatchGroupBy = jest.fn();
  const dispatchCount = jest.fn();
  const snapshotCount = jest.fn();
  const contextCount = jest.fn();
  const outboxFindMany = jest.fn();
  const outboxCount = jest.fn();
  const outboxFindFirst = jest.fn();
  const dispatchEventCount = jest.fn();

  const prisma = {
    trackingSnapshot: { groupBy: snapshotGroupBy, count: snapshotCount },
    trackingDispatch: { groupBy: dispatchGroupBy, count: dispatchCount },
    trackingContext: { count: contextCount },
    trackingOutbox: { findMany: outboxFindMany, count: outboxCount, findFirst: outboxFindFirst },
    trackingDispatchEvent: { count: dispatchEventCount },
  } as any;

  const dlq = { getStats: jest.fn() } as unknown as DlqService;
  const settings = { get: jest.fn() } as any;
  const queue = { getJobCounts: jest.fn(), redisVersion: '7.2.0' } as any;
  const service = new MonitoringService(prisma, dlq, settings, queue);

  const hours = 24;
  const cutoff = expect.any(Date);

  beforeEach(() => {
    jest.clearAllMocks();
    snapshotGroupBy.mockResolvedValue([]);
    dispatchGroupBy.mockResolvedValue([]);
    snapshotCount.mockResolvedValue(0);
    contextCount.mockResolvedValue(0);
    outboxFindMany.mockResolvedValue([]);
    outboxCount.mockResolvedValue(0);
    outboxFindFirst.mockResolvedValue(null);
    dispatchEventCount.mockResolvedValue(0);
    dispatchCount.mockResolvedValue(0);
    queue.getJobCounts.mockResolvedValue({
      waiting: 1, active: 2, delayed: 0, failed: 0, completed: 5,
    });
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

  it('getDedupKeyUsage counts event_id snapshots and external_id/fbp/fbc context rows', async () => {
    snapshotCount.mockResolvedValueOnce(50);
    contextCount
      .mockResolvedValueOnce(40) // external_id — every TrackingContext row carries one
      .mockResolvedValueOnce(30) // fbp
      .mockResolvedValueOnce(12); // fbc

    await expect(service.getDedupKeyUsage(hours)).resolves.toEqual([
      { key: 'event_id', events: 50 },
      { key: 'context_external_id', events: 40 },
      { key: 'fbp', events: 30 },
      { key: 'fbc', events: 12 },
    ]);
    expect(snapshotCount).toHaveBeenCalledTimes(1);
    expect(contextCount).toHaveBeenNthCalledWith(1, {
      where: { createdAt: { gte: cutoff } },
    });
    expect(contextCount).toHaveBeenNthCalledWith(2, {
      where: {
        createdAt: { gte: cutoff },
        identifiers: { path: ['meta', 'fbp', 'value'], not: Prisma.DbNull },
      },
    });
    expect(contextCount).toHaveBeenNthCalledWith(3, {
      where: {
        createdAt: { gte: cutoff },
        identifiers: { path: ['meta', 'fbc', 'value'], not: Prisma.DbNull },
      },
    });
  });

  it('getRelayHealth reports relay on/off plus outbox backlog depth and oldest pending age', async () => {
    (settings.get as jest.Mock).mockResolvedValue('true');
    outboxCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1); // pending, claimed
    outboxFindFirst.mockResolvedValue({ nextAttemptAt: new Date(Date.now() - 60_000) });

    await expect(service.getRelayHealth()).resolves.toEqual({
      relayEnabled: true,
      pendingCount: 3,
      claimedCount: 1,
      oldestPendingAgeSec: 60,
    });
    expect(settings.get).toHaveBeenCalledWith('tracking_relay_enabled', 'TRACKING_RELAY_ENABLED');
  });

  it('getRelayHealth returns null oldest age when nothing is due and relay off', async () => {
    (settings.get as jest.Mock).mockResolvedValue(null);
    outboxCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    outboxFindFirst.mockResolvedValue({ nextAttemptAt: new Date(Date.now() + 5_000) });

    await expect(service.getRelayHealth()).resolves.toEqual({
      relayEnabled: false,
      pendingCount: 0,
      claimedCount: 0,
      oldestPendingAgeSec: null,
    });
  });

  it('getMirrorCapture computes the browser-origin share of captures', async () => {
    outboxCount.mockResolvedValueOnce(10).mockResolvedValueOnce(59); // browser, total

    await expect(service.getMirrorCapture(hours)).resolves.toEqual({
      totalSnapshots: 59,
      browserOrigin: 10,
      serverOrigin: 49,
      browserMirrorRatio: 10 / 59,
    });
    expect(outboxCount).toHaveBeenNthCalledWith(1, {
      where: {
        createdAt: { gte: cutoff },
        configSnapshot: { path: ['source'], equals: 'browser' },
      },
    });
    expect(outboxCount).toHaveBeenNthCalledWith(2, {
      where: { createdAt: { gte: cutoff } },
    });
  });

  it('getMirrorCapture returns a zero ratio when there are no captures', async () => {
    outboxCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    await expect(service.getMirrorCapture(hours)).resolves.toEqual({
      totalSnapshots: 0,
      browserOrigin: 0,
      serverOrigin: 0,
      browserMirrorRatio: 0,
    });
  });

  it('getRuntimeHealth returns relay/redis/queue/dispatcher runtime health', async () => {
    // relay off
    (settings.get as jest.Mock).mockResolvedValue(null);
    outboxCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    outboxFindFirst.mockResolvedValue({ nextAttemptAt: new Date(Date.now() + 1_000) });
    // dispatcher sending rows
    dispatchCount.mockResolvedValueOnce(2);
    // queue + redis reachable via the mocks in beforeEach

    await expect(service.getRuntimeHealth()).resolves.toEqual({
      relay: {
        relayEnabled: false,
        pendingCount: 0,
        claimedCount: 0,
        oldestPendingAgeSec: null,
      },
      redis: { connected: true },
      queue: {
        waiting: 1, active: 2, delayed: 0, failed: 0, completed: 5, reachable: true,
      },
      dispatcher: { sending: 2 },
    });
  });

  it('getRuntimeHealth degrades redis/queue when the queue is unreachable', async () => {
    // redisConnected() reads the queue.redisVersion getter, which throws when the
    // Redis connection is down — simulate that, plus a failing job-count read.
    Object.defineProperty(queue, 'redisVersion', {
      configurable: true,
      get: () => {
        throw new Error('redis down');
      },
    });
    queue.getJobCounts.mockRejectedValue(new Error('redis down'));
    dispatchCount.mockResolvedValueOnce(0);

    const health = await service.getRuntimeHealth();
    expect(health.redis.connected).toBe(false);
    expect(health.queue.reachable).toBe(false);
    expect(health.queue.active).toBe(-1);
    expect(health.dispatcher.sending).toBe(0);
  });

  it('getEmqProxy computes the flagged share of windowed dispatches', async () => {
    dispatchEventCount.mockResolvedValueOnce(3).mockResolvedValueOnce(10); // flagged, total
    await expect(service.getEmqProxy(hours)).resolves.toEqual({
      windowedDispatches: 10,
      qualityFlagged: 3,
      noEmPhShare: 0.3,
    });
    expect(dispatchEventCount).toHaveBeenNthCalledWith(1, {
      where: {
        createdAt: { gte: cutoff },
        message: { startsWith: 'match-key quality:' },
      },
    });
    expect(dispatchEventCount).toHaveBeenNthCalledWith(2, {
      where: { createdAt: { gte: cutoff }, provider: { not: null } },
    });
  });

  it('getEmqProxy returns a zero share when there are no dispatches', async () => {
    dispatchEventCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    await expect(service.getEmqProxy(hours)).resolves.toEqual({
      windowedDispatches: 0,
      qualityFlagged: 0,
      noEmPhShare: 0,
    });
  });

  describe('getQualityRates (Wave-2.4 MON-3)', () => {
    it('combines the terminal funnel, replay volume, dedup/retry rates, and EMQ + mirror proxies', async () => {
      dispatchGroupBy.mockResolvedValue([
        { status: 'SENT', _count: 40 },
        { status: 'DEDUPED', _count: 10 },
        { status: 'FAILED', _count: 3 },
        { status: 'DEAD', _count: 2 },
        { status: 'RETRY', _count: 5 },
      ]);
      // getQualityRates' own dispatchEventCount reads: retry attempts, windowed,
      // replay, then getEmqProxy adds: quality-flagged, windowed; capture-dedup
      // markers. getMirrorCapture adds outboxCount ×2. Then the capture-level
      // dedup read + windowed snapshot count.
      dispatchEventCount
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(120)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(30)
        .mockResolvedValueOnce(120)
        .mockResolvedValueOnce(10); // 'capture dedup' markers
      snapshotCount.mockResolvedValueOnce(100); // capturedSnapshots
      outboxCount.mockResolvedValueOnce(60).mockResolvedValueOnce(120);

      const quality = await service.getQualityRates(hours);
      expect(quality).toMatchObject({
        windowedDispatches: 120,
        sent: 40,
        deduped: 10,
        failed: 3,
        dead: 2,
        retried: 5,
        replayed: 2,
        dedupedCaptures: 10,
        capturedSnapshots: 100,
        dedupRate: 10 / 110,
        retryRate: 8 / 120,
      });
      expect(quality.emq).toEqual({
        windowedDispatches: 120,
        qualityFlagged: 30,
        noEmPhShare: 0.25,
      });
      expect(quality.mirror).toMatchObject({
        browserOrigin: 60,
        totalSnapshots: 120,
        browserMirrorRatio: 0.5,
      });
    });

    it('zero-fills the rated fields when nothing dispatched in the window', async () => {
      dispatchGroupBy.mockResolvedValue([]);
      const quality = await service.getQualityRates(hours);
      expect(quality).toMatchObject({
        windowedDispatches: 0,
        sent: 0,
        deduped: 0,
        failed: 0,
        dead: 0,
        retried: 0,
        replayed: 0,
        dedupRate: 0,
        retryRate: 0,
      });
      expect(quality.emq.noEmPhShare).toBe(0);
    });
  });

  describe('getIdentityCoverage (incident follow-up, 2026-08-10)', () => {
    it('reports per-field coverage ratios over snapshot payloads and contexts', async () => {
      snapshotCount
        .mockResolvedValueOnce(80) // email
        .mockResolvedValueOnce(10) // phone
        .mockResolvedValueOnce(25) // firstName
        .mockResolvedValueOnce(5) // lastName
        .mockResolvedValueOnce(12) // city
        .mockResolvedValueOnce(0) // state
        .mockResolvedValueOnce(0) // zip
        .mockResolvedValueOnce(12) // country
        .mockResolvedValueOnce(100); // snapshot base
      contextCount
        .mockResolvedValueOnce(30) // ip
        .mockResolvedValueOnce(28) // userAgent
        .mockResolvedValueOnce(40); // context base

      const rows = await service.getIdentityCoverage(hours);

      expect(rows).toEqual([
        { field: 'email', base: 'snapshot', count: 80, total: 100, coverage: 0.8 },
        { field: 'phone', base: 'snapshot', count: 10, total: 100, coverage: 0.1 },
        { field: 'firstName', base: 'snapshot', count: 25, total: 100, coverage: 0.25 },
        { field: 'lastName', base: 'snapshot', count: 5, total: 100, coverage: 0.05 },
        { field: 'city', base: 'snapshot', count: 12, total: 100, coverage: 0.12 },
        { field: 'state', base: 'snapshot', count: 0, total: 100, coverage: 0 },
        { field: 'zip', base: 'snapshot', count: 0, total: 100, coverage: 0 },
        { field: 'country', base: 'snapshot', count: 12, total: 100, coverage: 0.12 },
        { field: 'ip', base: 'context', count: 30, total: 40, coverage: 0.75 },
        { field: 'userAgent', base: 'context', count: 28, total: 40, coverage: 0.7 },
      ]);
      expect(snapshotCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            payload: { path: ['customer', 'email'], not: Prisma.DbNull },
          }),
        }),
      );
    });

    it('returns zero-filled rows when nothing was captured', async () => {
      const rows = await service.getIdentityCoverage(hours);
      expect(rows.every((r) => r.count === 0 && r.coverage === 0)).toBe(true);
    });
  });

  describe('getWatchdog (Wave-2.4 MON-4)', () => {
    // Persistent (non-OwOnce) mocks: getWatchdog fans out to getRuntimeHealth +
    // getQualityRates concurrently, so a sequential mock queue would be order-racy.
    // A prior getRuntimeHealth test replaces queue.redisVersion with a throwing
    // accessor; restore it for the tests that need Redis up.
    const restoreRedisUp = () => {
      delete (queue as any).redisVersion;
      (queue as any).redisVersion = '7.2.0';
    };

    it('reports no violations on a healthy pipeline', async () => {
      restoreRedisUp();
      (settings.get as jest.Mock).mockResolvedValue('true'); // relay enabled
      outboxFindFirst.mockResolvedValue({
        nextAttemptAt: new Date(Date.now() + 5_000), // relay current
      });
      outboxCount.mockResolvedValue(0);
      dispatchCount.mockResolvedValue(0);
      dispatchGroupBy.mockResolvedValue([]);
      dispatchEventCount.mockResolvedValue(0);

      await expect(service.getWatchdog(hours)).resolves.toEqual([]);
    });

    it('flags a critical relay backlog when the oldest pending outbox is stale', async () => {
      restoreRedisUp();
      (settings.get as jest.Mock).mockResolvedValue('true');
      outboxFindFirst.mockResolvedValue({
        nextAttemptAt: new Date(Date.now() - 90_000), // 90s past due
      });
      outboxCount.mockResolvedValue(0);
      dispatchCount.mockResolvedValue(0);
      dispatchGroupBy.mockResolvedValue([]);
      dispatchEventCount.mockResolvedValue(0);

      const violations = await service.getWatchdog(hours);
      expect(violations).toEqual([
        expect.objectContaining({
          severity: 'critical',
          code: 'relay-backlog',
        }),
      ]);
    });

    it('flags critical redis + queue outages and info relay-disabled', async () => {
      Object.defineProperty(queue, 'redisVersion', {
        configurable: true,
        get: () => {
          throw new Error('redis down');
        },
      });
      queue.getJobCounts.mockRejectedValue(new Error('redis down'));
      (settings.get as jest.Mock).mockResolvedValue(null); // relay disabled
      outboxCount.mockResolvedValue(0);
      outboxFindFirst.mockResolvedValue(null);
      dispatchCount.mockResolvedValue(0);
      dispatchGroupBy.mockResolvedValue([]);
      dispatchEventCount.mockResolvedValue(0);

      const codes = (await service.getWatchdog(hours)).map((v) => v.code);
      expect(codes).toEqual(expect.arrayContaining(['redis-down', 'queue-down', 'relay-disabled']));
      expect(
        (await service.getWatchdog(hours)).filter((v) => v.severity === 'critical').map((v) => v.code),
      ).toEqual(expect.arrayContaining(['redis-down', 'queue-down']));
    });

    it('flags elevated retry rate, terminal-failure spike, and EMQ match gap', async () => {
      (settings.get as jest.Mock).mockResolvedValue(null); // relay disabled (info, benign)
      outboxFindFirst.mockResolvedValue(null);
      outboxCount.mockResolvedValue(0);
      dispatchCount.mockResolvedValue(0);
      dispatchGroupBy.mockResolvedValue([
        { status: 'SENT', _count: 5 },
        { status: 'FAILED', _count: 12 },
        { status: 'DEAD', _count: 3 },
      ]);
      // retried attempts (30), windowed (100), replay (0) from getQualityRates;
      // then getEmqProxy: flagged (60), windowed (100) — all persistent.
      dispatchEventCount
        .mockResolvedValueOnce(30)
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(0)
        .mockResolvedValue(60);

      const violations = await service.getWatchdog(hours);
      const codes = violations.map((v) => v.code);
      expect(codes).toEqual(
        expect.arrayContaining(['dead-failure-spike', 'retry-rate-high', 'emq-match-gap']),
      );
      for (const code of ['dead-failure-spike', 'retry-rate-high', 'emq-match-gap']) {
        expect(violations.find((v) => v.code === code)?.severity).toBe('warning');
      }
    });

    it('flags the DLQ pile-up, mirror collapse, and low identity coverage (2026-08-10 signals)', async () => {
      restoreRedisUp();
      (settings.get as jest.Mock).mockResolvedValue('true');
      outboxFindFirst.mockResolvedValue({
        nextAttemptAt: new Date(Date.now() + 5_000),
      });
      // deep DLQ + dead outbox rows
      (dlq.getStats as jest.Mock).mockResolvedValue({ deadCount: 9000, dlqDepth: 9000 });
      // mirror: total 200, browser 50 → ratio 0.25 < 0.5.
      // getWatchdog Fans out concurrently, so value mocks must be order-agnostic:
      // inspect the where-clause instead of sequencing mockResolvedValueOnce.
      outboxCount.mockImplementation((args: any) =>
        args?.where?.configSnapshot?.path?.[0] === 'source' ? 50 : 200,
      );
      // identity coverage: email 20/200, ip 50/150 (context base 150)
      snapshotCount.mockImplementation((args: any) => {
        const path = args?.where?.payload?.path;
        if (Array.isArray(path)) return path[1] === 'email' ? 20 : 0;
        return 200; // snapshot base + capturedSnapshots
      });
      contextCount.mockImplementation((args: any) => {
        if (args?.where?.ip) return 50;
        if (args?.where?.userAgent) return 50;
        return 150; // context base
      });
      dispatchEventCount.mockResolvedValue(0);
      dispatchGroupBy.mockResolvedValue([]);
      dispatchCount.mockResolvedValue(0);

      const violations = await service.getWatchdog(hours);
      const codes = violations.map((v) => v.code);
      expect(codes).toEqual(
        expect.arrayContaining(['dlq-depth-high', 'mirror-collapse', 'identity-coverage-low', 'context-coverage-low']),
      );
      expect(violations.filter((v) => v.code === 'dlq-depth-high').length).toBe(1);
    });
  });

  describe('getHealthScore (Wave-2.4 MON-4)', () => {
    // The getWatchdog redis-outage test replaces queue.redisVersion with a throwing
    // accessor; restore the normal value for the health-score tests that need Redis up.
    const restoreRedisUp = () => {
      delete (queue as any).redisVersion;
      (queue as any).redisVersion = '7.2.0';
    };

    it('scores 100 / grade A on a healthy pipeline with no penalties', async () => {
      restoreRedisUp();
      (settings.get as jest.Mock).mockResolvedValue('true');
      outboxFindFirst.mockResolvedValue({
        nextAttemptAt: new Date(Date.now() + 5_000),
      });
      outboxCount.mockResolvedValue(0);
      dispatchCount.mockResolvedValue(0);
      dispatchGroupBy.mockResolvedValue([]);
      dispatchEventCount.mockResolvedValue(0);

      await expect(service.getHealthScore(hours)).resolves.toEqual({
        score: 100,
        grade: 'A',
        penalties: [],
      });
    });

    it('penalizes a relay backlog (20) and queue outage (20) → 60 / D', async () => {
      restoreRedisUp();
      (settings.get as jest.Mock).mockResolvedValue('true');
      outboxFindFirst.mockResolvedValue({
        nextAttemptAt: new Date(Date.now() - 90_000),
      });
      queue.getJobCounts.mockRejectedValue(new Error('queue down'));
      outboxCount.mockResolvedValue(0);
      dispatchCount.mockResolvedValue(0);
      dispatchGroupBy.mockResolvedValue([]);
      dispatchEventCount.mockResolvedValue(0);

      const result = await service.getHealthScore(hours);
      expect(result.score).toBe(60);
      expect(result.grade).toBe('D');
      expect(result.penalties).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'relay-backlog', points: 20 }),
          expect.objectContaining({ code: 'queue-down', points: 20 }),
        ]),
      );
    });

    it('clamps the score at 0 when penalties exceed 100', async () => {
      (settings.get as jest.Mock).mockResolvedValue('true');
      outboxFindFirst.mockResolvedValue({
        nextAttemptAt: new Date(Date.now() - 90_000), // relay-backlog -20
      });
      queue.getJobCounts.mockRejectedValue(new Error('redis down')); // queue-down -20
      Object.defineProperty(queue, 'redisVersion', {
        configurable: true,
        get: () => {
          throw new Error('redis down');
        },
      });
      dispatchEventCount.mockResolvedValue(100); // retry-rate-high (-10) + emq-match-gap (-10)
      dispatchGroupBy.mockResolvedValue([
        { status: 'FAILED', _count: 100 }, // dead-failure-spike -20
        { status: 'DEAD', _count: 100 },
      ]);
      outboxCount.mockResolvedValue(0);
      dispatchCount.mockResolvedValue(0);

      const result = await service.getHealthScore(hours);
      expect(result.score).toBe(0);
      expect(result.grade).toBe('F');
    });
  });
});
