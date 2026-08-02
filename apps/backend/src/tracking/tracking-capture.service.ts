import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SCHEMA_VERSION } from './tracking.constants';
import { TrackingSnapshotPayload } from './tracking-snapshot.types';

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
}
