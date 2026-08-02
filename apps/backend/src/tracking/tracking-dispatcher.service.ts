import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TrackingContext } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildAdapterRegistry,
  DispatchResult,
  ProviderConfig,
  TrackingProviderAdapter,
} from './adapters';
import { TrackingContextService } from './tracking-context.service';
import { TrackingNormalizer } from './tracking.normalizer';
import { TrackingSettingsService } from './tracking-settings.service';
import {
  TrackingContextView,
  TrackingSnapshotPayload,
} from './tracking-snapshot.types';
import { SCHEMA_VERSION } from './tracking.constants';

/** BullMQ `tracking` job payload produced by the outbox relay (Task 2). */
export interface DispatchJob {
  snapshotId: string;
  outboxId: string;
  attemptCount: number;
}

/** TrackingOutbox.configSnapshot shape the dispatcher consumes. */
interface ConfigSnapshot {
  enabledProviders?: string[];
  successPolicy?: string;
}

/**
 * Outbox retry schedule (design §4.9): 1m -> 10m -> 1h -> 6h -> 24h. Index 0
 * applies to the 1st retry (outbox.attemptCount becomes 1). Past MAX_OUTBOX_ATTEMPTS
 * the outbox is DEAD (replay is the only way back to PENDING).
 */
const RETRY_BACKOFF_MS = [
  1 * 60_000,
  10 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
];
const MAX_OUTBOX_ATTEMPTS = 5;

/** Dispatch rows in these statuses are eligible for (re)processing — never SENT/DEAD/SKIPPED/DEDUPED. */
const WORK_SET_STATUSES = new Set(['PENDING', 'SENDING', 'RETRY']);
/** Statuses that count as a provider successfully handled for the outbox terminal decision. */
const TERMINAL_SUCCESS_STATUSES = new Set(['SENT', 'SKIPPED', 'DEDUPED']);

/** Loose shape of the stored `TrackingContext.identifiers` Json blob. */
type StoredIdentifiers = Record<string, Record<string, { value?: string }>>;

/** Source fields carried onto every TrackingDispatchEvent. */
interface DispatchSource {
  snapshotId: string;
  eventId: string;
  orderId?: string | null;
  ctxId?: string | null;
}

/**
 * TrackingDispatcher — the outbox -> adapters -> dispatch-rows pipeline (design §4.7/4.9).
 *
 * For each enabled provider in the outbox configSnapshot whose adapter `supports()`
 * the event type, it find-or-creates a TrackingDispatch row under
 * `@@unique([snapshotId, provider])`, then builds + sends provider-independently
 * (Promise.allSettled — one provider's failure never blocks another). Each provider
 * advances its own dispatch row and appends a TrackingDispatchEvent; the outbox
 * reaches a terminal decision only after all sends settle:
 *
 *  - every eligible provider SENT/SKIPPED/DEDUPED  -> outbox SENT (dispatchedAt)
 *  - zero eligible providers                        -> outbox SENT (NOOP)
 *  - required provider permanently FAILED/DEAD under ALL_SENT -> outbox DEAD
 *  - retryable failures                              -> outbox PENDING (attemptCount++,
 *    nextAttemptAt = now + backoff, lockedAt/lockedBy cleared) or DEAD past MAX_OUTBOX_ATTEMPTS
 *
 * Work-set rule: a dispatch row in a terminal state (SENT/DEAD/SKIPPED/DEDUPED) is
 * never re-processed — only PENDING/SENDING/RETRY rows are.
 */
@Injectable()
export class TrackingDispatcherService {
  private readonly logger = new Logger(TrackingDispatcherService.name);
  private readonly normalizer = new TrackingNormalizer();

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: TrackingContextService,
    private readonly settings: TrackingSettingsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Entry point. Runs the dispatch pipeline and, on any unexpected throw, does a
   * best-effort release of a relay-claimed outbox (stuck CLAIMED -> PENDING with
   * attemptCount++ and a short backoff) before rethrowing — so both the outbox row
   * stays re-claimable and BullMQ retries the job.
   */
  async process(job: DispatchJob, queueJobId?: string): Promise<void> {
    try {
      await this.run(job, queueJobId);
    } catch (err) {
      await this.releaseStuckOutbox(job);
      throw err;
    }
  }

