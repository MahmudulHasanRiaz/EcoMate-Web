// ── Cost write-back (§7): recompute Order.shippingCost from contributing rows.
//
// Absolute recompute over the union of all finalized, non-superseded, DATA rows
// for the order — including when the result is 0. The previous value/source is
// recorded on the order timeline and activity so the override is visible.

import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { projectOrderCost, shippingCostWrite } from './cost-projection';
import { FINALIZED_INVOICE_STATES } from './cost-projection';

interface Tx {
  order: Prisma.TransactionClient['order'];
  courierSettlementRow: Prisma.TransactionClient['courierSettlementRow'];
  courierSettlementException: Prisma.TransactionClient['courierSettlementException'];
}

export interface WriteBackResult {
  orderId: string;
  before: { value: number | null; source: string | null };
  after: { value: number; source: string };
  zeroCostReview: boolean;
}

@Injectable()
export class CourierSettlementCostService {
  private readonly logger = new Logger(CourierSettlementCostService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Compute the projection for an order from all finalized contributing rows. */
  async project(orderId: string) {
    const rows = await this.prisma.courierSettlementRow.findMany({
      where: { orderId },
      select: {
        invoice: { select: { state: true } },
        rowClass: true,
        orderId: true,
        supersededByRowId: true,
        effectiveCharges: true,
        declaredCharges: true,
      },
    });
    return projectOrderCost(
      orderId,
      rows.map((r) => ({
        invoiceState: r.invoice.state,
        rowClass: r.rowClass,
        orderId: r.orderId,
        supersededByRowId: r.supersededByRowId,
        effectiveCharges: num(r.effectiveCharges),
        declaredCharges: num(r.declaredCharges),
      })),
    );
  }

  /**
   * Write the projection to Order.shippingCost/source for MANY orders at once.
   * Reads are batched (all rows in one query, all orders in one query) and only
   * the writes stay per-order — the finalize path used to issue 3 queries per
   * matched order (§14 N+1 audit). Returns the results for orders that changed.
   */
  async writeBackMany(
    orderIds: string[],
    tx?: Tx,
    actor?: string | null,
  ): Promise<WriteBackResult[]> {
    if (orderIds.length === 0) return [];
    const client = tx ?? (this.prisma as unknown as Tx);
    const [rows, orders] = await Promise.all([
      client.courierSettlementRow.findMany({
        where: { orderId: { in: orderIds } },
        select: {
          invoiceId: true,
          invoice: { select: { state: true } },
          rowClass: true,
          orderId: true,
          supersededByRowId: true,
          effectiveCharges: true,
          declaredCharges: true,
        },
      }),
      client.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, shippingCost: true, shippingCostSource: true, timeline: true },
      }),
    ]);

    const rowsByOrder = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!r.orderId) continue;
      const list = rowsByOrder.get(r.orderId);
      if (list) list.push(r);
      else rowsByOrder.set(r.orderId, [r]);
    }
    const orderById = new Map(orders.map((o) => [o.id, o]));

    const results: WriteBackResult[] = [];
    const zeroCostCreates: {
      invoiceId: string;
      orderId: string;
      ruleId: string;
      severity: string;
      blocked: boolean;
      status: string;
      message: string;
      context: unknown;
    }[] = [];

    for (const orderId of orderIds) {
      const orderRows = rowsByOrder.get(orderId) ?? [];
      const projection = projectOrderCost(
        orderId,
        orderRows.map((r) => ({
          invoiceState: r.invoice.state,
          rowClass: r.rowClass,
          orderId: r.orderId,
          supersededByRowId: r.supersededByRowId,
          effectiveCharges: num(r.effectiveCharges),
          declaredCharges: num(r.declaredCharges),
        })),
      );
      const write = shippingCostWrite(projection);
      if (!write) continue;
      const order = orderById.get(orderId);
      if (!order) continue;

      const before = { value: numOrNull(order.shippingCost), source: order.shippingCostSource ?? null };
      const timeline = Array.isArray(order.timeline) ? (order.timeline as unknown[]) : [];
      timeline.push({
        status: 'Courier cost updated',
        timestamp: new Date().toISOString(),
        note:
          `Courier invoice: shipping cost ${before.value ?? '—'} (${before.source ?? 'none'}) → ` +
          `${write.shippingCost} (${write.shippingCostSource})`,
        actor: actor ?? null,
      });

      await client.order.update({
        where: { id: orderId },
        data: {
          shippingCost: write.shippingCost,
          shippingCostSource: write.shippingCostSource,
          timeline: timeline as never,
        },
      });

      if (projection.zeroCostReview) {
        const source = orderRows.find(
          (r) =>
            r.supersededByRowId == null &&
            (FINALIZED_INVOICE_STATES as readonly string[]).includes(r.invoice.state),
        );
        if (source) {
          zeroCostCreates.push({
            invoiceId: source.invoiceId,
            orderId,
            ruleId: 'ZERO_COST_REVIEW',
            severity: 'yellow',
            blocked: false,
            status: 'open',
            message:
              'Invoice covers the order but declares no courier charge; the 0 projection is recorded.',
            context: { orderId, projection: write.shippingCost },
          });
        }
      }

      results.push({
        orderId,
        before,
        after: { value: write.shippingCost, source: write.shippingCostSource },
        zeroCostReview: projection.zeroCostReview,
      });
    }

    if (zeroCostCreates.length > 0) {
      await client.courierSettlementException.createMany({
        data: zeroCostCreates as never,
      });
    }
    return results;
  }

  /**
   * Single-order convenience wrapper (adjustment cascades). Returns null when
   * the order has no contributing rows (no invoice evidence ⇒ no write).
   */
  async writeBack(orderId: string, tx?: Tx, actor?: string | null): Promise<WriteBackResult | null> {
    const results = await this.writeBackMany([orderId], tx, actor);
    return results[0] ?? null;
  }
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}