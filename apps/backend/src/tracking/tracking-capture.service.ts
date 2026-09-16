import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SCHEMA_VERSION } from './tracking.constants';
import { TrackingSnapshotPayload } from './tracking-snapshot.types';
import { LEGACY_DESTINATION_ID } from './destinations';

/**
 * Input to TrackingCaptureService.capture.
 *
 * `payload` is the CANONICAL business data — raw, provider-agnostic, no hashed
 * values, no provider field names. Hashing happens later in the normalizer /
 * adapter send path, never at capture.
 */
export interface TrackingCaptureInput {
  eventId: string;
  eventType: string;
  orderId?: string;
  ctxId?: string;
  eventTime: number;
  actionSource?: string;
  payload: TrackingSnapshotPayload;
  configSnapshot?: Record<string, unknown>;
}

export type TrackingCaptureResult =
  | { status: 'CAPTURED'; snapshotId: string }
  | { status: 'DEDUPED' };

/** High-priority event types claim the outbox first (see TrackingOutbox.priority). */
const HIGH_PRIORITY_EVENT_TYPES = new Set(['Purchase', 'Refund']);
const HIGH_PRIORITY = 10;
const NORMAL_PRIORITY = 0;

@Injectable()
export class TrackingCaptureService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotently persist the canonical snapshot and enqueue its outbox row.
   *
   * eventId is unique on TrackingSnapshot, so a repeated capture is skipped via
   * `skipDuplicates` and returns `{ status: 'DEDUPED' }` — never throws.
   * Runs inside `this.prisma.$transaction` unless the caller supplies their own
   * transaction client (e.g. when capture is one step of a business transaction).
   */
  async capture(
    input: TrackingCaptureInput,
    tx?: Prisma.TransactionClient,
  ): Promise<TrackingCaptureResult> {
    const run = async (
      client: Prisma.TransactionClient,
    ): Promise<TrackingCaptureResult> => {
      const { count } = await client.trackingSnapshot.createMany({
        data: [
          {
            eventId: input.eventId,
            eventType: input.eventType,
            orderId: input.orderId,
            ctxId: input.ctxId,
            eventTime: BigInt(input.eventTime),
            actionSource: input.actionSource,
            schemaVersion: SCHEMA_VERSION,
            payload: input.payload as unknown as Prisma.InputJsonValue,
          },
        ],
        skipDuplicates: true,
      });

      // count 0 => the snapshot already exists for this eventId; nothing new to enqueue.
      if (count === 0) {
        // Wave-2.4 MON-3 fix: the dedupRate metric needs a durable signal for
        // CAPTURE-level duplicate attempts (dispatch rows literally never reach
        // DEDUPED — skipDuplicates is the dedup). Mark the duplicate with a
        // provider-null TrackingDispatchEvent so monitoring can count it
        // (message: 'capture dedup') and derive a truthful dedup rate. The
        // existing snapshot is looked up for the required snapshotId FK; a
        // failed lookup (row already purged) skips the marker silently.
        try {
          const existing = await client.trackingSnapshot.findUnique({
            where: { eventId: input.eventId },
            select: { id: true },
          });
          if (existing) {
            await client.trackingDispatchEvent.create({
              data: {
                snapshotId: existing.id,
                eventId: input.eventId,
                orderId: input.orderId,
                ctxId: input.ctxId,
                provider: null,
                toStatus: 'DEDUPED',
                message: 'capture dedup',
              },
            });
          }
        } catch {
          // best-effort marker — the return contract (DEDUPED) must never throw
        }
        return { status: 'DEDUPED' };
      }

      // createMany does not return row ids, so read the snapshot back to link the outbox.
      const snapshot = await client.trackingSnapshot.findUnique({
        where: { eventId: input.eventId },
      });
      if (!snapshot) {
        // Not a duplicate path — indicates a programming/DB error after a successful insert.
        throw new Error(
          `Captured snapshot for eventId ${input.eventId} not found immediately after insert`,
        );
      }

      const priority = HIGH_PRIORITY_EVENT_TYPES.has(input.eventType)
        ? HIGH_PRIORITY
        : NORMAL_PRIORITY;

      await client.trackingOutbox.createMany({
        data: [
          {
            snapshotId: snapshot.id,
            configSnapshot:
              (input.configSnapshot ?? {}) as unknown as Prisma.InputJsonValue,
            status: 'PENDING',
            nextAttemptAt: new Date(),
            priority,
          },
        ],
        skipDuplicates: true,
      });

      return { status: 'CAPTURED', snapshotId: snapshot.id };
    };

    if (tx) {
      return run(tx);
    }
    return this.prisma.$transaction(run);
  }

  /**
   * Validated-trigger requeue: the canonical Purchase snapshot already exists
   * (instant capture won the race, same deterministic eventId → DEDUPED), but a
   * validated-mode provider was deferred at dispatch time. Revive the outbox + the
   * deferred providers' SKIPPED dispatch rows so the relay re-dispatches the
   * SAME snapshot (same eventId) to them now. Providers already SENT are untouched.
   *
   * Step 3 — DESTINATION SCOPE. The caller keeps its provider-granular signature
   * (a provider's Purchase mode is provider-level today, so every eligible
   * destination of that provider follows it), but the revival itself is
   * destination-granular: the destinations are read from the CAPTURE-TIME refs
   * recorded on the outbox `configSnapshot`, and exactly one row is revived per
   * destination. That is what stops a validated transition for `meta` from
   * reviving an unrelated provider's destinations, and what makes a future
   * per-destination mode a settings-only change.
   *
   * Legacy snapshots (captured before destinations existed) carry no
   * `destinations` array and fall back to the single legacy destination id, which
   * is the identity their rows already hold.
   */
  async ensureValidatedDispatch(
    eventId: string,
    providers: string[],
  ): Promise<{ requeued: boolean; providers: string[]; destinations: string[] }> {
    if (providers.length === 0)
      return { requeued: false, providers: [], destinations: [] };
    const snapshot = await this.prisma.trackingSnapshot.findUnique({
      where: { eventId },
      select: { id: true },
    });
    if (!snapshot) return { requeued: false, providers: [], destinations: [] };
    const outbox = await this.prisma.trackingOutbox.findUnique({
      where: { snapshotId: snapshot.id },
    });
    if (!outbox) return { requeued: false, providers: [], destinations: [] };

    const config = (outbox.configSnapshot ?? {}) as {
      destinations?: Array<{ provider?: string; destinationId?: string; pixelId?: string }>;
    };
    const capturedRefs = Array.isArray(config.destinations) ? config.destinations : [];

    const revivedProviders = new Set<string>();
    const revived: string[] = [];
    for (const provider of providers) {
      // Capture-time destination refs for this provider. Legacy snapshots have
      // none recorded, so fall back to the pre-Step-3 single identity.
      const refs = capturedRefs.filter((r) => r?.provider === provider);
      const targets = refs.length
        ? refs.map((r) => ({
            destinationId: r.destinationId || LEGACY_DESTINATION_ID,
            pixelId: r.pixelId,
          }))
        : [{ destinationId: LEGACY_DESTINATION_ID, pixelId: undefined }];

      for (const target of targets) {
        const row = await this.prisma.trackingDispatch.findUnique({
          where: {
            snapshotId_provider_destinationId: {
              snapshotId: snapshot.id,
              provider,
              destinationId: target.destinationId,
            },
          },
        });
        // Only deferred (SKIPPED) rows are revived — SENT/RETRY/FAILED rows keep
        // their state so a validated transition never duplicates a delivery.
        if (row && row.status === 'SKIPPED') {
          await this.prisma.trackingDispatch.update({
            where: { id: row.id },
            data: { status: 'PENDING', errorMsg: null },
          });
          await this.prisma.trackingDispatchEvent.create({
            data: {
              snapshotId: snapshot.id,
              eventId,
              orderId: row.orderId ?? null,
              ctxId: row.ctxId ?? null,
              provider,
              toStatus: 'PENDING',
              message: 'validated requeue: deferred destination revived',
            },
          });
          revivedProviders.add(provider);
          revived.push(`${provider}:${target.destinationId}`);
        } else if (!row) {
          // Destination never dispatched (e.g. the outbox went SENT before it was
          // enabled): create a PENDING row so the next dispatch covers it.
          await this.prisma.trackingDispatch.create({
            data: {
              snapshotId: snapshot.id,
              eventId,
              provider,
              destinationId: target.destinationId,
              pixelId: target.pixelId ?? null,
              status: 'PENDING',
              providerEventId: eventId,
            },
          });
          revivedProviders.add(provider);
          revived.push(`${provider}:${target.destinationId}`);
        }
      }
    }
    // `providers` keeps its original meaning (which providers were revived) so the
    // existing caller/contract is unchanged; `destinations` is the Step 3
    // destination-granular detail.
    if (revived.length === 0)
      return { requeued: false, providers: [], destinations: [] };
    if (outbox.status !== 'PENDING') {
      await this.prisma.trackingOutbox.update({
        where: { id: outbox.id },
        data: {
          status: 'PENDING',
          nextAttemptAt: new Date(),
          lockedAt: null,
          lockedBy: null,
        },
      });
    }
    return {
      requeued: true,
      providers: [...revivedProviders],
      destinations: revived,
    };
  }
}
