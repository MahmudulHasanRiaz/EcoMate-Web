import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { RetentionCleanupService } from '../retention-cleanup.service';

const DAY = 86_400_000;
const NOW = new Date('2026-08-02T00:00:00.000Z');
const cutoff90 = new Date(NOW.getTime() - 90 * DAY);
const cutoff30 = new Date(NOW.getTime() - 30 * DAY);
const cutoff1y = new Date(NOW.getTime() - 365 * DAY);
const cutoff2y = new Date(NOW.getTime() - 730 * DAY);

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

describe('RetentionCleanupService — Phase 7 scheduled retention/anonymization jobs', () => {
  const contextFindMany = jest.fn();
  const contextUpdateMany = jest.fn();
  const snapshotFindMany = jest.fn();
  const snapshotUpdateMany = jest.fn();
  const snapshotDeleteMany = jest.fn();
  const outboxFindMany = jest.fn();
  const outboxDeleteMany = jest.fn();
  const dispatchFindMany = jest.fn();
  const dispatchDeleteMany = jest.fn();
  const eventFindMany = jest.fn();
  const eventDeleteMany = jest.fn();
  const archiveFindMany = jest.fn();
  const archiveCreateMany = jest.fn();
  const transaction = jest.fn();

  const prisma = {
    trackingContext: { findMany: contextFindMany, updateMany: contextUpdateMany },
    trackingSnapshot: {
      findMany: snapshotFindMany,
      updateMany: snapshotUpdateMany,
      deleteMany: snapshotDeleteMany,
    },
    trackingOutbox: { findMany: outboxFindMany, deleteMany: outboxDeleteMany },
    trackingDispatch: { findMany: dispatchFindMany, deleteMany: dispatchDeleteMany },
    trackingDispatchEvent: { findMany: eventFindMany, deleteMany: eventDeleteMany },
    trackingReplayArchive: {
      findMany: archiveFindMany,
      createMany: archiveCreateMany,
    },
    $transaction: transaction,
  } as any;

  const config = { get: jest.fn() } as any;

  // Default instance is enabled (RETENTION_ENABLED unset → default true).
  const service = new RetentionCleanupService(prisma, config);

  const emptyFind = () => {
    contextFindMany.mockResolvedValue([]);
    snapshotFindMany.mockResolvedValue([]);
    outboxFindMany.mockResolvedValue([]);
    dispatchFindMany.mockResolvedValue([]);
    eventFindMany.mockResolvedValue([]);
    archiveFindMany.mockResolvedValue([]);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (config.get as jest.Mock).mockReturnValue(undefined);
    emptyFind();
    contextUpdateMany.mockResolvedValue({ count: 0 });
    snapshotUpdateMany.mockResolvedValue({ count: 0 });
    outboxDeleteMany.mockResolvedValue({ count: 0 });
    dispatchDeleteMany.mockResolvedValue({ count: 0 });
    eventDeleteMany.mockResolvedValue({ count: 0 });
    snapshotDeleteMany.mockResolvedValue({ count: 0 });
    archiveCreateMany.mockResolvedValue({ count: 0 });
    transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops));
  });

  describe('anonymizeContexts', () => {
    it('nulls identifiers/ip/ua/url/referrer for stale contexts and keeps ctxId/externalId (timestamps untouched)', async () => {
      contextFindMany
        .mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }])
        .mockResolvedValue([]);
      contextUpdateMany.mockResolvedValue({ count: 2 });

      await expect(service.anonymizeContexts(NOW)).resolves.toBe(2);

      expect(contextFindMany).toHaveBeenNthCalledWith(1, {
        where: { lastSeenAt: { lt: cutoff90 }, identifiers: { not: {} } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 1000,
      });
      // Only the PII columns are nulled — ctxId/externalId/firstSeenAt are absent.
      expect(contextUpdateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['c1', 'c2'] },
          lastSeenAt: { lt: cutoff90 },
          identifiers: { not: {} },
        },
        data: {
          identifiers: {},
          ip: null,
          userAgent: null,
          url: null,
          referrer: null,
        },
      });
    });

    it('walks id-cursor pages until an empty batch', async () => {
      const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `c${i}` }));
      contextFindMany
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce([{ id: 'c1000' }])
        .mockResolvedValue([]);
      contextUpdateMany
        .mockResolvedValueOnce({ count: 1000 })
        .mockResolvedValueOnce({ count: 1 });

      await expect(service.anonymizeContexts(NOW)).resolves.toBe(1001);

      expect(contextFindMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ take: 1000 }));
      expect(contextFindMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          cursor: { id: 'c999' },
          skip: 1,
          where: { lastSeenAt: { lt: cutoff90 }, identifiers: { not: {} } },
        }),
      );
    });
  });

  describe('nullSnapshotPayloads', () => {
    it('nulls payloads older than 90d only when not already JSON-null', async () => {
      snapshotFindMany
        .mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }])
        .mockResolvedValue([]);
      snapshotUpdateMany.mockResolvedValue({ count: 2 });

      await expect(service.nullSnapshotPayloads(NOW)).resolves.toBe(2);

      expect(snapshotFindMany).toHaveBeenNthCalledWith(1, {
        where: { createdAt: { lt: cutoff90 }, payload: { not: Prisma.JsonNull } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 1000,
      });
      expect(snapshotUpdateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['s1', 's2'] },
          createdAt: { lt: cutoff90 },
          payload: { not: Prisma.JsonNull },
        },
        data: { payload: Prisma.JsonNull },
      });
    });
  });

  describe('purgeTerminalOutboxes', () => {
    it('purges SENT/DEAD outboxes dispatched over 30d ago plus their dispatch events', async () => {
      outboxFindMany
        .mockResolvedValueOnce([
          { id: 'o1', snapshotId: 's1' },
          { id: 'o2', snapshotId: 's1' },
          { id: 'o3', snapshotId: 's2' },
        ])
        .mockResolvedValue([]);
      outboxDeleteMany.mockResolvedValue({ count: 3 });
      eventDeleteMany.mockResolvedValue({ count: 5 });

      await expect(service.purgeTerminalOutboxes(NOW)).resolves.toBe(3);

      expect(outboxFindMany).toHaveBeenNthCalledWith(1, {
        where: { status: { in: ['SENT', 'DEAD'] }, dispatchedAt: { lt: cutoff30 } },
        select: { id: true, snapshotId: true },
        orderBy: { id: 'asc' },
        take: 1000,
      });
      expect(outboxDeleteMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['o1', 'o2', 'o3'] },
          status: { in: ['SENT', 'DEAD'] },
          dispatchedAt: { lt: cutoff30 },
        },
      });
      // Matching dispatch events keyed by deduplicated snapshotIds.
      expect(eventDeleteMany).toHaveBeenCalledWith({
        where: { snapshotId: { in: ['s1', 's2'] } },
      });
    });
  });

  describe('purgeOldDispatches', () => {
    it('purges dispatch and dispatch-event rows older than 1y', async () => {
      dispatchFindMany
        .mockResolvedValueOnce([{ id: 'd1' }, { id: 'd2' }])
        .mockResolvedValue([]);
      dispatchDeleteMany.mockResolvedValue({ count: 2 });
      eventFindMany
        .mockResolvedValueOnce([{ id: 'e1' }])
        .mockResolvedValue([]);
      eventDeleteMany.mockResolvedValue({ count: 1 });

      await expect(service.purgeOldDispatches(NOW)).resolves.toEqual({
        dispatchesPurged: 2,
        dispatchEventsPurged: 1,
      });

      expect(dispatchFindMany).toHaveBeenNthCalledWith(1, {
        where: { createdAt: { lt: cutoff1y } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 1000,
      });
      expect(dispatchDeleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['d1', 'd2'] }, createdAt: { lt: cutoff1y } },
      });
      expect(eventFindMany).toHaveBeenNthCalledWith(1, {
        where: { createdAt: { lt: cutoff1y } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 1000,
      });
      expect(eventDeleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['e1'] }, createdAt: { lt: cutoff1y } },
      });
    });
  });

  describe('archiveAndPurgeSnapshots', () => {
    it('writes a PII-stripped ReplayArchive BEFORE deleting snapshot/outbox/dispatch rows (2y)', async () => {
      // Page 1: two 2y-old snapshots; s2 is already archived.
      snapshotFindMany
        .mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }])
        .mockResolvedValue([]);
      archiveFindMany.mockResolvedValue([{ snapshotId: 's2' }]);
      // Full rows for the unarchived subset.
      snapshotFindMany
        .mockResolvedValueOnce([
          {
            id: 's1',
            eventId: 'evt-1',
            eventType: 'Purchase',
            eventTime: 1_750_000_000n,
            payload: {
              eventType: 'Purchase',
              value: 100,
              customer: { email: 'User@Example.com', phone: '+8801711111111', country: 'BD' },
            },
            createdAt: NOW,
          },
        ])
        .mockResolvedValue([]);
      outboxFindMany.mockResolvedValue([
        { snapshotId: 's1', status: 'DEAD', configSnapshot: { enabledProviders: ['meta'] } },
      ]);
      dispatchFindMany.mockResolvedValue([
        {
          snapshotId: 's1',
          provider: 'meta',
          adapterVersion: 2,
          providerApiVersion: 'v21.0',
        },
      ]);
      archiveCreateMany.mockResolvedValue({ count: 1 });
      outboxDeleteMany.mockResolvedValue({ count: 1 });
      dispatchDeleteMany.mockResolvedValue({ count: 1 });
      eventDeleteMany.mockResolvedValue({ count: 1 });
      snapshotDeleteMany.mockResolvedValue({ count: 1 });

      await expect(service.archiveAndPurgeSnapshots(NOW)).resolves.toEqual({
        snapshotsArchived: 1,
        snapshotsPurged: 1,
      });

      // Archive predicate only on snapshot age; already-archived ids excluded via the archive lookup.
      expect(snapshotFindMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { createdAt: { lt: cutoff2y } },
          select: { id: true },
          take: 1000,
        }),
      );
      expect(archiveFindMany).toHaveBeenCalledWith({
        where: { snapshotId: { in: ['s1', 's2'] } },
        select: { snapshotId: true },
      });

      // PII stripped: email/phone become SHA-256 hashes, envelope preserved.
      expect(archiveCreateMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            snapshotId: 's1',
            eventId: 'evt-1',
            eventType: 'Purchase',
            eventTime: 1_750_000_000n,
            archivedPayload: {
              eventType: 'Purchase',
              value: 100,
              customer: {
                email: sha256('user@example.com'),
                phone: sha256('8801711111111'),
                country: 'BD',
              },
            },
            configSnapshot: { enabledProviders: ['meta'] },
            versions: expect.objectContaining({
              schemaVersion: 1,
              payloadVersion: 1,
              normalizerVersion: 1,
              adapterVersion: 2,
              providerApiVersion: 'v21.0',
              providers: { meta: { adapterVersion: 2, providerApiVersion: 'v21.0' } },
            }),
          }),
        ],
        skipDuplicates: true,
      });

      // createMany archive is the FIRST op; snapshot delete is the LAST op.
      const ops = transaction.mock.calls[0][0] as unknown[];
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(ops).toHaveLength(5);
      expect(ops[0]).toBe(archiveCreateMany.mock.results[0].value);
      expect(ops[4]).toBe(snapshotDeleteMany.mock.results[0].value);

      expect(outboxDeleteMany).toHaveBeenCalledWith({
        where: { snapshotId: { in: ['s1'] } },
      });
      expect(dispatchDeleteMany).toHaveBeenCalledWith({
        where: { snapshotId: { in: ['s1'] } },
      });
      expect(eventDeleteMany).toHaveBeenCalledWith({
        where: { snapshotId: { in: ['s1'] } },
      });
      expect(snapshotDeleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['s1'] } },
      });
    });

    it('archives an already-anonymized snapshot with a JSON-null payload while preserving the envelope', async () => {
      snapshotFindMany
        .mockResolvedValueOnce([{ id: 's1' }])
        .mockResolvedValue([]);
      archiveFindMany.mockResolvedValue([]);
      snapshotFindMany
        .mockResolvedValueOnce([
          {
            id: 's1',
            eventId: 'evt-2',
            eventType: 'Lead',
            eventTime: 1_750_000_000n,
            payload: null,
            createdAt: NOW,
          },
        ])
        .mockResolvedValue([]);
      outboxFindMany.mockResolvedValue([
        { snapshotId: 's1', status: 'SENT', configSnapshot: {} },
      ]);
      dispatchFindMany.mockResolvedValue([]);
      archiveCreateMany.mockResolvedValue({ count: 1 });
      outboxDeleteMany.mockResolvedValue({ count: 1 });
      dispatchDeleteMany.mockResolvedValue({ count: 0 });
      eventDeleteMany.mockResolvedValue({ count: 0 });
      snapshotDeleteMany.mockResolvedValue({ count: 1 });

      await expect(service.archiveAndPurgeSnapshots(NOW)).resolves.toEqual({
        snapshotsArchived: 1,
        snapshotsPurged: 1,
      });

      expect(archiveCreateMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            snapshotId: 's1',
            eventId: 'evt-2',
            eventType: 'Lead',
            eventTime: 1_750_000_000n,
            archivedPayload: Prisma.JsonNull,
          }),
        ],
        skipDuplicates: true,
      });
    });

    it('skips the archive for a non-terminal outbox but still purges the snapshot', async () => {
      snapshotFindMany
        .mockResolvedValueOnce([{ id: 's1' }])
        .mockResolvedValue([]);
      archiveFindMany.mockResolvedValue([]);
      snapshotFindMany
        .mockResolvedValueOnce([
          {
            id: 's1',
            eventId: 'evt-3',
            eventType: 'Purchase',
            eventTime: 1_750_000_000n,
            payload: { eventType: 'Purchase' },
            createdAt: NOW,
          },
        ])
        .mockResolvedValue([]);
      outboxFindMany.mockResolvedValue([
        { snapshotId: 's1', status: 'FAILED', configSnapshot: {} },
      ]);
      dispatchFindMany.mockResolvedValue([]);
      outboxDeleteMany.mockResolvedValue({ count: 1 });
      dispatchDeleteMany.mockResolvedValue({ count: 0 });
      eventDeleteMany.mockResolvedValue({ count: 0 });
      snapshotDeleteMany.mockResolvedValue({ count: 1 });

      await expect(service.archiveAndPurgeSnapshots(NOW)).resolves.toEqual({
        snapshotsArchived: 0,
        snapshotsPurged: 1,
      });

      expect(archiveCreateMany).not.toHaveBeenCalled();
      expect(transaction.mock.calls[0][0]).toHaveLength(4); // no createMany op
      expect(snapshotDeleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['s1'] } },
      });
    });
  });

  describe('runCleanup + config gate', () => {
    it('runs every job in sequence and aggregates the summary', async () => {
      const summary = await service.runCleanup(NOW);

      expect(summary).toEqual({
        contextsAnonymized: 0,
        payloadsNulled: 0,
        terminalOutboxesPurged: 0,
        dispatchesPurged: 0,
        dispatchEventsPurged: 0,
        snapshotsArchived: 0,
        snapshotsPurged: 0,
      });
      expect(contextFindMany).toHaveBeenCalled();
      expect(snapshotFindMany).toHaveBeenCalled();
      expect(outboxFindMany).toHaveBeenCalled();
      expect(dispatchFindMany).toHaveBeenCalled();
      expect(eventFindMany).toHaveBeenCalled();
    });

    it('no-ops and issues no writes when RETENTION_ENABLED=false', async () => {
      (config.get as jest.Mock).mockReturnValue('false');
      const disabledService = new RetentionCleanupService(prisma, config);

      await expect(disabledService.runCleanup(NOW)).resolves.toEqual({
        contextsAnonymized: 0,
        payloadsNulled: 0,
        terminalOutboxesPurged: 0,
        dispatchesPurged: 0,
        dispatchEventsPurged: 0,
        snapshotsArchived: 0,
        snapshotsPurged: 0,
      });

      expect(contextFindMany).not.toHaveBeenCalled();
      expect(snapshotFindMany).not.toHaveBeenCalled();
      expect(outboxFindMany).not.toHaveBeenCalled();
      expect(dispatchFindMany).not.toHaveBeenCalled();
      expect(eventFindMany).not.toHaveBeenCalled();
      expect(archiveFindMany).not.toHaveBeenCalled();
    });

    it('onModuleInit boot-runs cleanup once, then the 6h interval, and stop clears the timer', async () => {
      jest.useFakeTimers();
      const svc = new RetentionCleanupService(prisma, config);

      await svc.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);
      const afterBoot = contextFindMany.mock.calls.length;
      expect(afterBoot).toBeGreaterThan(0);

      await jest.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
      expect(contextFindMany.mock.calls.length).toBeGreaterThan(afterBoot);

      await svc.onModuleDestroy();
      const afterStop = contextFindMany.mock.calls.length;
      await jest.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
      expect(contextFindMany.mock.calls.length).toBe(afterStop);
      jest.useRealTimers();
    });
  });
});
