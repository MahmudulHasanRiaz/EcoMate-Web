import { BadRequestException, Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import {
  POS_ANALYTICS_SCOPES,
  PosAnalyticsQueryDto,
} from './dto/pos-analytics-query.dto';
import {
  POS_DATE_BASIS,
  POS_FORMULA_VERSION,
  PosRange,
  resolvePosRange,
} from './pos-analytics-range';
import { DHAKA_OFFSET_MS } from '../common/utils/dhaka-time';

/** Order statuses that never count (spec §3/§9). Compared case-insensitively. */
const EXCLUDED_STATUS_NAMES = new Set(['cancelled', 'returned', 'damaged']);

/**
 * Refund rows that reduce net sales: an approval/completion status AND
 * processedAt set. `pending`/`rejected` never count (spec §3; verified
 * against refunds.service: pending → approved → completed, processedAt is
 * stamped on every status transition out of pending).
 */
const PROCESSED_REFUND_STATUSES = new Set(['approved', 'completed']);

/** Fixed DB page size for the export row producer (spec §6 memory rule). */
const FETCH_CHUNK = 500;

/** Transactions pageSize ceiling (contract). */
const PAGE_SIZE_CAP = 100;

export interface AnalyticsRequest {
  sessionId?: string;
  userId: string;
  query: PosAnalyticsQueryDto;
  /** Any client-supplied showroomId — always rejected (fail closed). */
  forgedShowroomId?: string;
}

export interface ReportRow {
  orderId: string;
  displayId: string;
  reportingAt: Date;
  customerName: string;
  staffName: string;
  itemsSummary: string;
  quantity: number;
  discount: number;
  grossTotal: number;
  refundsTotal: number;
  netTotal: number;
  paymentMethods: string[];
  status: string;
  fullyRefunded: boolean;
  lines: Array<{ name: string; qty: number; unitPrice: number }>;
}

interface ScopeContext {
  showroomId: string;
  showroomName: string;
  showroomSlug: string;
  mineCashierId?: string;
  range: PosRange;
  scope: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function dhakaWall(d: Date): { date: string; time: string } {
  const s = new Date(d.getTime() + DHAKA_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${s.getUTCFullYear()}-${p(s.getUTCMonth() + 1)}-${p(s.getUTCDate())}`,
    time: `${p(s.getUTCHours())}:${p(s.getUTCMinutes())}`,
  };
}

@Injectable()
export class PosAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- scope ---

  private async resolveContext(req: AnalyticsRequest): Promise<ScopeContext> {
    if (req.forgedShowroomId !== undefined && req.forgedShowroomId !== null) {
      throw new BadRequestException(
        'showroomId is not accepted: the showroom is resolved server-side from x-pos-session-id',
      );
    }
    if (!req.sessionId) {
      throw new BadRequestException(
        'POS session required (x-pos-session-id header)',
      );
    }
    const session = await this.prisma.posSession.findUnique({
      where: { id: req.sessionId },
      include: { showroom: true, cashier: true },
    });
    if (!session) {
      throw new BadRequestException('POS session not found');
    }
    if ((session as any).status !== 'open') {
      throw new BadRequestException('POS session is not active');
    }
    const showroom = (session as any).showroom;
    if (!showroom || showroom.type !== 'showroom') {
      throw new BadRequestException(
        'POS session must belong to a showroom warehouse',
      );
    }

    const scope = req.query.scope ?? 'showroom';
    if (!(POS_ANALYTICS_SCOPES as readonly string[]).includes(scope)) {
      throw new BadRequestException(`unknown scope: ${scope}`);
    }
    const range = resolvePosRange(req.query ?? {});
    return {
      showroomId: showroom.id,
      showroomName: showroom.name,
      showroomSlug: showroom.slug,
      mineCashierId: scope === 'mine' ? req.userId : undefined,
      range,
      scope,
    };
  }

  // ------------------------------------------------------------ row mapping ---

  /** Latest PAID payment completion (verifiedAt else createdAt), else Order.createdAt. */
  private reportingAtOf(order: any): Date {
    const paid = (order.payments ?? []).filter((p: any) => p.status === 'PAID');
    let latest: Date | null = null;
    for (const p of paid) {
      const at = p.verifiedAt ? new Date(p.verifiedAt) : p.createdAt ? new Date(p.createdAt) : null;
      if (at && !Number.isNaN(at.getTime()) && (!latest || at > latest)) {
        latest = at;
      }
    }
    if (latest) return latest;
    const created = order.createdAt ? new Date(order.createdAt) : null;
    return created && !Number.isNaN(created.getTime()) ? created : new Date(0);
  }

  private processedRefundTotal(order: any): number {
    return (order.refunds ?? [])
      .filter(
        (r: any) =>
          PROCESSED_REFUND_STATUSES.has(String(r.status)) && r.processedAt != null,
      )
      .reduce((s: number, r: any) => s + num(r.amount), 0);
  }

  private toReportRow(order: any): ReportRow | null {
    // In-memory inclusion guards (mirror the DB where-clause; the DB is the
    // real filter in production, these keep chunked scans honest).
    if (order.trashedAt != null) return null;
    if (order.source !== 'POS') return null;
    if (order.paymentStatus !== 'PAID') return null;
    const statusName = String(order.status?.name ?? 'Unknown');
    if (EXCLUDED_STATUS_NAMES.has(statusName.toLowerCase())) return null;

    const grossTotal = round2(num(order.total));
    const refundsTotal = round2(this.processedRefundTotal(order));
    const fullyRefunded =
      Math.round(refundsTotal * 100) >= Math.round(grossTotal * 100);
    const netTotal = fullyRefunded ? 0 : round2(grossTotal - refundsTotal);

    const items = order.items ?? [];
    const lines = items.length
      ? items.map((i: any) => ({
          name:
            i.product?.name ??
            i.variant?.product?.name ??
            i.combo?.name ??
            i.variant?.sku ??
            'Item',
          qty: i.quantity ?? 0,
          unitPrice: round2(num(i.price)),
        }))
      : [{ name: '—', qty: 0, unitPrice: 0 }];
    const itemNames = lines.map((l) => `${l.name} ×${l.qty}`);
    const joined = itemNames.join(', ');
    const itemsSummary = joined.length > 120 ? `${joined.slice(0, 117)}…` : joined;

    const paid = (order.payments ?? []).filter((p: any) => p.status === 'PAID');
    const paymentMethods: string[] = [
      ...new Set<string>(paid.map((p: any) => String(p.gatewayCode))),
    ];

    const cashier = order.posSession?.cashier;
    const staffName =
      [cashier?.firstName, cashier?.lastName].filter(Boolean).join(' ').trim() ||
      'Unknown';
    const customerName =
      order.guestName ||
      order.customer?.name ||
      order.guestPhone ||
      order.customer?.phone ||
      'Walk-in';

    return {
      orderId: order.id,
      displayId: order.displayId,
      reportingAt: this.reportingAtOf(order),
      customerName,
      staffName,
      itemsSummary,
      quantity: items.reduce((s: number, i: any) => s + (i.quantity ?? 0), 0),
      discount: round2(num(order.discount)),
      grossTotal,
      refundsTotal,
      netTotal,
      paymentMethods,
      status: fullyRefunded ? 'Refunded' : statusName,
      fullyRefunded,
      lines,
    };
  }

  // --------------------------------------------------------------- fetching ---

  private orderInclude() {
    return {
      status: { select: { name: true } },
      payments: {
        select: {
          status: true,
          amount: true,
          gatewayCode: true,
          verifiedAt: true,
          createdAt: true,
        },
      },
      refunds: { select: { amount: true, status: true, processedAt: true } },
      items: {
        select: {
          quantity: true,
          price: true,
          product: { select: { name: true } },
          variant: {
            select: { sku: true, product: { select: { name: true } } },
          },
          combo: { select: { name: true } },
        },
      },
      posSession: {
        select: {
          cashierId: true,
          cashier: { select: { firstName: true, lastName: true } },
        },
      },
      customer: { select: { name: true, phone: true } },
    };
  }

  /**
   * Chunked row producer: pages the DB in fixed-size chunks and yields one
   * ReportRow per in-scope sale. Shared by overview, transactions and export
   * so all three always agree; a future async export job can reuse it as-is.
   */
  async *streamReportRows(ctx: ScopeContext): AsyncGenerator<ReportRow> {
    let cursor: string | undefined;
    for (;;) {
      const batch: any[] = await this.prisma.order.findMany({
        where: {
          trashedAt: null,
          source: 'POS',
          paymentStatus: 'PAID',
          createdAt: { lte: ctx.range.end },
          posSession: {
            showroomId: ctx.showroomId,
            ...(ctx.mineCashierId ? { cashierId: ctx.mineCashierId } : {}),
          },
        },
        take: FETCH_CHUNK,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        include: this.orderInclude(),
      });
      if (!batch.length) break;
      for (const order of batch) {
        // Belt-and-braces: the DB clause above is authoritative, but the
        // reporting-day bucket and the status/refund rules are computed here.
        if (
          ctx.mineCashierId &&
          order.posSession?.cashierId !== ctx.mineCashierId
        ) {
          continue;
        }
        const row = this.toReportRow(order);
        if (!row) continue;
        if (row.reportingAt < ctx.range.start || row.reportingAt > ctx.range.end) {
          continue;
        }
        yield row;
      }
      if (batch.length < FETCH_CHUNK) break;
      cursor = batch[batch.length - 1].id;
    }
  }

  private async collectRows(ctx: ScopeContext): Promise<ReportRow[]> {
    const rows: ReportRow[] = [];
    for await (const row of this.streamReportRows(ctx)) rows.push(row);
    return rows;
  }

  /** All in-range listed rows (counted sales + flagged full refunds). */
  async collectExportRows(req: AnalyticsRequest): Promise<{ rows: ReportRow[] }> {
    const ctx = await this.resolveContext(req);
    return { rows: await this.collectRows(ctx) };
  }

  private sortRows(rows: ReportRow[], query: PosAnalyticsQueryDto): ReportRow[] {
    const dir = query.order === 'asc' ? 1 : -1;
    const key =
      query.sort === 'total'
        ? (r: ReportRow) => r.netTotal
        : (r: ReportRow) => r.reportingAt.getTime();
    return [...rows].sort((a, b) => {
      const d = key(a) - key(b);
      if (d !== 0) return d * dir;
      // Stable tiebreak: displayId ascending, independent of direction.
      return a.displayId < b.displayId ? -1 : a.displayId > b.displayId ? 1 : 0;
    });
  }

  // --------------------------------------------------------------- endpoints ---

  async getOverview(req: AnalyticsRequest) {
    const ctx = await this.resolveContext(req);
    const rows = (await this.collectRows(ctx)).filter((r) => !r.fullyRefunded);
    const grossSales = round2(rows.reduce((s, r) => s + r.grossTotal, 0));
    const refundsTotal = round2(rows.reduce((s, r) => s + r.refundsTotal, 0));
    const netSales = round2(rows.reduce((s, r) => s + r.netTotal, 0));
    const totalOrders = rows.length;
    return {
      data: {
        netSales,
        grossSales,
        refundsTotal,
        discountTotal: round2(rows.reduce((s, r) => s + r.discount, 0)),
        totalOrders,
        unitsSold: rows.reduce((s, r) => s + r.quantity, 0),
        avgOrderValue: totalOrders > 0 ? round2(netSales / totalOrders) : 0,
      },
      meta: {
        range: { from: ctx.range.from, to: ctx.range.to },
        scope: ctx.scope,
        formulaVersion: POS_FORMULA_VERSION,
        dateBasis: POS_DATE_BASIS,
      },
    };
  }

  async getTransactions(req: AnalyticsRequest) {
    const ctx = await this.resolveContext(req);
    const rows = this.sortRows(await this.collectRows(ctx), req.query ?? {});
    const page = Math.max(1, Math.floor(num(req.query?.page) || 1));
    const pageSize = Math.min(
      PAGE_SIZE_CAP,
      Math.max(1, Math.floor(num(req.query?.pageSize) || 20)),
    );
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const slice = rows.slice((page - 1) * pageSize, page * pageSize);
    return {
      data: slice.map((r) => ({
        orderId: r.orderId,
        displayId: r.displayId,
        reportingAt: r.reportingAt.toISOString(),
        customerName: r.customerName,
        staffName: r.staffName,
        itemsSummary: r.itemsSummary,
        quantity: r.quantity,
        discount: r.discount,
        total: r.netTotal,
        paymentMethods: r.paymentMethods,
        status: r.status,
      })),
      meta: {
        range: { from: ctx.range.from, to: ctx.range.to },
        scope: ctx.scope,
        formulaVersion: POS_FORMULA_VERSION,
        dateBasis: POS_DATE_BASIS,
        page,
        pageSize,
        total,
        totalPages,
      },
    };
  }

  // ----------------------------------------------------------------- export ---

  async buildExport(req: AnalyticsRequest): Promise<{ buffer: Buffer; filename: string }> {
    const ctx = await this.resolveContext(req);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'EcoMate POS';
    const ws = wb.addWorksheet('POS Sales');

    const BDT = '৳#,##0.00';
    const titleFont = { bold: true, size: 14 };
    const labelFont = { bold: true };
    const summaryFill = {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: 'FFF2F2F2' },
    };

    let r = 1;
    ws.getCell(`A${r}`).value = 'POS Sales Report';
    ws.getCell(`A${r}`).font = titleFont;
    r += 1;
    ws.getCell(`A${r}`).value = `Showroom: ${ctx.showroomName}`;
    r += 1;
    ws.getCell(`A${r}`).value =
      `Period: ${ctx.range.from} to ${ctx.range.to} (${ctx.range.periodDays} days)`;
    r += 1;
    const gen = dhakaWall(new Date());
    ws.getCell(`A${r}`).value =
      `Generated: ${gen.date} ${gen.time} (Asia/Dhaka) by ${req.userId}`;
    r += 2;

    // One DB pass in fixed-size chunks (streamReportRows): KPIs accumulate
    // while order-level rows collect (small); item lines ride on the rows so
    // no per-order re-query is needed.
    const detail: ReportRow[] = [];
    let gross = 0;
    let refunds = 0;
    let net = 0;
    let discountSum = 0;
    let orders = 0;
    let units = 0;
    for await (const row of this.streamReportRows(ctx)) {
      detail.push(row);
      if (!row.fullyRefunded) {
        gross += row.grossTotal;
        refunds += row.refundsTotal;
        net += row.netTotal;
        discountSum += row.discount;
        orders += 1;
        units += row.quantity;
      }
    }
    const kpi = {
      gross: round2(gross),
      refunds: round2(refunds),
      net: round2(net),
      discount: round2(discountSum),
      orders,
      units,
    };
    const summaryRows: Array<[string, number | string]> = [
      ['Gross sales (BDT)', kpi.gross],
      ['Refunds (BDT)', kpi.refunds],
      ['Net sales (BDT)', kpi.net],
      ['Discount (BDT)', kpi.discount],
      ['Orders counted', kpi.orders],
      ['Units sold', kpi.units],
      ['Avg order value (BDT)', kpi.orders > 0 ? round2(kpi.net / kpi.orders) : 0],
    ];
    for (const [label, value] of summaryRows) {
      ws.getCell(`A${r}`).value = label;
      ws.getCell(`A${r}`).font = labelFont;
      ws.getCell(`B${r}`).value = value;
      if (typeof value === 'number') ws.getCell(`B${r}`).numFmt = BDT;
      ws.getCell(`A${r}`).fill = summaryFill;
      ws.getCell(`B${r}`).fill = summaryFill;
      r += 1;
    }
    r += 1;

    // Detail header.
    const headers = [
      'Order No', 'Date', 'Time', 'Customer', 'Staff', 'Product',
      'Qty', 'Unit Price (BDT)', 'Discount (BDT)', 'Line Total (BDT)',
      'Payment Method', 'Status',
    ];
    const headerRowIdx = r;
    headers.forEach((h, i) => {
      const cell = ws.getRow(headerRowIdx).getCell(i + 1);
      cell.value = h;
      cell.font = labelFont;
      cell.fill = summaryFill;
    });
    ws.autoFilter = {
      from: { row: headerRowIdx, column: 1 },
      to: { row: headerRowIdx, column: headers.length },
    };
    ws.views = [{ state: 'frozen', ySplit: headerRowIdx }];
    r += 1;

    // Detail rows: one per order ITEM; order context repeats but order money
    // is never re-added (totals come from the KPI block above).
    const money = (cell: ExcelJS.Cell, v: number) => {
      cell.value = v;
      cell.numFmt = BDT;
    };
    for (const row of detail) {
      const wall = dhakaWall(row.reportingAt);
      for (const it of row.lines) {
        const excelRow = ws.addRow([
          row.displayId,
          wall.date,
          wall.time,
          row.customerName,
          row.staffName,
          it.name,
          it.qty,
          it.unitPrice,
          row.discount,
          round2(it.qty * it.unitPrice),
          row.paymentMethods.join('/'),
          row.status,
        ]);
        money(excelRow.getCell(8), it.unitPrice);
        money(excelRow.getCell(9), row.discount);
        money(excelRow.getCell(10), round2(it.qty * it.unitPrice));
      }
    }

    // Totals row matches dashboard net sales.
    const totalRow = ws.addRow([
      `TOTAL (Net Sales, ${kpi.orders} orders)`,
      '', '', '', '', '', '', '', '', kpi.net, '', '',
    ]);
    totalRow.font = labelFont;
    totalRow.fill = summaryFill;
    money(totalRow.getCell(10), kpi.net);

    ws.columns = [
      { width: 18 }, { width: 12 }, { width: 8 }, { width: 18 },
      { width: 16 }, { width: 30 }, { width: 6 }, { width: 16 },
      { width: 14 }, { width: 16 }, { width: 14 }, { width: 12 },
    ];

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const safeSlug = ctx.showroomSlug.replace(/[^A-Za-z0-9-_]+/g, '-');
    return {
      buffer,
      filename: `POS-Sales-${safeSlug}-${ctx.range.from}_${ctx.range.to}.xlsx`,
    };
  }
}

