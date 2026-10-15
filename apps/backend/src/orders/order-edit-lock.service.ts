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

  /** Resolve a user's display name (one extra query). */
  private async displayNameFor(userId: string): Promise<string | null> {
    const user = await this.prisma.userProfile.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    return user && (user.firstName || user.lastName)
      ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
      : null;
  }

  /** Enrich a raw lock row with the holder's display name (one extra query). */
  private async toInfo(lock: {
    orderId: string;
    userId: string;
    acquiredAt: Date;
    heartbeatAt: Date;
    expiresAt: Date;
  }): Promise<OrderLockInfo> {
    const name = await this.displayNameFor(lock.userId);
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
   *
   * Hardening (5b): find-or-create. A free lock is taken with a plain create
   * (201 stays); refresh/takeover and race-recovery go through upsert so a
   * concurrent release between the read and the write can never surface a
   * P2025. The benign create-race (P2002 — someone else created first) is
   * resolved by re-reading and NEVER hits logger.error; only genuine failures
   * are logged.
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

    const existing = await this.prisma.orderEditLock.findUnique({
      where: { orderId },
    });
    if (existing && existing.expiresAt > now && existing.userId !== userId) {
      return { acquired: false, heldBy: await this.toInfo(existing) };
    }
    if (existing) {
      // Own live lock → refresh; expired lock → takeover. Upsert is the
      // find-or-create: it also survives a concurrent release (no P2025).
      const lock = await this.prisma.orderEditLock.upsert({
        where: { orderId },
        create: { orderId, userId, expiresAt },
        update: { userId, heartbeatAt: now, expiresAt },
      });
      if (existing.userId !== userId) {
        const prevName = await this.displayNameFor(existing.userId);
        await this.appendAuditEntry(orderId, {
          type: 'edit_lock',
          visibility: 'private',
          timestamp: new Date().toISOString(),
          note: prevName
            ? `Lock taken over after expiry — previous holder: ${prevName}.`
            : `Lock taken over after expiry (previous holder released session).`,
          performedBy: userId,
        });
      }
      return { acquired: true, lock: await this.toInfo(lock) };
    }

    try {
      const lock = await this.prisma.orderEditLock.create({
        data: { orderId, userId, expiresAt },
      });
      return { acquired: true, lock: await this.toInfo(lock) };
    } catch (err) {
      // Benign race: another holder created the row between our read and our
      // create. Re-read to decide — never logger.error here.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const raced = await this.prisma.orderEditLock.findUnique({
          where: { orderId },
        });
        if (!raced) {
          // Released again between the failed create and the re-read —
          // find-or-create via upsert, no error to log.
          const lock = await this.prisma.orderEditLock.upsert({
            where: { orderId },
            create: { orderId, userId, expiresAt },
            update: { userId, heartbeatAt: new Date(), expiresAt },
          });
          return { acquired: true, lock: await this.toInfo(lock) };
        }
        if (raced.expiresAt > new Date() && raced.userId !== userId) {
          return { acquired: false, heldBy: await this.toInfo(raced) };
        }
        const lock = await this.prisma.orderEditLock.upsert({
          where: { orderId },
          create: { orderId, userId, expiresAt },
          update: { userId, heartbeatAt: new Date(), expiresAt },
        });
        if (raced.userId !== userId) {
          const prevName = await this.displayNameFor(raced.userId);
          await this.appendAuditEntry(orderId, {
            type: 'edit_lock',
            visibility: 'private',
            timestamp: new Date().toISOString(),
            note: prevName
              ? `Lock taken over after expiry — previous holder: ${prevName}.`
              : `Lock taken over after expiry (previous holder released session).`,
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
    const existing = await this.prisma.orderEditLock.findUnique({
      where: { orderId },
    });
    const lock = await this.prisma.orderEditLock.upsert({
      where: { orderId },
      create: { orderId, userId, expiresAt },
      update: { userId, heartbeatAt: now, expiresAt },
    });
    const prevName =
      existing && existing.userId !== userId
        ? await this.displayNameFor(existing.userId)
        : null;
    const myName = await this.displayNameFor(userId);
    await this.appendAuditEntry(orderId, {
      type: 'edit_lock',
      visibility: 'private',
      timestamp: now.toISOString(),
      note: prevName
        ? `Edit lock overridden by ${myName || 'a staff member'} — previous holder: ${prevName}.`
        : `Edit lock taken by ${myName || 'a staff member'}.`,
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