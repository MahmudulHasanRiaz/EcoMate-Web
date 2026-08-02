import { createHash } from 'node:crypto';
import { Logger, NotFoundException } from '@nestjs/common';
import { ReplayService } from '../replay.service';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

describe('ReplayService (TrackingReplayArchive + DEAD -> PENDING replay)', () => {
  const archiveUpsert = jest.fn();
  const archiveFindUnique = jest.fn();
  const outboxFindUnique = jest.fn();
  const outboxUpdate = jest.fn();
  const snapshotFindUnique = jest.fn();
  const dispatchEventCreate = jest.fn();

  const prisma = {
    trackingReplayArchive: { upsert: archiveUpsert, findUnique: archiveFindUnique },
    trackingOutbox: { findUnique: outboxFindUnique, update: outboxUpdate },
    trackingSnapshot: { findUnique: snapshotFindUnique },
    trackingDispatchEvent: { create: dispatchEventCreate },
  } as any;
  const service = new ReplayService(prisma);

  const versions = {
    schemaVersion: 1,
    payloadVersion: 1,
    normalizerVersion: 1,
    adapterVersion: 1,
    providerApiVersion: 'v22.0',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    archiveUpsert.mockResolvedValue({});
    archiveFindUnique.mockResolvedValue(null);
    outboxFindUnique.mockResolvedValue(null);
    outboxUpdate.mockResolvedValue({});
    snapshotFindUnique.mockResolvedValue(null);
    dispatchEventCreate.mockResolvedValue({});
  });

  describe('archive() — PII-stripped TrackingReplayArchive write at DEAD', () => {
    it('upserts an archive row with customer email/phone replaced by hashes, rest preserved', async () => {
      const payload = {
        value: 100,
        currency: 'BDT',
        orderId: 'ord-1',
        eventType: 'Purchase',
        eventId: 'purchase_ord-1',
        eventTime: 1722585600,
        customer: {
          email: 'Buyer@Example.com',
          phone: '+8801711111111',
          firstName: 'Jane',
          lastName: 'Doe',
          country: 'BD',
        },
      };
      const configSnapshot = { enabledProviders: ['meta', 'tiktok'], successPolicy: 'ALL_SENT' };

      await service.archive({
        snapshotId: 'snap-1',
        eventId: 'purchase_ord-1',
        eventType: 'Purchase',
        eventTime: BigInt(1722585600),
        payload,
        configSnapshot,
        versions,
      });

      expect(archiveUpsert).toHaveBeenCalledTimes(1);
      const [args] = archiveUpsert.mock.calls[0];
      expect(args.where).toEqual({ snapshotId: 'snap-1' });
      // upsert: both update + create carry the same idempotent data (re-archiving a DEAD is safe).
      const create = args.create;
      const update = args.update;
      expect(create).toMatchObject({
        snapshotId: 'snap-1',
        eventId: 'purchase_ord-1',
        eventType: 'Purchase',
        eventTime: BigInt(1722585600),
        configSnapshot,
        versions,
      });
      expect(update).toEqual(create);

      // PII stripped: email + phone are SHA-256 hashes of the normalizer keys.
      const stored = create.archivedPayload;
      expect(stored.value).toBe(100);
      expect(stored.customer.email).toBe(sha256('buyer@example.com'));
      expect(stored.customer.email).not.toBe('Buyer@Example.com');
      expect(stored.customer.phone).toBe(sha256('8801711111111'));
      expect(stored.customer.firstName).toBe('Jane'); // non-PII-key customer fields kept
      expect(stored.customer.country).toBe('BD');
    });

    it('drops a synthetic email (hash unavailable) instead of archiving the raw value', async () => {
      const payload = {
        eventType: 'Lead',
        customer: { email: 'cust_12345', phone: '+8801712222222' },
      };

      await service.archive({
        snapshotId: 'snap-2',
        eventId: 'lead_2',
        eventType: 'Lead',
        eventTime: BigInt(1722585600),
        payload,
        configSnapshot: {},
        versions,
      });

      const stored = archiveUpsert.mock.calls[0][0].create.archivedPayload;
      expect(stored.customer.email).toBeUndefined();
      expect('email' in stored.customer).toBe(false);
      expect(stored.customer.phone).toBe(sha256('8801712222222'));
    });
  });

  describe('replay() — DEAD -> PENDING version-pinned re-dispatch', () => {
    const deadOutbox = {
      id: 'outbox-1',
      snapshotId: 'snap-1',
      status: 'DEAD',
      attemptCount: 5,
      lastError: 'max attempts (5) exceeded',
      configSnapshot: { enabledProviders: ['meta', 'tiktok'], successPolicy: 'ALL_SENT' },
    };
    const archive = {
      snapshotId: 'snap-1',
      eventId: 'purchase_ord-1',
      eventType: 'Purchase',
      eventTime: BigInt(1722585600),
      archivedPayload: { value: 100, customer: { email: sha256('buyer@example.com') } },
      configSnapshot: { enabledProviders: ['meta', 'tiktok'] },
      versions,
    };

    it('pins versions, resolves the recorded adapters, resets the outbox to PENDING (relay is the sole enqueuer), appends a replay event', async () => {
      archiveFindUnique.mockResolvedValue(archive);
      outboxFindUnique.mockResolvedValue(deadOutbox);

      await service.replay('snap-1');

      // DEAD -> PENDING with a fresh attempt cycle, lock cleared, due now.
      expect(outboxUpdate).toHaveBeenCalledWith({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({
          status: 'PENDING',
          attemptCount: 0,
          nextAttemptAt: expect.any(Date),
          lockedAt: null,
          lockedBy: null,
        }),
      });

      // DEAD -> PENDING transition event, message 'replay'.
      expect(dispatchEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          snapshotId: 'snap-1',
          eventId: 'purchase_ord-1',
          provider: null,
          queueJobId: 'outbox-1:replay:0',
          fromStatus: 'DEAD',
          toStatus: 'PENDING',
          attempt: 0,
          message: 'replay',
        }),
      });
    });

    it('warns on a recorded adapterVersion that is no longer registered and falls back to current', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      archiveFindUnique.mockResolvedValue({
        ...archive,
        versions: { ...versions, adapterVersion: 99 },
      });
      outboxFindUnique.mockResolvedValue(deadOutbox);

      await service.replay('snap-1');

      // The recorded version 99 is not registered -> resolved current (v1) with a mismatch warning.
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('adapterVersion 99'));
      warn.mockRestore();
    });

    it('falls back to the live snapshot (raw payload) when no archive exists yet', async () => {
      archiveFindUnique.mockResolvedValue(null);
      outboxFindUnique.mockResolvedValue(deadOutbox);
      snapshotFindUnique.mockResolvedValue({
        id: 'snap-1',
        eventId: 'purchase_ord-1',
        eventType: 'Purchase',
        orderId: 'ord-1',
        ctxId: 'ctx-1',
        eventTime: BigInt(1722585600),
        payload: { value: 100, customer: { email: 'buyer@example.com' } },
      });

      await service.replay('snap-1');

      expect(outboxUpdate).toHaveBeenCalled();
      // orderId/ctxId come from the live snapshot when they are not in the archive.
      expect(dispatchEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventId: 'purchase_ord-1',
          orderId: 'ord-1',
          ctxId: 'ctx-1',
        }),
      });
    });

    it('is a no-op (no reset) when the outbox is not DEAD', async () => {
      archiveFindUnique.mockResolvedValue(archive);
      outboxFindUnique.mockResolvedValue({ ...deadOutbox, status: 'SENT' });

      await service.replay('snap-1');

      expect(outboxUpdate).not.toHaveBeenCalled();
      expect(dispatchEventCreate).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no outbox exists for the snapshot', async () => {
      archiveFindUnique.mockResolvedValue(null);
      outboxFindUnique.mockResolvedValue(null);

      await expect(service.replay('snap-x')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when neither an archive nor a live snapshot exists', async () => {
      archiveFindUnique.mockResolvedValue(null);
      outboxFindUnique.mockResolvedValue(deadOutbox);
      snapshotFindUnique.mockResolvedValue(null);

      await expect(service.replay('snap-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listDead() — admin DEAD outbox listing', () => {
    it('returns DEAD outbox rows joined with snapshot eventId/eventType + archive versions', async () => {
      const outboxFindMany = jest
        .fn()
        .mockResolvedValue([
          { id: 'o-1', snapshotId: 's-1', lastError: 'max attempts', createdAt: new Date(), attemptCount: 5 },
          { id: 'o-2', snapshotId: 's-2', lastError: 'ALL_SENT policy unmet', createdAt: new Date(), attemptCount: 3 },
        ]);
      const snapshotFindMany = jest.fn().mockResolvedValue([
        { id: 's-1', eventId: 'purchase_1', eventType: 'Purchase' },
        { id: 's-2', eventId: 'lead_2', eventType: 'Lead' },
      ]);
      const archiveFindMany = jest.fn().mockResolvedValue([
        { snapshotId: 's-1', versions },
      ]);
      const svc = new ReplayService({
        trackingOutbox: { findMany: outboxFindMany },
        trackingSnapshot: { findMany: snapshotFindMany },
        trackingReplayArchive: { findMany: archiveFindMany },
      } as any);

      const rows = await svc.listDead();

      expect(outboxFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'DEAD' }, orderBy: { createdAt: 'desc' } }),
      );
      expect(rows).toEqual([
        expect.objectContaining({
          id: 'o-1',
          snapshotId: 's-1',
          eventId: 'purchase_1',
          eventType: 'Purchase',
          lastError: 'max attempts',
          attemptCount: 5,
          versions,
        }),
        expect.objectContaining({ id: 'o-2', snapshotId: 's-2', eventId: 'lead_2', eventType: 'Lead' }),
      ]);
    });
  });
});