  /** The actual dispatch pipeline (see class docstring); process() wraps it with crash-safety. */
  private async run(job: DispatchJob, queueJobId?: string): Promise<void> {
    const snapshot = await this.prisma.trackingSnapshot.findUnique({
      where: { id: job.snapshotId },
    });
    if (!snapshot) throw new Error(`Tracking snapshot ${job.snapshotId} not found`);

    const outbox = await this.prisma.trackingOutbox.findUnique({
      where: { id: job.outboxId },
    });
    if (!outbox) throw new Error(`Tracking outbox ${job.outboxId} not found`);

    // Terminal outbox rows are never re-dispatched (relay only claims PENDING anyway).
    if (outbox.status === 'SENT' || outbox.status === 'DEAD') return;

    const qj = queueJobId ?? job.outboxId;
    const source: DispatchSource = {
      snapshotId: snapshot.id,
      eventId: snapshot.eventId,
      orderId: snapshot.orderId,
      ctxId: snapshot.ctxId,
    };

    const contextRow = snapshot.ctxId
      ? await this.context.getByCtxId(snapshot.ctxId)
      : null;
    const contextView = this.buildContextView(contextRow);

    // Enrich the immutable snapshot payload with the canonical event type + dedup id
    // (the adapters' build() contract; the DB row is never mutated). The business
    // event time is a BigInt column — it must reach adapters as a number or they fall
    // back to dispatch time (up to 24h wrong after backoff), reverting the Phase 2 fix.
    const payload: TrackingSnapshotPayload = {
      ...((snapshot.payload ?? {}) as unknown as TrackingSnapshotPayload),
      eventType: snapshot.eventType,
      eventId: snapshot.eventId,
      ...(snapshot.eventTime != null
        ? { eventTime: Number(snapshot.eventTime) }
        : {}),
    };

    const config = (outbox.configSnapshot ?? {}) as ConfigSnapshot;
    const enabledProviders = Array.isArray(config.enabledProviders)
      ? config.enabledProviders
      : [];
    const adapterByProvider = new Map(
      buildAdapterRegistry().map((a) => [a.provider, a]),
    );

    // GA4: validated/offline events have no browser-fired counterpart (design §4.6),
    // so server Measurement Protocol dispatch is allowed even in instant mode. The
    // offline signal is `actionSource = physical_store` at capture time.
    const serverOnly = snapshot.actionSource === 'physical_store';

    // Build the work set: enabled providers whose adapter supports the event type.
    const eligible: Array<{ provider: string; adapter: TrackingProviderAdapter }> =
      [];
    for (const provider of enabledProviders) {
      const adapter = adapterByProvider.get(provider);
      if (!adapter) {
        this.logger.warn(
          `No adapter registered for enabled provider '${provider}' (snapshot ${snapshot.id})`,
        );
        continue;
      }
      if (!adapter.supports(snapshot.eventType, { serverOnly })) {
        await this.recordSkipped(source, provider, qj);
        continue;
      }
      eligible.push({ provider, adapter });
    }

    // Provider-independence: one provider's throw/refusal never blocks the others.
    const settled = await Promise.allSettled(
      eligible.map(({ provider, adapter }) =>
        this.dispatchProvider(
          provider,
          adapter,
          source,
          payload,
          contextView,
          qj,
        ),
      ),
    );

    const statusByProvider = new Map<string, string>();
    let firstError: string | null = null;
    settled.forEach((result, i) => {
      const { provider } = eligible[i];
      if (result.status === 'fulfilled') {
        statusByProvider.set(provider, result.value.status);
        if (result.value.errorMsg && !firstError) firstError = result.value.errorMsg;
      } else {
        statusByProvider.set(provider, 'FAILED');
        if (!firstError) {
          firstError = (result.reason as Error)?.message ?? 'dispatch threw';
        }
      }
    });

    await this.advanceOutbox(source, outbox, config, statusByProvider, qj, firstError);
  }

  /**
   * Crash-safety: if run() threw, the relay's CLAIM on the outbox would otherwise
   * leave the row permanently unclaimable (the relay claims only PENDING rows, and
   * the Phase 5 reconciler isn't wired yet). Best-effort reset a stuck CLAIMED row
   * to PENDING with attemptCount++ and a short backoff so the next relay sweep can
   * re-pick it. Already-advanced rows (PENDING from the retry path, or terminal
   * SENT/DEAD) are left untouched so attempts are not double-counted and terminal
   * decisions are never unwound. The caller rethrows so BullMQ retries too.
   */
  private async releaseStuckOutbox(job: DispatchJob): Promise<void> {
    try {
      const outbox = await this.prisma.trackingOutbox.findUnique({
        where: { id: job.outboxId },
      });
      if (!outbox || outbox.status !== 'CLAIMED') return;
      await this.prisma.trackingOutbox.update({
        where: { id: outbox.id },
        data: {
          status: 'PENDING',
          attemptCount: outbox.attemptCount + 1,
          nextAttemptAt: new Date(Date.now() + RETRY_BACKOFF_MS[0]),
          lockedAt: null,
          lockedBy: null,
        },
      });
    } catch {
      // DB itself may be down — the BullMQ job retry remains the backstop.
    }
  }

