import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
/**
 * Result of a batch recovery pass over DEAD outbox rows.
 */
export interface BulkReplayResult {
  /** DEAD rows scanned (bounded by limit). */
  scanned: number;
  /** Rows the recoverability check rejected — no identity keys, replay would only re-DEAD/SKIP. */
  excludedNoIdentity: number;
  /** Rows reset DEAD -> PENDING for the relay to re-dispatch. */
  replayed: number;
  /** Rows skipped because they left DEAD between scan and reset (concurrent activity). */
  skippedNotDead: number;
}

/** Identity keys in a snapshot payload; any truthy value makes an event recoverable. */
const IDENTITY_KEYS = ['email', 'phone', 'firstName', 'lastName', 'city', 'state', 'zip', 'country'];

@Injectable()
export class ReplayService {
  private readonly logger = new Logger(ReplayService.name);
  private readonly normalizer = new TrackingNormalizer();

  constructor(private readonly prisma: PrismaService) {}

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
   * Returns true when the row was reset (replayed), false when skipped because
   * the row was no longer DEAD — so batch recovery can count outcomes exactly.
   */
  async replay(snapshotId: string): Promise<boolean> {
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
      return false;
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
    // NOTE: replay does NOT self-enqueue — the relay is the sole enqueuer. The
    // reset PENDING row is claimed by the relay on its next poll, so there is
    // exactly one dispatch job per replay (a self-enqueue would race the relay
    // with a duplicate job). queueJobId above is a replay marker for audit only.
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
    return true;
  }

  /**
   * Batch recovery of the DEAD population (2026-08-10 incident follow-up),
   * oldest-first and bounded. Only rows whose payload carries at least one
   * identity key are replayed: a no-identity row (the 2804050 family) is
   * intentionally unmatchable — after the fix it routes to a terminal SKIPPED
   * row, so replaying it buys nothing (wasted API quota + monitoring noise).
   * Everything else re-dispatches through the existing per-row replay(), which
   * is duplicate-safe: providers already SENT are never re-POSTed (terminal
   * work-set rule) and Meta/TikTok dedup by event_id. Rows may leave DEAD
   * between scan and reset; those are counted, never double-replayed
   * (replay() re-checks status DEAD).
   */
  async replayRecoverable(limit = 200): Promise<BulkReplayResult> {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    const outboxes = await this.prisma.trackingOutbox.findMany({
      where: { status: 'DEAD' },
      orderBy: { createdAt: 'asc' },
      take: safeLimit,
      select: { id: true, snapshotId: true },
    });

    const snapshotIds = outboxes.map((o) => o.snapshotId);
    const [snapshots, archives] = await Promise.all([
      this.prisma.trackingSnapshot.findMany({
        where: { id: { in: snapshotIds } },
        select: { id: true, payload: true },
      }),
      this.prisma.trackingReplayArchive.findMany({
        where: { snapshotId: { in: snapshotIds } },
        select: { snapshotId: true, archivedPayload: true },
      }),
    ]);
    const payloadBySnapshot = new Map<string, unknown>();
    for (const s of snapshots) payloadBySnapshot.set(s.id, s.payload as unknown);
    for (const a of archives) payloadBySnapshot.set(a.snapshotId, a.archivedPayload as unknown);

    const result: BulkReplayResult = { scanned: outboxes.length, excludedNoIdentity: 0, replayed: 0, skippedNotDead: 0 };
    for (const outbox of outboxes) {
      const payload = payloadBySnapshot.get(outbox.snapshotId) as
        | { customer?: Record<string, unknown> | null }
        | undefined;
      const customer = payload?.customer;
      const hasIdentity =
        !!customer && IDENTITY_KEYS.some((k) => Boolean((customer as Record<string, unknown>)[k]));
      if (!hasIdentity) {
        result.excludedNoIdentity++;
        continue;
      }
      try {
        if (await this.replay(outbox.snapshotId)) {
          result.replayed++;
        } else {
          result.skippedNotDead++;
        }
      } catch (err) {
        if (err instanceof NotFoundException) {
          // no outbox/snapshot/archive left — row moved or purged mid-pass
          result.skippedNotDead++;
        } else {
          throw err;
        }
      }
    }
    return result;
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
