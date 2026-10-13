import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
      include: { payments: true, dispatches: true },
    });
    if (!order) return [];
    const paid = (order as any).payments
      .filter((p: any) => p.status === 'PAID')
      .reduce((s: number, p: any) => s + Number(p.amount), 0);
    const applied = (order as any).payments.reduce(
      (s: number, p: any) => s + Number(p.appliedCreditAmount ?? 0),
      0,
    );
    const systemDue = Math.max(0, Number((order as any).total) - paid - applied);
    const live = (order as any).dispatches.filter((d: any) => d.status !== 'CANCELLED');
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

  async resolve(alertId: string, userId: string) {    const row = await this.prisma.codMismatchAlert.update({
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
