import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingSnapshotPayload } from './tracking-snapshot.types';

/** Rows touched per loop iteration — keeps each write short and lock-scalable. */
const BATCH_SIZE = 1000;

/** Outcome of an admin deletion request (`POST /tracking/admin/delete`). */
export interface DeletionResult {
  /** TrackingContext rows hard-deleted. */
  contextsDeleted: number;
  /** TrackingSnapshot payloads whose customer PII was nulled (rows kept for dedup). */
  snapshotsAnonymized: number;
}

/**
 * DeletionService (design §14, GDPR-style erasure) — the admin workflow that
 * removes a shopper's tracking footprint on request.
 *
 *  - `deleteByExternalId(externalId)`: hard-deletes every `TrackingContext`
 *    row for that externalId and nulls the customer PII inside the `payload`
 *    JSON of every `TrackingSnapshot` whose `ctxId` belonged to a deleted
 *    context. Snapshots are retained (with eventId/orderId/eventTime intact) so
 *    the 48h Pixel/CAPI dedup and the replay archive keep working — only the
 *    personal data is erased.
 *  - `deleteByCustomerId(customerId)`: resolves the customer's orders, deletes
 *    the contexts linked via `Order.trackingSessionId` (the checkout ctxId), and
 *    anonymizes snapshots for those orders (by `orderId`) and/or their sessions
 *    (by `ctxId`).
 *
 * Both paths are batched (1000 rows/loop) and short-circuit to zero work when
 * nothing resolves. Counts are returned to the admin caller.
 */
@Injectable()
export class DeletionService {
  private readonly logger = new Logger(DeletionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Delete contexts by externalId, then anonymize snapshots linked to them. */
  async deleteByExternalId(externalId: string): Promise<DeletionResult> {
    const contexts = await this.prisma.trackingContext.findMany({
      where: { externalId },
      select: { id: true, ctxId: true },
    });
    if (contexts.length === 0) {
      return { contextsDeleted: 0, snapshotsAnonymized: 0 };
    }

    const ctxIds = [...new Set(contexts.map((c) => c.ctxId))];
    let contextsDeleted = 0;
    for (let i = 0; i < contexts.length; i += BATCH_SIZE) {
      const batchIds = contexts.slice(i, i + BATCH_SIZE).map((c) => c.id);
      const res = await this.prisma.trackingContext.deleteMany({
        where: { id: { in: batchIds } },
      });
      contextsDeleted += res.count;
    }

    const snapshotsAnonymized = await this.anonymizeSnapshots({
      ctxId: { in: ctxIds },
    });
    this.logger.log(
      `Deletion by externalId=${externalId}: ${contextsDeleted} contexts deleted, ${snapshotsAnonymized} snapshots anonymized`,
    );
    return { contextsDeleted, snapshotsAnonymized };
  }

  /** Resolve the customer's orders/sessions, delete contexts, anonymize snapshots. */
  async deleteByCustomerId(customerId: string): Promise<DeletionResult> {
    const orders = await this.prisma.order.findMany({
      where: { customerId },
      select: { id: true, trackingSessionId: true },
    });
    if (orders.length === 0) {
      return { contextsDeleted: 0, snapshotsAnonymized: 0 };
    }

    const orderIds = orders.map((o) => o.id);
    const ctxIds = [
      ...new Set(
        orders
          .map((o) => o.trackingSessionId)
          .filter((v): v is string => Boolean(v)),
      ),
    ];

    let contextsDeleted = 0;
    for (let i = 0; i < ctxIds.length; i += BATCH_SIZE) {
      const batch = ctxIds.slice(i, i + BATCH_SIZE);
      const res = await this.prisma.trackingContext.deleteMany({
        where: { ctxId: { in: batch } },
      });
      contextsDeleted += res.count;
    }

    const where = this.snapshotWhereForOrders(orderIds, ctxIds);
    const snapshotsAnonymized = where ? await this.anonymizeSnapshots(where) : 0;
    this.logger.log(
      `Deletion by customerId=${customerId}: ${contextsDeleted} contexts deleted, ${snapshotsAnonymized} snapshots anonymized`,
    );
    return { contextsDeleted, snapshotsAnonymized };
  }

  /**
   * Snapshot selector for a customer: every row whose `orderId` is one of the
   * customer's orders and/or whose `ctxId` was one of their checkout sessions.
   * `null` when there is nothing to match (caller skips the anonymize pass).
   */
  private snapshotWhereForOrders(
    orderIds: string[],
    ctxIds: string[],
  ): Prisma.TrackingSnapshotWhereInput | null {
    if (orderIds.length > 0 && ctxIds.length > 0) {
      return {
        OR: [{ orderId: { in: orderIds } }, { ctxId: { in: ctxIds } }],
      };
    }
    if (orderIds.length > 0) return { orderId: { in: orderIds } };
    if (ctxIds.length > 0) return { ctxId: { in: ctxIds } };
    return null;
  }

  /**
   * id-cursor batched anonymize pass: read snapshot payloads matching `where`,
   * null the customer PII inside each, and write back per row (payloads differ,
   * so updateMany cannot share one data object). Already-nulled rows (payload
   * JSON null) are skipped. Returns the number of payloads updated.
   */
  private async anonymizeSnapshots(
    where: Prisma.TrackingSnapshotWhereInput,
  ): Promise<number> {
    let total = 0;
    let cursor: string | undefined;
    while (true) {
      const rows = await this.prisma.trackingSnapshot.findMany({
        where,
        select: { id: true, payload: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        if (row.payload == null) continue; // already JSON-nulled by retention
        const res = await this.prisma.trackingSnapshot.updateMany({
          where: { id: row.id },
          data: {
            payload: this.stripPayloadPii(
              row.payload as TrackingSnapshotPayload,
            ) as unknown as Prisma.InputJsonValue,
          },
        });
        total += res.count;
      }
      if (rows.length < BATCH_SIZE) break;
      cursor = rows[rows.length - 1].id;
    }
    return total;
  }

  /**
   * Null the customer PII inside a snapshot payload (privacy §14). The envelope
   * — eventType/eventId/orderId/eventTime/value/etc. — is preserved so dedup and
   * replay still function; only the personal fields are erased. Unlike the
   * retention/archive passes (which keep SHA-256 hashes for re-linking), a
   * GDPR deletion nulls rather than hashes so the value is not recoverable.
   */
  private stripPayloadPii(
    payload: TrackingSnapshotPayload,
  ): Record<string, unknown> {
    if (!payload.customer || typeof payload.customer !== 'object') {
      return { ...payload };
    }
    return {
      ...payload,
      customer: {
        email: null,
        phone: null,
        firstName: null,
        lastName: null,
        city: null,
        state: null,
        country: null,
        zip: null,
      },
    };
  }
}
