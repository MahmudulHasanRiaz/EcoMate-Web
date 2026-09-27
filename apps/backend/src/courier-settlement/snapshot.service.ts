// ── Finalization snapshot (§14.2) — immutable point-in-time financial picture.
//
// Written INSIDE the finalization transaction; no update/delete path exists.
// It is the historical truth: a later revision or adjustment never rewrites it.

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { round2 } from './accounting/courier-accounting';

export interface InvoiceTotals {
  collected: number;
  charges: number;
  net: number;
  residual: number;
  cashReceived: number;
  cashDisbursed: number;
}

export interface SnapshotRowPayload {
  rowNumber: number;
  rowClass: string;
  rowKind: string;
  consignmentId: string | null;
  orderId: string | null;
  matchMethod: string;
  declaredCollected: number;
  declaredCharges: number;
  declaredNet: number;
  effectiveCollected: number;
  effectiveCharges: number;
  effectiveNet: number;
  reviewState: string;
}

/** Sum the effective DATA rows of an invoice (superseded excluded). */
export function computeInvoiceTotals(
  rows: {
    rowClass: string;
    supersededByRowId: string | null;
    effectiveCollected: number;
    effectiveCharges: number;
    effectiveNet: number;
  }[],
): InvoiceTotals {
  const data = rows.filter((r) => r.rowClass === 'DATA' && r.supersededByRowId == null);
  const collected = round2(data.reduce((s, r) => s + r.effectiveCollected, 0));
  const charges = round2(data.reduce((s, r) => s + r.effectiveCharges, 0));
  const net = round2(data.reduce((s, r) => s + r.effectiveNet, 0));
  return {
    collected,
    charges,
    net,
    residual: round2(collected - charges - net),
    cashReceived: round2(data.reduce((s, r) => s + Math.max(r.effectiveNet, 0), 0)),
    cashDisbursed: round2(data.reduce((s, r) => s + Math.max(-r.effectiveNet, 0), 0)),
  };
}

/**
 * DB-side equivalent of `computeInvoiceTotals` — a constant number of
 * aggregate/groupBy queries instead of loading every row (§14/§16 scalability).
 * `cashReceived`/`cashDisbursed` are per-row sign splits, so they need the two
 * filtered aggregates rather than a plain column sum.
 */
export async function aggregateInvoiceTotals(
  prisma: PrismaService,
  invoiceId: string,
): Promise<{ totals: InvoiceTotals; currentRows: number; supersededRows: number }> {
  const base = { invoiceId, rowClass: 'DATA' as const, supersededByRowId: null };
  const [sums, positive, negative, counts] = await Promise.all([
    prisma.courierSettlementRow.aggregate({
      where: base,
      _sum: { effectiveCollected: true, effectiveCharges: true, effectiveNet: true },
    }),
    prisma.courierSettlementRow.aggregate({
      where: { ...base, effectiveNet: { gt: 0 } },
      _sum: { effectiveNet: true },
    }),
    prisma.courierSettlementRow.aggregate({
      where: { ...base, effectiveNet: { lt: 0 } },
      _sum: { effectiveNet: true },
    }),
    prisma.courierSettlementRow.groupBy({
      by: ['supersededByRowId'],
      where: { invoiceId },
      _count: { _all: true },
    }),
  ]);
  const collected = round2(num(sums._sum.effectiveCollected));
  const charges = round2(num(sums._sum.effectiveCharges));
  const net = round2(num(sums._sum.effectiveNet));
  const totals: InvoiceTotals = {
    collected,
    charges,
    net,
    residual: round2(collected - charges - net),
    cashReceived: round2(num(positive._sum.effectiveNet)),
    cashDisbursed: round2(-num(negative._sum.effectiveNet)),
  };
  let currentRows = 0;
  let supersededRows = 0;
  for (const g of counts) {
    if (g.supersededByRowId == null) currentRows += g._count._all;
    else supersededRows += g._count._all;
  }
  return { totals, currentRows, supersededRows };
}

@Injectable()
export class CourierSettlementSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async getHistorical(invoiceId: string) {
    const snapshots = await this.prisma.courierSettlementFinalizationSnapshot.findMany({
      where: { invoiceId },
      orderBy: { version: 'desc' },
    });
    if (snapshots.length === 0) {
      throw new NotFoundException('No finalization snapshot exists for this invoice');
    }
    const latest = snapshots[0];
    return {
      version: latest.version,
      takenAt: latest.takenAt,
      takenById: latest.takenById,
      journalEntryId: latest.journalEntryId,
      reason: latest.reason,
      totals: latest.totals as unknown as InvoiceTotals,
      rows: latest.rows as unknown as SnapshotRowPayload[],
      snapshots: snapshots.map((s) => ({
        version: s.version,
        takenAt: s.takenAt,
        reason: s.reason,
      })),
    };
  }

  /** Current effective state: superseded excluded, adjustments applied. */
  async getEffective(invoiceId: string) {
    const invoice = await this.prisma.courierSettlementInvoice.findUnique({
      where: { id: invoiceId },
      select: { state: true, accountingStatus: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    // Constant queries instead of loading every row — an imported invoice can
    // carry 100k rows and this endpoint is hit on every detail read (§16).
    const { totals, currentRows, supersededRows } = await aggregateInvoiceTotals(
      this.prisma,
      invoiceId,
    );
    return {
      state: invoice.state,
      accountingStatus: invoice.accountingStatus,
      effectiveTotals: totals,
      currentRows,
      supersededRows,
    };
  }
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}