  /**
   * One provider's full dispatch lifecycle: find-or-create row -> SENDING -> build ->
   * send -> terminal row state. Always returns (never throws past the caller) so the
   * outbox terminal decision sees every provider outcome.
   */
  private async dispatchProvider(
    provider: string,
    adapter: TrackingProviderAdapter,
    source: DispatchSource,
    payload: TrackingSnapshotPayload,
    contextView: TrackingContextView,
    queueJobId: string,
  ): Promise<{ status: string; errorMsg?: string }> {
    try {
      const { row: dispatch, created } = await this.ensureDispatchRow(
        source,
        provider,
        queueJobId,
        {
          status: 'PENDING',
          adapterVersion: adapter.version,
          providerApiVersion: adapter.providerApiVersion,
          normalizerVersion: this.normalizer.version,
        },
      );
      if (created) {
        await this.appendDispatchEvent(
          source,
          provider,
          queueJobId,
          null,
          'PENDING',
          0,
          'dispatch row created',
        );
      }

      // Work-set: only PENDING/SENDING/RETRY rows are (re)processed.
      if (!WORK_SET_STATUSES.has(dispatch.status)) {
        return { status: dispatch.status };
      }

      await this.prisma.trackingDispatch.update({
        where: { id: dispatch.id },
        data: { status: 'SENDING' },
      });
      await this.appendDispatchEvent(
        source,
        provider,
        queueJobId,
        dispatch.status,
        'SENDING',
        dispatch.attemptCount,
        null,
      );

      const built = adapter.build(payload, contextView, this.normalizer);
      if (!built) {
        await this.prisma.trackingDispatch.update({
          where: { id: dispatch.id },
          data: { status: 'SKIPPED', errorMsg: 'build refused' },
        });
        await this.appendDispatchEvent(
          source,
          provider,
          queueJobId,
          'SENDING',
          'SKIPPED',
          dispatch.attemptCount,
          'adapter build() refused the payload',
        );
        return { status: 'SKIPPED' };
      }

      const cfg = await this.buildCfg(provider);
      const result = await adapter.send(built, cfg);
      const status = this.classify(result);
      const errorMsg = result.ok ? null : result.rawResponse ?? 'send failed';

      await this.prisma.trackingDispatch.update({
        where: { id: dispatch.id },
        data: {
          status,
          attemptCount: dispatch.attemptCount + 1,
          providerEventId: result.providerEventId ?? dispatch.providerEventId,
          httpStatus: result.httpStatus ?? null,
          responseBody: result.rawResponse ?? null,
          errorMsg,
        },
      });
      await this.appendDispatchEvent(
        source,
        provider,
        queueJobId,
        'SENDING',
        status,
        dispatch.attemptCount + 1,
        errorMsg,
      );

      return { status, errorMsg: errorMsg ?? undefined };
    } catch (err) {
      const message = (err as Error)?.message ?? 'dispatch error';
      this.logger.error(`Dispatch to ${provider} failed: ${message}`);
      // Best-effort: record the unexpected failure on the row so a retry/replay can see it.
      try {
        const row = await this.prisma.trackingDispatch.findUnique({
          where: { snapshotId_provider: { snapshotId: source.snapshotId, provider } },
        });
        if (row) {
          await this.prisma.trackingDispatch.update({
            where: { id: row.id },
            data: { status: 'FAILED', errorMsg: message },
          });
        }
      } catch {
        // DB itself may be down; the outbox retry path still records the failure.
      }
      return { status: 'FAILED', errorMsg: message };
    }
  }

  /** map a DispatchResult onto a TrackingDispatch terminal status. */
  private classify(result: DispatchResult): string {
    if (result.ok) return 'SENT';
    return result.retryable ? 'RETRY' : 'FAILED';
  }

