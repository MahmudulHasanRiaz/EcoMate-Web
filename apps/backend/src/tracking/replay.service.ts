import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getAdapter, buildAdapterRegistry } from './adapters';
import { TrackingNormalizer } from './tracking.normalizer';
import { TrackingSnapshotPayload } from './tracking-snapshot.types';

/** Input to ReplayService.archive() — written by the dispatcher when an outbox reaches DEAD. */
export interface ReplayArchiveInput {
  snapshotId: string;
  eventId: string;
  eventType: string;
  eventTime: bigint;
  payload: TrackingSnapshotPayload;
  configSnapshot: Record<string, unknown>;
  versions: Record<string, unknown>;
}

/** Admin DEAD-outbox list row (GET /tracking/admin/dead). */
export interface ReplayDeadOutbox {
  id: string;
  snapshotId: string;
  eventId: string | null;
  eventType: string | null;
  lastError: string | null;
  createdAt: Date;
  attemptCount: number;
  versions: Record<string, unknown> | null;
}

/** Shape of the pinned versions stored on the archive. */
interface ArchivedVersions {
  adapterVersion?: number;
  providerApiVersion?: string;
  providers?: Record<string, { adapterVersion?: number; providerApiVersion?: string }>;
}

/**
 * ReplayService (design §4.10/§7.3) — the durable recovery substrate for DEAD
 * outbox rows.
 *
 * `archive()` is called by the dispatcher the moment an outbox reaches DEAD. It
 * upserts a long-lived (2-year) `TrackingReplayArchive` row holding a
 * **PII-stripped** payload (customer email/phone replaced by SHA-256 hashes via
 * the normalizer), the capture-time `configSnapshot`, and the pinned
 * `versions` (schema/payload/normalizer + the adapter/provider-API versions the
 * dispatch ran under). This is what makes a replay reproducible after §12
 * retention purges the raw snapshot — the archive reconciles the 2-year replay
 * guarantee with the 90-day raw-PII bound.
 *
 * `replay(snapshotId)` is the admin-triggered DEAD -> PENDING reset. It reads
 * the archive (falling back to the still-live snapshot), verifies each enabled
 * provider's recorded adapter version is still registered (warning + fallback
 * to current when a Meta/GA/TikTok API bump has retired it), then resets the
 * outbox to a fresh attempt cycle and re-enqueues with a replay-nonce job id
 * (`${outboxId}:replay:${attemptCount}`) so the re-dispatch is auditable and
 * never collides with the relay's `${outboxId}:${attemptCount}` job ids.
 */
