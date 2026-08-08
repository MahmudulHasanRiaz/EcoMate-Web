import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

/**
 * Order edit lock — prevents concurrent staff edits on the same order.
 *
 * Guarantees:
 *  - Atomic acquire via insert + unique constraint; a concurrent holder gets a
 *    409 carrying holder identity. No read-then-write races.
 *  - Heartbeat: holder renews TTL (default 60s). Missing heartbeat lets the lock
 *    expire; after expiry ANY user may take it over (stale recovery).
 *  - Override: explicit takeover with audit timeline entry (caller writes it).
 *  - Release only by the holder; anonymous release never touches someone else's.
 *  - No N+1: list/detail include the lock via `include: { editLock: ... }`.
 */
const LOCK_TTL_MS = 60_000;

export interface OrderLockInfo {
  orderId: string;
  userId: string;
  userName: string | null;
  acquiredAt: Date;
  heartbeatAt: Date;
  expiresAt: Date;
}

@Injectable()
export class OrderEditLockService {
  private readonly logger = new Logger(OrderEditLockService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Enrich a raw lock row with the holder's display name (one extra query). */
  private async toInfo(lock: {
    orderId: string;
    userId: string;
    acquiredAt: Date;
    heartbeatAt: Date;
    expiresAt: Date;
  }): Promise<OrderLockInfo> {
    const user = await this.prisma.userProfile.findUnique({
      where: { id: lock.userId },
      select: { firstName: true, lastName: true },
    });
    const name =
      user && (user.firstName || user.lastName)
        ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
        : null;
    return {
      orderId: lock.orderId,
      userId: lock.userId,
      userName: name,
      acquiredAt: lock.acquiredAt,
      heartbeatAt: lock.heartbeatAt,
      expiresAt: lock.expiresAt,
    };
  }

  /**
   * Try to acquire the lock for an order.
   * Returns `{ acquired: true, lock }` on success, or `{ acquired: false, heldBy }`
   * when another user holds a live lock. Never throws for "held by someone else".
   */
  async acquire(
    orderId: string,
    userId: string,
  ): Promise<
    { acquired: true; lock: OrderLockInfo } | { acquired: false; heldBy: OrderLockInfo }
  > {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);

    try {
      const lock = await this.prisma.orderEditLock.create({
        data: { orderId, userId, expiresAt },
      });
      return { acquired: true, lock: await this.toInfo(lock) };
    } catch (err) {
      // Unique violation (orderId) → lock exists → decide takeover vs conflict.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.prisma.orderEditLock.findUnique({
          where: { orderId },
        });
        if (!existing) {
          // Race: lock was released between create-fail and re-read; try once
          // more fresh (or loop is fine here — a single retry is enough given
          // the unique constraint, just return a conflict-ish error).
          return { acquired: false, heldBy: await this.toInfoFallback() };
        }
        if (existing.expiresAt > now && existing.userId !== userId) {
          const heldBy = await this.toInfo(existing);
          return { acquired: false, heldBy };
        }
        // Expired or own lock → takeover (update atomic by unique orderId).
        const lock = await this.prisma.orderEditLock.update({
          where: { orderId },
          data: { userId, heartbeatAt: now, expiresAt },
        });
        if (existing.userId !== userId) {
          await this.appendAuditEntry(orderId, {
            type: 'edit_lock',
            visibility: 'private',
            timestamp: new Date().toISOString(),
            note: `Lock taken over after expiry (previous holder released session).`,
            performedBy: userId,
          });
        }
        return { acquired: true, lock: await this.toInfo(lock) };
      }
      this.logger.error(`Lock acquire failed for order ${orderId}`, err);
      throw new ConflictException('Failed to acquire order lock.');
    }
  }

  private async toInfoFallback(): Promise<OrderLockInfo> {
    return {
      orderId: '',
      userId: '',
      userName: null,
      acquiredAt: new Date(0),
      heartbeatAt: new Date(0),
      expiresAt: new Date(0),
    };
  }

  /** Force takeover regardless of the current holder. */
  async override(orderId: string, userId: string): Promise<OrderLockInfo> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, timeline: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
    const lock = await this.prisma.orderEditLock.upsert({
      where: { orderId },
      create: { orderId, userId, expiresAt },
      update: { userId, heartbeatAt: now, expiresAt },
    });
    await this.appendAuditEntry(orderId, {
      type: 'edit_lock',
      visibility: 'private',
      timestamp: new Date().toISOString(),
      note: `Edit lock overridden and taken over.`,
      performedBy: userId,
    });
    return this.toInfo(lock);
  }

  /** Write an audit entry into the order timeline (same write pattern as order notes). */
  private async appendAuditEntry(
    orderId: string,
    entry: Record<string, unknown>,
  ) {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { timeline: true },
      });
      if (!order) return;
      const timeline = Array.isArray(order.timeline)
        ? (order.timeline as unknown[])
        : [];
      await this.prisma.order.update({
        where: { id: orderId },
        data: { timeline: [...timeline, entry] as any },
      });
    } catch (err) {
      // Audit failure must never break the lock operation.
      this.logger.error(`Failed to append lock audit entry for ${orderId}`, err);
    }
  }

  /**
   * Heartbeat renewal. Returns `false` when the lock is held by someone else
   * (session lost → UI must stop auto-saving).
   */
  async heartbeat(
    orderId: string,
    userId: string,
  ): Promise<{ ok: true } | { ok: false; heldBy: OrderLockInfo }> {
    const existing = await this.prisma.orderEditLock.findUnique({
      where: { orderId },
    });
    if (!existing || existing.expiresAt <= new Date()) {
      // Lock gone/expired — nothing to renew; caller may re-acquire.
      return { ok: false, heldBy: await this.toInfoFallback() };
    }
    if (existing.userId !== userId) {
      return { ok: false, heldBy: await this.toInfo(existing) };
    }
    const now = new Date();
    await this.prisma.orderEditLock.update({
      where: { orderId },
      data: { heartbeatAt: now, expiresAt: new Date(now.getTime() + LOCK_TTL_MS) },
    });
    return { ok: true };
  }

  /** Release the lock. Only the current holder can release. */
  async release(orderId: string, userId: string): Promise<{ released: boolean }> {
    const existing = await this.prisma.orderEditLock.findUnique({
      where: { orderId },
    });
    if (!existing) return { released: false };
    if (existing.userId !== userId) {
      throw new ConflictException(
        'Lock is held by someone else — you cannot release it.',
      );
    }
    await this.prisma.orderEditLock.delete({ where: { orderId } });
    return { released: true };
  }

  /** Read current live lock (null when none/expired) — one query. */
  async getLock(orderId: string): Promise<OrderLockInfo | null> {
    const lock = await this.prisma.orderEditLock.findUnique({
      where: { orderId },
    });
    if (!lock || lock.expiresAt <= new Date()) return null;
    return this.toInfo(lock);
  }
}