  /**
   * Find-or-create a TrackingDispatch row. The DB `@@unique([snapshotId, provider])`
   * constraint makes concurrent creates safe: a P2002 loser re-reads the winner.
   */
  private async ensureDispatchRow(
    source: DispatchSource,
    provider: string,
    queueJobId: string,
    opts: {
      status: 'PENDING' | 'SKIPPED';
      adapterVersion?: number | null;
      providerApiVersion?: string | null;
      payloadVersion?: number | null;
      normalizerVersion?: number | null;
    },
  ): Promise<{ row: any; created: boolean }> {
    const where = {
      snapshotId_provider: { snapshotId: source.snapshotId, provider },
    };
    const existing = await this.prisma.trackingDispatch.findUnique({ where });
    if (existing) return { row: existing, created: false };

    try {
      const row = await this.prisma.trackingDispatch.create({
        data: {
          snapshotId: source.snapshotId,
          eventId: source.eventId,
          orderId: source.orderId ?? null,
          ctxId: source.ctxId ?? null,
          queueJobId,
          provider,
          status: opts.status,
          providerEventId: source.eventId,
          attemptCount: 0,
          // Version columns are null for SKIPPED/DEDUPED (no send happened).
          adapterVersion: opts.status === 'PENDING' ? opts.adapterVersion ?? null : null,
          providerApiVersion:
            opts.status === 'PENDING' ? opts.providerApiVersion ?? null : null,
          payloadVersion:
            opts.status === 'PENDING' ? opts.payloadVersion ?? SCHEMA_VERSION : null,
          normalizerVersion:
            opts.status === 'PENDING' ? opts.normalizerVersion ?? null : null,
        },
      });
      return { row, created: true };
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        const winner = await this.prisma.trackingDispatch.findUnique({ where });
        if (winner) return { row: winner, created: false };
      }
      throw err;
    }
  }

  /** Record an enabled-but-unsupported provider as a terminal SKIPPED dispatch row. */
  private async recordSkipped(
    source: DispatchSource,
    provider: string,
    queueJobId: string,
  ): Promise<void> {
    const { row, created } = await this.ensureDispatchRow(source, provider, queueJobId, {
      status: 'SKIPPED',
    });
    if (created) {
      await this.appendDispatchEvent(
        source,
        provider,
        queueJobId,
        null,
        'SKIPPED',
        0,
        'provider does not support this event type in this mode',
      );
    } else if (row.status !== 'SKIPPED' && row.status !== 'SENT') {
      // A non-terminal row that is now ineligible is parked as SKIPPED (audit only).
      await this.prisma.trackingDispatch.update({
        where: { id: row.id },
        data: { status: 'SKIPPED' },
      });
      await this.appendDispatchEvent(
        source,
        provider,
        queueJobId,
        row.status,
        'SKIPPED',
        row.attemptCount,
        'provider no longer supports this event type in this mode',
      );
    }
  }

  /** Outbox terminal decision — SENT, DEAD, or PENDING-with-backoff (lock released). */
  private async advanceOutbox(
    source: DispatchSource,
    outbox: any,
    config: ConfigSnapshot,
    statusByProvider: Map<string, string>,
    queueJobId: string,
    firstError: string | null,
  ): Promise<void> {
    const statuses = [...statusByProvider.values()];
    const successPolicy = config.successPolicy ?? 'ALL_SENT';

    // Zero eligible providers: nothing to send — terminal success by NOOP.
    if (statuses.length === 0) {
      await this.terminalOutbox(
        source,
        outbox,
        'SENT',
        queueJobId,
        null,
        'no eligible providers (NOOP)',
      );
      return;
    }

    if (statuses.every((s) => TERMINAL_SUCCESS_STATUSES.has(s))) {
      await this.terminalOutbox(
        source,
        outbox,
        'SENT',
        queueJobId,
        null,
        'all providers dispatched',
      );
      return;
    }

    const hasPermanentFailure = statuses.some(
      (s) => s === 'FAILED' || s === 'DEAD',
    );
    if (successPolicy === 'ALL_SENT' && hasPermanentFailure) {
      await this.terminalOutbox(
        source,
        outbox,
        'DEAD',
        queueJobId,
        firstError,
        `ALL_SENT policy unmet: ${firstError ?? 'provider permanently failed'}`,
      );
      return;
    }

    // Retryable path (or a non-ALL_SENT policy with partial success pending).
    const nextAttempt = outbox.attemptCount + 1;
    if (nextAttempt > MAX_OUTBOX_ATTEMPTS) {
      await this.terminalOutbox(
        source,
        outbox,
        'DEAD',
        queueJobId,
        firstError,
        `max attempts (${MAX_OUTBOX_ATTEMPTS}) exceeded: ${firstError ?? ''}`,
      );
      return;
    }

    await this.prisma.trackingOutbox.update({
      where: { id: outbox.id },
      data: {
        status: 'PENDING',
        attemptCount: nextAttempt,
        nextAttemptAt: new Date(Date.now() + RETRY_BACKOFF_MS[nextAttempt - 1]),
        lockedAt: null,
        lockedBy: null,
        lastError: firstError,
      },
    });
    await this.appendDispatchEvent(
      source,
      null,
      queueJobId,
      outbox.status,
      'PENDING',
      nextAttempt,
      firstError,
    );
  }

  /** Write a terminal outbox status (SENT or DEAD) + its transition event. */
  private async terminalOutbox(
    source: DispatchSource,
    outbox: any,
    status: 'SENT' | 'DEAD',
    queueJobId: string,
    lastError: string | null,
    message: string,
  ): Promise<void> {
    await this.prisma.trackingOutbox.update({
      where: { id: outbox.id },
      data: {
        status,
        ...(status === 'SENT' ? { dispatchedAt: new Date() } : {}),
        ...(lastError ? { lastError } : {}),
      },
    });
    await this.appendDispatchEvent(
      source,
      null,
      queueJobId,
      outbox.status,
      status,
      outbox.attemptCount,
      message,
    );
  }

  /** Resolve the per-provider cfg the adapter's send() reads, incl. test codes. */
  private async buildCfg(provider: string): Promise<ProviderConfig> {
    switch (provider) {
      case 'meta':
        return {
          pixelId:
            (await this.settings.get('tracking_meta_pixel_id', 'META_PIXEL_ID')) ??
            undefined,
          accessToken:
            (await this.settings.get('tracking_meta_access_token', 'META_ACCESS_TOKEN')) ??
            undefined,
          testEventCode: (await this.settings.getTestEventCode('meta')) ?? undefined,
        };
      case 'tiktok':
        return {
          pixelCode:
            (await this.settings.get('tracking_tiktok_pixel_code', 'TIKTOK_PIXEL_CODE')) ??
            undefined,
          accessToken:
            (await this.settings.get('tracking_tiktok_access_token', 'TIKTOK_ACCESS_TOKEN')) ??
            undefined,
        };
      case 'ga4':
        // env-only: GA4 has no DB flag (configSnapshot.enabledProviders used env presence).
        return {
          measurementId: this.config.get('GA_MEASUREMENT_ID') || undefined,
          apiSecret: this.config.get('GA_API_SECRET') || undefined,
        };
      case 'google_ads':
        return {
          conversionId: this.config.get('GA_ADS_CONVERSION_ID') || undefined,
          conversionLabel: this.config.get('GA_ADS_CONVERSION_LABEL') || undefined,
        };
      default:
        return {};
    }
  }

  /** Map the stored TrackingContext row onto the adapter-facing context view. */
  private buildContextView(context: TrackingContext | null): TrackingContextView {
    if (!context) return {};
    const identifiers = (context.identifiers ?? {}) as StoredIdentifiers;
    return {
      externalId: context.externalId,
      ip: context.ip ?? undefined,
      userAgent: context.userAgent ?? undefined,
      url: context.url ?? undefined,
      referrer: context.referrer ?? undefined,
      fbp: identifiers.meta?.fbp?.value,
      fbc: identifiers.meta?.fbc?.value,
      gaClientId: identifiers.google?.gaClientId?.value,
      gclid: identifiers.google?.gclid?.value,
      ttclid: identifiers.tiktok?.ttclid?.value,
    };
  }

  private async appendDispatchEvent(
    source: DispatchSource,
    provider: string | null,
    queueJobId: string,
    fromStatus: string | null,
    toStatus: string,
    attempt?: number,
    message?: string | null,
  ): Promise<void> {
    await this.prisma.trackingDispatchEvent.create({
      data: {
        snapshotId: source.snapshotId,
        eventId: source.eventId,
        orderId: source.orderId ?? null,
        ctxId: source.ctxId ?? null,
        provider,
        queueJobId,
        fromStatus,
        toStatus,
        attempt,
        message: message ?? null,
      },
    });
  }
}