@Injectable()
export class ReplayService {
  private readonly logger = new Logger(ReplayService.name);
  private readonly normalizer = new TrackingNormalizer();

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('tracking') private readonly trackingQueue: Queue,
  ) {}

  /**
   * Upsert the PII-stripped replay archive for a DEAD outbox (best-effort at the
   * call site — the DB DEAD row is the durable record). Idempotent: re-archiving
   * the same snapshot overwrites in place (snapshotId is unique).
   */
  async archive(input: ReplayArchiveInput): Promise<void> {
    const data = {
      snapshotId: input.snapshotId,
      eventId: input.eventId,
      eventType: input.eventType,
      eventTime: input.eventTime,
      archivedPayload: this.stripPii(input.payload) as unknown as Prisma.InputJsonValue,
      configSnapshot: input.configSnapshot as unknown as Prisma.InputJsonValue,
      versions: input.versions as unknown as Prisma.InputJsonValue,
    };
    await this.prisma.trackingReplayArchive.upsert({
      where: { snapshotId: input.snapshotId },
      update: data,
      create: data,
    });
  }

  /**
   * DEAD -> PENDING reset with a fresh attempt cycle + replay-nonce re-enqueue.
   * The archive is the preferred replay source (PII-stripped, survives retention);
   * the live snapshot is the fallback while it is still within retention.
   */
  async replay(snapshotId: string): Promise<void> {
    const [archive, outbox] = await Promise.all([
      this.prisma.trackingReplayArchive.findUnique({ where: { snapshotId } }),
      this.prisma.trackingOutbox.findUnique({ where: { snapshotId } }),
    ]);

    if (!outbox) {
      throw new NotFoundException(
        `Tracking outbox for snapshot ${snapshotId} not found`,
      );
    }
    // Only a terminal DEAD row is replayed — a live row is already moving through
    // the pipeline and a SENT row was already delivered.
    if (outbox.status !== 'DEAD') {
      this.logger.warn(
        `Replay skipped: outbox ${outbox.id} is ${outbox.status}, not DEAD`,
      );
      return;
    }

    // Load the live snapshot too: it carries orderId/ctxId for the transition
    // event, and it IS the replay source when no archive exists yet.
    const snapshot = await this.prisma.trackingSnapshot.findUnique({
      where: { id: snapshotId },
    });
    if (!archive && !snapshot) {
      throw new NotFoundException(
        `Replay source for snapshot ${snapshotId} not found (no archive, no live snapshot)`,
      );
    }

    const versions = (archive?.versions ?? {}) as ArchivedVersions;
    const enabledProviders = Array.isArray(
      (outbox.configSnapshot as { enabledProviders?: unknown } | null)
        ?.enabledProviders,
    )
      ? ((
          outbox.configSnapshot as { enabledProviders: string[] }
        ).enabledProviders as string[])
      : [];
    this.pinAdapters(enabledProviders, versions);

    const queueJobId = `${outbox.id}:replay:0`;
    await this.prisma.trackingOutbox.update({
      where: { id: outbox.id },
      data: {
        status: 'PENDING',
        attemptCount: 0,
        nextAttemptAt: new Date(),
        lockedAt: null,
        lockedBy: null,
      },
    });
    await this.trackingQueue.add(
      'send',
      { snapshotId, outboxId: outbox.id, attemptCount: 0 },
      {
        jobId: queueJobId,
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );
    await this.prisma.trackingDispatchEvent.create({
      data: {
        snapshotId,
        eventId: archive?.eventId ?? (snapshot?.eventId as string),
        orderId: snapshot?.orderId ?? null,
        ctxId: snapshot?.ctxId ?? null,
        provider: null,
        queueJobId,
        fromStatus: 'DEAD',
        toStatus: 'PENDING',
        attempt: 0,
        message: 'replay',
      },
    });
  }

  /** Admin list of DEAD outbox rows, joined with snapshot eventId/eventType + archive versions. */
  async listDead(limit = 100): Promise<ReplayDeadOutbox[]> {
    const outboxes = await this.prisma.trackingOutbox.findMany({
      where: { status: 'DEAD' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        snapshotId: true,
        lastError: true,
        createdAt: true,
        attemptCount: true,
      },
    });
    if (outboxes.length === 0) return [];

    const snapshotIds = outboxes.map((o) => o.snapshotId);
    const [snapshots, archives] = await Promise.all([
      this.prisma.trackingSnapshot.findMany({
        where: { id: { in: snapshotIds } },
        select: { id: true, eventId: true, eventType: true },
      }),
      this.prisma.trackingReplayArchive.findMany({
        where: { snapshotId: { in: snapshotIds } },
        select: { snapshotId: true, versions: true },
      }),
    ]);
    const snapshotById = new Map(snapshots.map((s) => [s.id, s]));
    const versionsBySnapshot = new Map(archives.map((a) => [a.snapshotId, a.versions]));

    return outboxes.map((o) => {
      const snapshot = snapshotById.get(o.snapshotId);
      return {
        id: o.id,
        snapshotId: o.snapshotId,
        eventId: snapshot?.eventId ?? null,
        eventType: snapshot?.eventType ?? null,
        lastError: o.lastError ?? null,
        createdAt: o.createdAt,
        attemptCount: o.attemptCount,
        versions:
          (versionsBySnapshot.get(o.snapshotId) as Record<string, unknown>) ?? null,
      };
    });
  }

  /**
   * Resolve each enabled provider's adapter against the archive's pinned version.
   * Registration is idempotent (buildAdapterRegistry) and `getAdapter` falls back
   * to the newest registered version when the recorded one has been retired — an
   * explicit version-mismatch warning keeps the historical dispatch auditable.
   */
  private pinAdapters(enabledProviders: string[], versions: ArchivedVersions): void {
    buildAdapterRegistry();
    const providers = versions.providers ?? {};
    for (const provider of enabledProviders) {
      const recorded =
        providers[provider]?.adapterVersion ?? versions.adapterVersion;
      const adapter = getAdapter(provider, recorded);
      if (!adapter) {
        this.logger.warn(
          `Replay: no adapter registered for provider '${provider}'`,
        );
        continue;
      }
      if (recorded != null && adapter.version !== recorded) {
        this.logger.warn(
          `Replay version mismatch for '${provider}': recorded adapterVersion ${recorded}, using current ${adapter.version}`,
        );
      }
    }
  }

  /**
   * PII-stripping for the archived payload (privacy §12): customer email/phone
   * become SHA-256 hashes via the normalizer; a value that cannot be hashed
   * (synthetic email, unresolved bare-local phone) is dropped rather than
   * archived raw. Everything else is preserved as-is.
   */
  private stripPii(payload: TrackingSnapshotPayload): Record<string, unknown> {
    const out: Record<string, unknown> = { ...payload };
    if (payload.customer && typeof payload.customer === 'object') {
      const customer: Record<string, unknown> = { ...payload.customer };
      if (customer.email) {
        const hash = this.normalizer.hashEmail(customer.email as string);
        if (hash) customer.email = hash;
        else delete customer.email;
      }
      if (customer.phone) {
        const hash = this.normalizer.hashPhone(
          customer.phone as string,
          (customer.country as string) || undefined,
        );
        if (hash) customer.phone = hash;
        else delete customer.phone;
      }
      out.customer = customer;
    }
    return out;
  }
}
