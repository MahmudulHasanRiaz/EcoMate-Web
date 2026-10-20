import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { deriveOrderDue } from '../common/finance/order-due';
import {
  receivedReturnValue,
  RECEIVED_RETURN_STATUSES,
} from '../common/finance/return-impact';

const OPEN = 'open';
const RESOLVED = 'resolved';
const CLEARED = 'cleared';

@Injectable()
export class CodMismatchService {
  constructor(private readonly prisma: PrismaService) {}

  /** Recompute COD mismatch alerts for an order. Shared single copy — called
   * from every collectable-affecting mutation (Task 4). Returns alerts
   * raised/refreshed in this run. */
  async recompute(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        payments: true,
        dispatches: true,
        status: { select: { name: true } },
        items: {
          select: {
            productId: true,
            variantId: true,
            price: true,
            quantity: true,
          },
        },
        returns: {
          where: { status: { in: [...RECEIVED_RETURN_STATUSES] as any } },
          select: { id: true, status: true, receivedAt: true, items: true },
        },
      },
    });
    if (!order) return [];
    // ONE shared due derivation (total − PAID ∖ settlement − credit −
    // received returns). The expected collectable always matches the order
    // payment card; a received partial return lowers what the courier owes.
    const systemDue = deriveOrderDue({
      total: Number((order as any).total),
      payments: (order as any).payments,
      receivedReturnValue: receivedReturnValue({
        returns: (order as any).returns ?? [],
        orderItems: (order as any).items ?? [],
      }),
      cancelled: (order as any).status?.name === 'Cancelled',
    }).due;
    // Task 10 (owner-locked): approval_pending NEVER settles — only
    // delivered/partial_delivered/cancelled count in the COD-alert. Unsettled
    // rows (anything ending `_approval_pending` + `exceptional`) are the
    // rider's word, not ours: skip them here AND in the stale-clear pass.
    const live = (order as any).dispatches.filter(
      (d: any) => d.status !== 'CANCELLED' && !isUnsettledCourierStatus(d.courierStatus),
    );
    const out: any[] = [];
    for (const d of live) {
      // NULL courierAmount = pre-existing dispatch, cannot compare — skip, never fabricate 0.
      if (d.courierAmount === null || d.courierAmount === undefined) continue;
      const courierAmount = Number(d.courierAmount);
      if (courierAmount !== systemDue) {
        const existing = await this.prisma.codMismatchAlert.findFirst({
          where: { orderId, consignmentId: d.consignmentId, status: OPEN },
        });
        const amountsChanged =
          !existing ||
          Number((existing as any).courierAmount) !== courierAmount ||
          Number((existing as any).systemDue) !== systemDue;
        const row = existing
          ? await this.prisma.codMismatchAlert.update({
              where: { id: existing.id },
              data: { courierAmount, systemDue },
            })
          : await this.prisma.codMismatchAlert.create({
              data: {
                orderId,
                courier: String(d.courier),
                consignmentId: d.consignmentId,
                courierAmount,
                systemDue,
                status: OPEN,
              },
            });
        out.push(row);
        // Guard: "raised" timeline only on a new alert or a real amount
        // change — every recompute refreshes open rows, so an unconditional
        // write spams the timeline once all 9 mutation paths call it.
        if (amountsChanged) {
          await this.writeTimeline(
            orderId,
            `COD mismatch raised: courier ৳${courierAmount} vs due ৳${systemDue} (${d.consignmentId})`,
          );
        }
      }
    }
    // Clear stale open alerts: consignment gone/cancelled OR amounts match again.
    // 'cleared' is system-only — 'resolved' is manual-only via resolve().
    const open = await this.prisma.codMismatchAlert.findMany({
      where: { orderId, status: OPEN },
    });
    for (const a of open) {
      const stillMismatched = live.some(
        (d: any) =>
          d.consignmentId === a.consignmentId &&
          d.courierAmount !== null &&
          d.courierAmount !== undefined &&
          Number(d.courierAmount) !== systemDue,
      );
      if (!stillMismatched) {
        await this.prisma.codMismatchAlert.update({
          where: { id: a.id },
          data: { status: CLEARED },
        });
      }
    }
    return out;
  }

  /** List all alerts (open + resolved + cleared) for an order, newest first. */
  async listForOrder(orderId: string) {
    return this.prisma.codMismatchAlert.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resolve(alertId: string, userId: string, orderId?: string) {
    if (orderId) {
      const existing = await this.prisma.codMismatchAlert.findFirst({
        where: { id: alertId, orderId },
      });
      if (!existing) {
        throw new NotFoundException(
          `COD alert ${alertId} not found for order ${orderId}`,
        );
      }
    }
    const row = await this.prisma.codMismatchAlert.update({
      where: { id: alertId },
      data: { status: RESOLVED, resolvedBy: userId, resolvedAt: new Date() },
    });
    await this.writeTimeline(
      row.orderId,
      `COD mismatch resolved by ${userId} (${row.consignmentId})`,
    );
    return row;
  }

  private async writeTimeline(orderId: string, text: string) {
    // Timeline is Order.timeline Json (schema.prisma) — append, never a separate model.
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { timeline: true },
    });
    const arr = Array.isArray((order as any)?.timeline)
      ? [...((order as any).timeline as any[])]
      : [];
    arr.push({ event: text, at: new Date().toISOString() });
    await this.prisma.order.update({ where: { id: orderId }, data: { timeline: arr as any } });
  }
}

/**
 * Task 10 (owner-locked): approval_pending NEVER settles. Local copy of the
 * shared guard (kept dependency-free — mirrors
 * `courier-manager/courier-settle-guard.ts isUnsettledCourierStatus`).
 */
function isUnsettledCourierStatus(status: string | null | undefined): boolean {
  const s = String(status ?? '').trim().toLowerCase();
  if (!s) return false;
  if (s === 'exceptional') return true;
  return s.endsWith('_approval_pending');
}
