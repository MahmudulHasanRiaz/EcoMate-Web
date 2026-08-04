import { BadRequestException } from '@nestjs/common';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { MonitoringController } from '../monitoring.controller';
import { MonitoringService } from '../monitoring.service';
import { PrismaService } from '../../prisma/prisma.service';

/** Zero-filled funnel shape the service returns for every provider. */
const EMPTY_FUNNEL = {
  pending: 0,
  sending: 0,
  sent: 0,
  retry: 0,
  failed: 0,
  dead: 0,
  skipped: 0,
  deduped: 0,
};

describe('MonitoringController (admin monitoring endpoints)', () => {
  const monitoring = {
    getVolumeByEventType: jest.fn(),
    getDispatchFunnel: jest.fn(),
    getDeadStats: jest.fn(),
    getTopFailures: jest.fn(),
    getRetryHistogram: jest.fn(),
    getFreshness: jest.fn(),
    getDedupKeyUsage: jest.fn(),
    getRelayHealth: jest.fn(),
    getRuntimeHealth: jest.fn(),
    getMirrorCapture: jest.fn(),
    getEmqProxy: jest.fn(),
    getQualityRates: jest.fn(),
    getWatchdog: jest.fn(),
    getHealthScore: jest.fn(),
  };
  const prisma = {
    trackingSnapshot: { findUnique: jest.fn() },
    trackingDispatchEvent: { findMany: jest.fn() },
    trackingOutbox: { findUnique: jest.fn() },
  };
  let controller: MonitoringController;

  beforeEach(() => {
    jest.clearAllMocks();
    monitoring.getVolumeByEventType.mockResolvedValue([]);
    monitoring.getDispatchFunnel.mockResolvedValue({ ...EMPTY_FUNNEL });
    monitoring.getDeadStats.mockResolvedValue({ deadCount: 0, dlqDepth: 0 });
    monitoring.getTopFailures.mockResolvedValue([]);
    monitoring.getRetryHistogram.mockResolvedValue([]);
    monitoring.getFreshness.mockResolvedValue({
      avgCaptureToDispatchSec: 0,
      p95CaptureToDispatchSec: 0,
    });
    monitoring.getDedupKeyUsage.mockResolvedValue([]);
    monitoring.getRelayHealth.mockResolvedValue({
      relayEnabled: false,
      pendingCount: 0,
      claimedCount: 0,
      oldestPendingAgeSec: null,
    });
    monitoring.getRuntimeHealth.mockResolvedValue({
      relay: { relayEnabled: false, pendingCount: 0, claimedCount: 0, oldestPendingAgeSec: null },
      redis: { connected: false },
      queue: { waiting: -1, active: -1, delayed: -1, failed: -1, completed: -1, reachable: false },
      dispatcher: { sending: 0 },
    });
    monitoring.getMirrorCapture.mockResolvedValue({
      totalSnapshots: 0,
      browserOrigin: 0,
      serverOrigin: 0,
      browserMirrorRatio: 0,
    });
    monitoring.getEmqProxy.mockResolvedValue({
      windowedDispatches: 0,
      qualityFlagged: 0,
      noEmPhShare: 0,
    });
    monitoring.getQualityRates.mockResolvedValue({
      windowedDispatches: 0,
      sent: 0,
      deduped: 0,
      failed: 0,
      dead: 0,
      retried: 0,
      replayed: 0,
      dedupRate: 0,
      retryRate: 0,
      emq: { windowedDispatches: 0, qualityFlagged: 0, noEmPhShare: 0 },
      mirror: {
        totalSnapshots: 0,
        browserOrigin: 0,
        serverOrigin: 0,
        browserMirrorRatio: 0,
      },
    });
    monitoring.getWatchdog.mockResolvedValue([]);
    monitoring.getHealthScore.mockResolvedValue({
      score: 100,
      grade: 'A',
      penalties: [],
    });
    controller = new MonitoringController(
      monitoring as unknown as MonitoringService,
      prisma as unknown as PrismaService,
    );
  });

  it('is gated with RequiresFeature(admin_tracking) at the class level', () => {
    const feature = Reflect.getMetadata(REQUIRES_FEATURE_KEY, MonitoringController);
    expect(feature).toBe('admin_tracking');
  });

  it('is gated with Roles(admin) at the class level', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, MonitoringController);
    expect(roles).toEqual(['admin']);
  });

  describe('GET /tracking/admin/monitoring/overview', () => {
    it('aggregates the dispatch funnel across every registry provider, plus volume + dead stats', async () => {
      monitoring.getVolumeByEventType.mockResolvedValue([
        { eventType: 'Purchase', count: 5 },
      ]);
      monitoring.getDeadStats.mockResolvedValue({ deadCount: 2, dlqDepth: 1 });
      const funnels: Record<string, typeof EMPTY_FUNNEL> = {
        meta: { ...EMPTY_FUNNEL, pending: 1, sent: 3 },
        tiktok: { ...EMPTY_FUNNEL, retry: 2 },
        ga4: { ...EMPTY_FUNNEL, failed: 1 },
        google_ads: { ...EMPTY_FUNNEL, dead: 1 },
      };
      monitoring.getDispatchFunnel.mockImplementation(async (provider: string) => funnels[provider]);

      const result = await controller.overview(undefined);

      expect(result.volumeByEventType).toEqual([{ eventType: 'Purchase', count: 5 }]);
      expect(result.deadStats).toEqual({ deadCount: 2, dlqDepth: 1 });
      expect(result.dispatchFunnel).toEqual(funnels);
      expect(monitoring.getDispatchFunnel).toHaveBeenCalledTimes(4);
      expect(Object.keys(result.dispatchFunnel).sort()).toEqual(
        ['ga4', 'google_ads', 'meta', 'tiktok'],
      );
      // default window
      expect(monitoring.getVolumeByEventType).toHaveBeenCalledWith(24);
      for (const provider of ['meta', 'tiktok', 'ga4', 'google_ads']) {
        expect(monitoring.getDispatchFunnel).toHaveBeenCalledWith(provider, 24);
      }
    });

    it('passes a valid hours window through to the service', async () => {
      await controller.overview('6');
      expect(monitoring.getVolumeByEventType).toHaveBeenCalledWith(6);
      expect(monitoring.getDispatchFunnel).toHaveBeenCalledWith('meta', 6);
    });

    it('caps hours at 168', async () => {
      await controller.overview('200');
      expect(monitoring.getVolumeByEventType).toHaveBeenCalledWith(168);
    });

    it('rejects non-positive or non-integer hours with 400', async () => {
      for (const bad of ['0', '-5', 'abc', '1.5']) {
        await expect(controller.overview(bad)).rejects.toThrow(BadRequestException);
      }
    });
  });

  describe('GET /tracking/admin/monitoring/failures', () => {
    it('returns topFailures + retryHistogram with default limit 10', async () => {
      monitoring.getTopFailures.mockResolvedValue([{ errorMsg: 'timeout', count: 3 }]);
      monitoring.getRetryHistogram.mockResolvedValue([{ attemptCount: 1, count: 9 }]);

      await expect(controller.failures(undefined)).resolves.toEqual({
        topFailures: [{ errorMsg: 'timeout', count: 3 }],
        retryHistogram: [{ attemptCount: 1, count: 9 }],
      });
      expect(monitoring.getTopFailures).toHaveBeenCalledWith(10);
      expect(monitoring.getRetryHistogram).toHaveBeenCalledTimes(1);
    });

    it('passes limit through to getTopFailures', async () => {
      await controller.failures('25');
      expect(monitoring.getTopFailures).toHaveBeenCalledWith(25);
    });

    it('rejects a non-positive or non-integer limit with 400', async () => {
      for (const bad of ['0', '-1', 'x', '2.5']) {
        await expect(controller.failures(bad)).rejects.toThrow(BadRequestException);
      }
    });
  });

  describe('GET /tracking/admin/monitoring/freshness', () => {
    it('returns capture->dispatch latency stats, delegating to getFreshness(hours)', async () => {
      monitoring.getFreshness.mockResolvedValue({
        avgCaptureToDispatchSec: 12.5,
        p95CaptureToDispatchSec: 20,
      });

      await expect(controller.freshness('12')).resolves.toEqual({
        avgCaptureToDispatchSec: 12.5,
        p95CaptureToDispatchSec: 20,
      });
      expect(monitoring.getFreshness).toHaveBeenCalledWith(12);
    });

    it('defaults hours to 24', async () => {
      await controller.freshness(undefined);
      expect(monitoring.getFreshness).toHaveBeenCalledWith(24);
    });
  });

  describe('GET /tracking/admin/monitoring/dedup', () => {
    it('returns dedup-key usage, delegating to getDedupKeyUsage(hours)', async () => {
      monitoring.getDedupKeyUsage.mockResolvedValue([
        { key: 'event_id', events: 50 },
        { key: 'external_id', events: 40 },
      ]);

      await expect(controller.dedup('24')).resolves.toEqual({
        keyUsage: [
          { key: 'event_id', events: 50 },
          { key: 'external_id', events: 40 },
        ],
      });
      expect(monitoring.getDedupKeyUsage).toHaveBeenCalledWith(24);
    });
  });

  describe('GET /tracking/admin/monitoring/health + mirror-capture (Wave 1)', () => {
    it('returns the expanded runtime health, delegating to getRuntimeHealth', async () => {
      monitoring.getRuntimeHealth.mockResolvedValue({
        relay: { relayEnabled: true, pendingCount: 3, claimedCount: 1, oldestPendingAgeSec: 60 },
        redis: { connected: true },
        queue: { waiting: 1, active: 2, delayed: 0, failed: 0, completed: 5, reachable: true },
        dispatcher: { sending: 1 },
      });

      await expect(controller.health()).resolves.toEqual({
        relayHealth: { relayEnabled: true, pendingCount: 3, claimedCount: 1, oldestPendingAgeSec: 60 },
        redisHealth: { connected: true },
        queueHealth: { waiting: 1, active: 2, delayed: 0, failed: 0, completed: 5, reachable: true },
        dispatcherHealth: { sending: 1 },
      });
    });

    it('returns the browser-mirror capture ratio, delegating to getMirrorCapture(hours)', async () => {
      monitoring.getMirrorCapture.mockResolvedValue({
        totalSnapshots: 59,
        browserOrigin: 10,
        serverOrigin: 49,
        browserMirrorRatio: 10 / 59,
      });

      await expect(controller.mirrorCapture('24')).resolves.toEqual({
        mirrorCapture: {
          totalSnapshots: 59,
          browserOrigin: 10,
          serverOrigin: 49,
          browserMirrorRatio: 10 / 59,
        },
      });
      expect(monitoring.getMirrorCapture).toHaveBeenCalledWith(24);
    });
  });

  describe('GET /tracking/admin/monitoring/timeline', () => {
    it('returns the dispatch-event rows plus snapshot eventType and outbox status', async () => {
      prisma.trackingSnapshot.findUnique.mockResolvedValue({
        id: 'snap-1',
        eventType: 'Purchase',
      });
      const rows = [
        {
          id: 'e-1',
          snapshotId: 'snap-1',
          eventId: 'purchase_1',
          provider: 'meta',
          fromStatus: null,
          toStatus: 'PENDING',
          createdAt: new Date(),
        },
        {
          id: 'e-2',
          snapshotId: 'snap-1',
          eventId: 'purchase_1',
          provider: 'meta',
          fromStatus: 'PENDING',
          toStatus: 'SENT',
          createdAt: new Date(),
        },
      ];
      prisma.trackingDispatchEvent.findMany.mockResolvedValue(rows);
      prisma.trackingOutbox.findUnique.mockResolvedValue({ status: 'SENT' });

      const result = await controller.timeline('purchase_1');

      expect(result.eventType).toBe('Purchase');
      expect(result.status).toBe('SENT');
      expect(result.events).toEqual(rows);
      expect(prisma.trackingSnapshot.findUnique).toHaveBeenCalledWith({
        where: { eventId: 'purchase_1' },
        select: { id: true, eventType: true },
      });
      expect(prisma.trackingDispatchEvent.findMany).toHaveBeenCalledWith({
        where: { eventId: 'purchase_1' },
        orderBy: { createdAt: 'asc' },
      });
      expect(prisma.trackingOutbox.findUnique).toHaveBeenCalledWith({
        where: { snapshotId: 'snap-1' },
        select: { status: true },
      });
    });

    it('returns empty events and null status for an eventId with no snapshot', async () => {
      prisma.trackingSnapshot.findUnique.mockResolvedValue(null);
      prisma.trackingDispatchEvent.findMany.mockResolvedValue([]);

      await expect(controller.timeline('ghost_1')).resolves.toEqual({
        eventType: null,
        status: null,
        events: [],
      });
      expect(prisma.trackingOutbox.findUnique).not.toHaveBeenCalled();
    });

    it('rejects with 400 when eventId is missing', async () => {
      await expect(controller.timeline(undefined)).rejects.toThrow(BadRequestException);
      expect(prisma.trackingDispatchEvent.findMany).not.toHaveBeenCalled();
    });
  });

  describe('GET /tracking/admin/monitoring/quality (Wave-2.4 MON-3)', () => {
    it('returns the consolidated dispatch-quality rates for the window', async () => {
      monitoring.getQualityRates.mockResolvedValue({
        windowedDispatches: 120,
        sent: 40,
        deduped: 10,
        failed: 3,
        dead: 2,
        retried: 5,
        replayed: 2,
        dedupRate: 0.2,
        retryRate: 0.07,
        emq: { windowedDispatches: 120, qualityFlagged: 30, noEmPhShare: 0.25 },
        mirror: {
          totalSnapshots: 120,
          browserOrigin: 60,
          serverOrigin: 60,
          browserMirrorRatio: 0.5,
        },
      });

      const result = await controller.quality('6');
      expect(result.quality.windowedDispatches).toBe(120);
      expect(result.quality.dedupRate).toBe(0.2);
      expect(monitoring.getQualityRates).toHaveBeenCalledWith(6);
    });

    it('defaults the window to 24 hours', async () => {
      await controller.quality(undefined);
      expect(monitoring.getQualityRates).toHaveBeenCalledWith(24);
    });
  });

  describe('GET /tracking/admin/monitoring/watchdog (Wave-2.4 MON-4)', () => {
    it('returns actionable violations from the watchdog', async () => {
      monitoring.getWatchdog.mockResolvedValue([
        { severity: 'critical', code: 'relay-backlog', message: 'relay stalled' },
        { severity: 'warning', code: 'emq-match-gap', message: 'no em/ph' },
      ]);

      const result = await controller.watchdog('6');
      expect(result.violations).toHaveLength(2);
      expect(result.violations[0].severity).toBe('critical');
      expect(monitoring.getWatchdog).toHaveBeenCalledWith(6);
    });
  });

  describe('GET /tracking/admin/monitoring/health-score (Wave-2.4 MON-4)', () => {
    it('returns the composite health score and grade', async () => {
      monitoring.getHealthScore.mockResolvedValue({
        score: 82,
        grade: 'B',
        penalties: [{ code: 'retry-rate-high', points: 10, message: 'retry elevated' }],
      });

      const result = await controller.healthScore('24');
      expect(result.healthScore.score).toBe(82);
      expect(result.healthScore.grade).toBe('B');
      expect(monitoring.getHealthScore).toHaveBeenCalledWith(24);
    });
  });
});
