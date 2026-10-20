import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { appendOrderTimeline } from '../orders/order-timeline.util';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';
import {
  assertNoDuplicateReturn,
  assertReturnEligible,
  COURIER_GUARD_SKIP_REASON,
  generateReturnDisplayId,
  orderItemsSnapshotForClient,
  restoreStockForReturnTx,
  validateReturnItemsShape,
} from './return-guard';

export interface ReturnItemInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
  damagedQuantity?: number;
  damageLog?: Array<{
    qty: number;
    at: string | Date;
    phase: 'receive' | 'later';
    by?: string | null;
  }>;
  /** Warehouse that received the units — the later-damage write-off target. */
  warehouseId?: string | null;
}

export interface CreateReturnInput {
  orderId: string;
  type: 'FULL' | 'PARTIAL' | 'EXCHANGE';
  items?: ReturnItemInput[];
  reason?: string;
  source?: 'STAFF' | 'COURIER' | 'EXCHANGE';
  courier?: string;
  courierReturnId?: string;
  courierStatus?: string;
  exchangeOrderId?: string;
  /** Signed per-field adjustment on the ORIGINAL order (partial returns only). */
  shippingAdjustment?: number;
  /** Signed per-field adjustment on the ORIGINAL order (partial returns only). */
  discountAdjustment?: number;
  /**
   * Partial returns only (default true): true → the original order is set to
   * Delivered as part of creation; false → left untouched so courier status
   * updates (the sheet is authority) drive it. Explicitly sending this on
   * FULL is a 400.
   */
  markOriginalDelivered?: boolean;
}

export interface UpsertCourierReturnInput {
  orderId: string;
  courier: string;
  courierReturnId?: string | null;
  courierStatus?: string | null;
  type?: 'FULL' | 'PARTIAL' | 'EXCHANGE';
  reason?: string | null;
}

const RETURN_TYPES = ['FULL', 'PARTIAL', 'EXCHANGE'];
const RETURN_SOURCES = ['STAFF', 'COURIER', 'EXCHANGE'];

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => Number(Number(n).toFixed(2));
const signed = (n: number) => `${n > 0 ? '+' : ''}${money(n)}`;

/**
 * Task 6 (Fix 13 §§17.1–17.3): unified Return entity.
 *
 * EVERY return creates ONE Return row (staff, courier, or exchange sourced) —
 * never a phantom Order. RTN return-orders (rtn module) stay a separate flow.
 *
 * Stock rule: restoration is ITEM-LEVEL — exactly the Return.items quantities
 * (see CancelReturnStockService.restoreForReturnItems). Courier-sourced rows
 * start with EMPTY items (the courier API never reports the split) and nothing
 * restocks until staff confirm exact quantities at markReceived. The kept /
 * delivered part of a partial therefore can never restock.
 */
@Injectable()
export class ReturnsService {
  private readonly logger = new Logger(ReturnsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cancelReturnStock: CancelReturnStockService,
  ) {}

  // ------------------------------------------------------------------ create

  /**
   * Task 4 (Fix 8): optional `tx` runs the whole creation inside a caller's
   * transaction (the PARTIAL exchange creates its exchange order + this
   * Return in ONE commit — TWO records at once). Without `tx` the behavior
   * is exactly the Task 6 standalone path.
   *
   * Signed per-field billing adjustments (partial returns): when present the
   * return row, the ORIGINAL order's shippingCharge/discount/total update and
   * the timeline entries commit in ONE transaction — all-or-nothing. With no
   * adjustments the path is byte-identical to before (no extra transaction).
   *
   * Mark-original-delivered (partial returns, default true): the original
   * order's status update (and the decision timeline entry) join the SAME
   * transaction as the Return row. PARTIAL returns therefore always run a
   * business transaction; FULL/EXCHANGE without adjustments keep the legacy
   * no-extra-tx path.
   */
  async create(dto: CreateReturnInput, performedBy?: string, tx?: Prisma.TransactionClient) {
    const shippingAdjustment = dto.shippingAdjustment ?? 0;
    const discountAdjustment = dto.discountAdjustment ?? 0;
    const hasAdjustments = shippingAdjustment !== 0 || discountAdjustment !== 0;
    const needsBusinessTx = hasAdjustments || dto.type === 'PARTIAL';
    if (tx) {
      return this.createInner(dto, performedBy, tx, shippingAdjustment, discountAdjustment, hasAdjustments);
    }
    if (!needsBusinessTx) {
      return this.createInner(dto, performedBy, undefined, 0, 0, false);
    }
    return this.prisma.$transaction((client) =>
      this.createInner(dto, performedBy, client, shippingAdjustment, discountAdjustment, hasAdjustments),
    );
  }

  private async createInner(
    dto: CreateReturnInput,
    performedBy: string | undefined,
    tx: Prisma.TransactionClient | undefined,
    shippingAdjustment: number,
    discountAdjustment: number,
    hasAdjustments: boolean,
  ) {
    const db = (tx ?? this.prisma) as Prisma.TransactionClient & {
      order: { findUnique: (...args: any[]) => Promise<any> };
      orderStatus: { findUnique: (...args: any[]) => Promise<any> };
    };
    const order = await db.order.findUnique({
      where: { id: dto.orderId },
      include: { status: true },
    });
    if (!order || (order as any).trashedAt) {
      throw new NotFoundException(`Order not found: ${dto.orderId}`);
    }
    if (!RETURN_TYPES.includes(dto.type)) {
      throw new BadRequestException(`Invalid return type: ${dto.type}`);
    }
    const source = dto.source ?? 'STAFF';
    if (!RETURN_SOURCES.includes(source)) {
      throw new BadRequestException(`Invalid return source: ${dto.source}`);
    }
    const items = this.validateItems(dto.items ?? []);

    // Hardening (1): shared eligibility guard + 60s duplicate guard. EXCHANGE
    // legs skip the overlap checks (own lifecycle) but keep the duplicate
    // guard — the check runs on the caller's client (tx-aware).
    await assertReturnEligible(db, dto.orderId, { type: dto.type, items });
    await assertNoDuplicateReturn(db, dto.orderId, dto.type, items);

    const displayId = tx
      ? await this.generateDisplayIdInTx(tx)
      : await this.generateDisplayId();

    // Adjustments are validated BEFORE anything persists; they still commit
    // inside the same tx as the Return row (all-or-nothing with the guards).
    const adjustment = hasAdjustments
      ? this.resolvePartialAdjustments(order, dto, displayId, performedBy, shippingAdjustment, discountAdjustment)
      : null;

    // Mark-original-delivered decision (partial only). Both branches record
    // the decision on the original order's timeline; the checked branch also
    // schedules the statusId update — all inside the same transaction.
    const decision = await this.resolveMarkDeliveredDecision(db, order, dto, displayId, performedBy);

    const ret = await db.return.create({
      data: {
        orderId: dto.orderId,
        displayId,
        type: dto.type as any,
        status: 'REQUESTED' as any,
        source: source as any,
        items: items as unknown as Prisma.InputJsonValue,
        reason: dto.reason ?? null,
        createdBy: performedBy ?? null,
        courier: dto.courier ?? null,
        courierReturnId: dto.courierReturnId ?? null,
        courierStatus: dto.courierStatus ?? null,
        exchangeOrderId: dto.exchangeOrderId ?? null,
      },
    });

    if (adjustment) {
      await db.order.update({
        where: { id: dto.orderId },
        data: {
          shippingCharge: adjustment.newShipping,
          discount: adjustment.newDiscount,
          total: adjustment.newTotal,
        },
      });
    }
    if (decision?.statusId) {
      await db.order.update({
        where: { id: dto.orderId },
        data: { statusId: decision.statusId },
      });
    }
    const timelineEntries = [
      ...(adjustment?.entries ?? []),
      ...(decision ? [decision.entry] : []),
    ];
    if (timelineEntries.length) {
      await appendOrderTimeline(db, dto.orderId, timelineEntries);
    }

    this.logger.log(
      `Return ${displayId} created for order ${(order as any).displayId ?? dto.orderId} ` +
        `(type=${dto.type} source=${source}${performedBy ? ` by=${performedBy}` : ''}` +
        `${hasAdjustments ? ` shippingAdj=${signed(shippingAdjustment)} discountAdj=${signed(discountAdjustment)}` : ''}` +
        `${decision ? ` markDelivered=${dto.markOriginalDelivered ?? true}` : ''})`,
    );
    return ret;
  }

  /**
   * Owner-locked mark-original-delivered semantics (partial returns only):
   * default TRUE → the original order is set to the existing Delivered
   * status; FALSE → the order status is left untouched and evolves solely
   * from courier webhooks per the existing mapping (no parallel
   * interpretation logic here). Both branches leave a timeline entry naming
   * the decision, actor and RTN id. Explicitly sending the flag on a non-
   * partial return is a hard 400 (mirrors the adjustment fields).
   */
  private async resolveMarkDeliveredDecision(
    db: any,
    order: any,
    dto: CreateReturnInput,
    displayId: string,
    performedBy: string | undefined,
  ): Promise<{ entry: unknown; statusId?: string } | null> {
    if (dto.markOriginalDelivered !== undefined && dto.type !== 'PARTIAL') {
      throw new BadRequestException(
        'Marking the original order as delivered is only supported on partial returns.',
      );
    }
    if (dto.type !== 'PARTIAL') return null;

    const markDelivered = dto.markOriginalDelivered ?? true;
    const by = performedBy ?? 'staff';
    const timestamp = new Date().toISOString();

    if (!markDelivered) {
      return {
        entry: {
          type: 'status',
          visibility: 'public',
          timestamp,
          note: `Order left for courier status updates on partial return ${displayId} by ${by}`,
          performedBy: by,
        },
      };
    }

    const delivered = await db.orderStatus.findUnique({ where: { name: 'Delivered' } });
    if (!delivered) {
      throw new BadRequestException('Order status configuration is incomplete');
    }
    const currentStatusId = order.statusId ?? order.status?.id;
    return {
      entry: {
        type: 'status',
        visibility: 'public',
        timestamp,
        oldValue: order.status?.name ?? null,
        newValue: 'Delivered',
        note: `Original order marked Delivered on partial return ${displayId} by ${by}`,
        performedBy: by,
      },
      ...(currentStatusId !== delivered.id ? { statusId: delivered.id } : {}),
    };
  }

  /**
   * Owner-locked signed per-field semantics: each adjustment is ADDED to the
   * original order's stored field value (positive = bill up on that field,
   * negative = bill down). The discount field is the STORED value — for
   * percentage-type orders it is percent points and the effective discount
   * is subtotal × value/100. Rejections are hard 400s; the recomputed total
   * must never go negative (no silent clamping).
   */
  private resolvePartialAdjustments(
    order: any,
    dto: CreateReturnInput,
    displayId: string,
    performedBy: string | undefined,
    shippingAdjustment: number,
    discountAdjustment: number,
  ) {
    if (dto.type !== 'PARTIAL') {
      throw new BadRequestException(
        'Billing adjustments are only supported on partial returns.',
      );
    }
    const shipping = Number(order.shippingCharge ?? 0);
    const discount = Number(order.discount ?? 0);
    const subtotal = Number(order.subtotal ?? 0);
    const discountType = order.discountType === 'percentage' ? 'percentage' : 'flat';

    const newShipping = round2(shipping + shippingAdjustment);
    const newDiscount = round2(discount + discountAdjustment);
    if (newShipping < 0) {
      throw new BadRequestException(
        `Shipping charge cannot go below 0 — currently ${money(shipping)}, adjustment ${signed(shippingAdjustment)} leaves ${money(newShipping)}.`,
      );
    }
    if (newDiscount < 0) {
      throw new BadRequestException(
        `Discount cannot go below 0 — currently ${money(discount)}, adjustment ${signed(discountAdjustment)} leaves ${money(newDiscount)}.`,
      );
    }
    const effectiveDiscount =
      discountType === 'percentage' ? (subtotal * newDiscount) / 100 : newDiscount;
    const rawTotal = subtotal + newShipping - effectiveDiscount;
    if (rawTotal < 0) {
      throw new BadRequestException(
        `Order total cannot go negative — subtotal ${money(subtotal)} + shipping ${money(newShipping)} − discount ${money(effectiveDiscount)} = ${money(rawTotal)}. Reduce the adjustments and try again.`,
      );
    }
    const newTotal = round2(rawTotal);

    const by = performedBy ?? 'staff';
    const timestamp = new Date().toISOString();
    const entries: unknown[] = [];
    if (shippingAdjustment !== 0) {
      entries.push({
        type: 'shipping',
        visibility: 'public',
        timestamp,
        oldValue: shipping,
        newValue: newShipping,
        note: `Shipping charge ${signed(shippingAdjustment)} by ${by} during partial return ${displayId}`,
        performedBy: by,
      });
    }
    if (discountAdjustment !== 0) {
      entries.push({
        type: 'discount',
        visibility: 'public',
        timestamp,
        oldValue: discount,
        newValue: newDiscount,
        ...(discountType === 'percentage' ? { discountType } : {}),
        note: `Discount ${signed(discountAdjustment)} by ${by} during partial return ${displayId}`,
        performedBy: by,
      });
    }
    return { newShipping, newDiscount, newTotal, entries };
  }

  // -------------------------------------------------------------------- read

  async get(id: string) {
    const ret = await this.prisma.return.findUnique({
      where: { id },
      // Deep include (return detail page): the original order carries the
      // customer snapshot AND line-item snapshots (name/sku/images/price +
      // variant attributes) in the SAME query — the UI joins Return.items
      // (returned quantities) against these without extra requests.
      include: {
        order: {
          select: {
            id: true,
            displayId: true,
            kind: true,
            createdAt: true,
            customerFirstName: true,
            customerLastName: true,
            guestName: true,
            customerPhone: true,
            guestPhone: true,
            secondaryPhone: true,
            customer: { select: { id: true, name: true, email: true, phone: true } },
            items: {
              select: {
                productId: true,
                variantId: true,
                quantity: true,
                price: true,
                product: { select: { id: true, name: true, sku: true, images: true } },
                variant: {
                  select: {
                    id: true,
                    sku: true,
                    image: true,
                    images: true,
                    attributeValues: {
                      select: {
                        attributeValue: {
                          select: {
                            value: true,
                            hexCode: true,
                            attribute: { select: { name: true } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!ret) throw new NotFoundException(`Return not found: ${id}`);
    // Task 7: detail links without extra round-trips — exchange order +
    // refund rows are plain ids (no FK), so resolve them best-effort.
    let exchangeOrder: { id: string; displayId: string } | null = null;
    const exchangeOrderId = (ret as any).exchangeOrderId as string | null;
    if (exchangeOrderId) {
      const ex = await this.prisma.order.findUnique({
        where: { id: exchangeOrderId },
        select: { id: true, displayId: true },
      });
      if (ex) exchangeOrder = ex as { id: string; displayId: string };
    }
    let refund: unknown = null;
    const refundId = (ret as any).refundId as string | null;
    if (refundId) {
      const rf = await this.prisma.refund.findUnique({ where: { id: refundId } });
      if (rf) refund = rf;
    }
    return { ...ret, exchangeOrder, refund };
  }

  async list(filters: {
    orderId?: string;
    status?: string;
    type?: string;
    source?: string;
    courier?: string;
    dateFrom?: string;
    dateTo?: string;
    exchangeOrderId?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
    const where: Record<string, unknown> = {};
    if (filters.orderId) where.orderId = filters.orderId;
    if (filters.status) where.status = filters.status as any;
    if (filters.type) where.type = filters.type as any;
    if (filters.source) where.source = filters.source as any;
    // Task 7: Returns list filters — courier + created-date range +
    // exchange-order link (Exchanges detail back-link).
    if (filters.courier) where.courier = filters.courier;
    if (filters.exchangeOrderId) where.exchangeOrderId = filters.exchangeOrderId;
    if (filters.dateFrom || filters.dateTo) {
      const createdAt: Record<string, Date> = {};
      if (filters.dateFrom) createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) createdAt.lte = new Date(filters.dateTo);
      where.createdAt = createdAt;
    }
    if (filters.search) where.displayId = { contains: filters.search, mode: 'insensitive' };

    const [data, total] = await Promise.all([
      this.prisma.return.findMany({
        where: where as any,
        include: { order: { select: { id: true, displayId: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.return.count({ where: where as any }),
    ]);
    return { data, meta: { total, page, limit } };
  }

  // ------------------------------------------------------------ markReceived

  /**
   * Staff-confirmed path: REQUESTED/IN_TRANSIT → RECEIVED → item-level restore
   * → RESTOCKED (+ stockReconciled guard in the same transaction) → dispatch
   * status (FULL → RETURNED, PARTIAL → PARTIAL, EXCHANGE → untouched). The
   * ORDER is never touched here (it stays Return Pending / Partial — staff
   * confirm the order outcome separately on the order detail page).
   *
   * Idempotent: an already-RESTOCKED row returns as-is (never restores twice).
   */
  async markReceived(id: string, opts?: { items?: ReturnItemInput[]; performedBy?: string }) {
    const ret = await this.load(id);
    const restocked = await this.restockReturn(id, {
      items: opts?.items,
      performedBy: opts?.performedBy,
      current: ret,
    });

    // Dispatch follows the Return type — the order stays as-is. (Type comes
    // from the loaded row: the tx client returns only the written fields.)
    const returnType = ((restocked as any).type ?? (ret as any).type) as string;
    const courier = ((restocked as any).courier ?? (ret as any).courier) as string | null;
    const orderId = ((restocked as any).orderId ?? (ret as any).orderId) as string;
    if (returnType === 'FULL') {
      await this.prisma.dispatch.updateMany({
        where: { orderId, ...(courier ? { courier: courier as any } : {}) },
        data: { status: 'RETURNED' as any },
      });
    } else if (returnType === 'PARTIAL') {
      await this.prisma.dispatch.updateMany({
        where: { orderId, ...(courier ? { courier: courier as any } : {}) },
        data: { status: 'PARTIAL' as any },
      });
    }
    return restocked;
  }

  /**
   * RECEIVED → item-level restore → RESTOCKED. Shared by the staff
   * mark-received path and the reconcile auto-path (full returns only — the
   * reconcile never calls this for partials: the courier never reports the
   * split, so the kept part must NOT restock until staff confirm quantities).
   *
   * Hardening (2): the movement itself runs through restoreStockForReturnTx —
   * the single guarded stock core (flag + status set in the SAME transaction
   * as the movement; double calls are no-ops).
   */
  async restockReturn(
    id: string,
    opts?: { items?: ReturnItemInput[]; performedBy?: string; current?: any },
  ) {
    const ret = opts?.current ?? (await this.load(id));
    if ((ret as any).status === 'CLOSED') {
      throw new BadRequestException('Return is CLOSED — cannot restock');
    }
    if ((ret as any).stockReconciled || (ret as any).status === 'RESTOCKED') {
      return ret;
    }
    const effectiveItems = this.validateItems(
      opts?.items ?? (Array.isArray((ret as any).items) ? (ret as any).items : []),
    );
    if (effectiveItems.length === 0) {
      throw new BadRequestException(
        'Return item quantities are unknown — provide items (the courier never reports the split)',
      );
    }

    const performedBy = opts?.performedBy;
    const finalRow = await this.prisma.$transaction(async (tx) =>
      restoreStockForReturnTx(
        { db: tx, cancelReturnStock: this.cancelReturnStock },
        id,
        { items: effectiveItems, performedBy },
      ),
    );
    this.logger.log(
      `Return ${(ret as any).displayId ?? id} RESTOCKED — ` +
        `${effectiveItems.length} item line(s) restored` +
        `${performedBy ? ` by=${performedBy}` : ''}`,
    );
    return finalRow;
  }

  /**
   * Hardening (2) STOCK AUTHORITY funnel: every restore caller that does not
   * already hold the row's items goes through here — mark-received (via
   * restockReturn), courier reconcile (via restockReturn), scan receive and
   * manual order-Returned all converge on restoreStockForReturnTx. The ORDER
   * is never touched here (status-only downstream).
   */
  async restoreStockForReturn(
    returnId: string,
    opts?: { items?: ReturnItemInput[]; performedBy?: string },
  ) {
    const ret = await this.load(returnId);
    return this.restockReturn(returnId, {
      ...(opts?.items ? { items: opts.items } : {}),
      ...(opts?.performedBy ? { performedBy: opts.performedBy } : {}),
      current: ret,
    });
  }

  /**
   * Damaged AFTER receive: append a `later` damage event and write the units
   * off sellable stock. The whole operation is one transaction; insufficient
   * stock fails with a clear message and nothing is written.
   */
  async markDamaged(
    id: string,
    items: Array<{ productId: string; variantId?: string | null; quantity: number }>,
    performedBy?: string,
  ) {
    const ret = await this.load(id);
    if ((ret as any).status === 'CLOSED') {
      throw new BadRequestException('Return is CLOSED — damage cannot be recorded.');
    }
    if (!(ret as any).stockReconciled && (ret as any).status !== 'RESTOCKED') {
      throw new BadRequestException(
        'Receive this return before marking any received unit damaged.',
      );
    }
    const requested = Array.isArray(items) ? items : [];
    if (requested.length === 0) {
      throw new BadRequestException('Select at least one received unit to mark damaged.');
    }

    const now = new Date();
    const rows: ReturnItemInput[] = (
      Array.isArray((ret as any).items) ? (ret as any).items : []
    ).map((it: any) => ({
      productId: String(it.productId),
      variantId: it.variantId ?? null,
      quantity: Number(it.quantity) || 0,
      damagedQuantity: Number(it.damagedQuantity) || 0,
      ...(Array.isArray(it.damageLog) ? { damageLog: it.damageLog } : {}),
      ...(it.warehouseId ? { warehouseId: String(it.warehouseId) } : {}),
    }));
    const keyOf = (productId: string, variantId?: string | null) =>
      `${productId}::${variantId ?? ''}`;
    const touched: Array<{ productId: string; variantId: string | null; quantity: number; warehouseId: string | null }> = [];

    return this.prisma.$transaction(async (tx) => {
      for (const req of requested) {
        const qty = Math.floor(Number(req.quantity) || 0);
        const key = keyOf(req.productId, req.variantId ?? null);
        const row = rows.find(
          (r) => keyOf(r.productId, r.variantId ?? null) === key,
        );
        if (!row) {
          throw new BadRequestException(
            `Product ${req.productId} is not part of this return.`,
          );
        }
        const remaining =
          Number(row.quantity) - Number(row.damagedQuantity ?? 0);
        if (qty <= 0 || qty > remaining) {
          throw new BadRequestException(
            `Cannot mark ${qty} damaged — only ${Math.max(0, remaining)} good unit(s) remain on this line.`,
          );
        }
        const result = await this.cancelReturnStock.damageWriteOff({
          productId: req.productId,
          variantId: req.variantId ?? null,
          quantity: qty,
          warehouseId: (row as any).warehouseId ?? null,
          reference: `damage-${(ret as any).displayId ?? id}`,
          performedBy,
          tx,
        });
        row.damagedQuantity = Number(row.damagedQuantity ?? 0) + qty;
        row.damageLog = [
          ...(row.damageLog ?? []),
          {
            qty,
            at: now.toISOString(),
            phase: 'later',
            by: performedBy ?? null,
          },
        ];
        touched.push({
          productId: req.productId,
          variantId: req.variantId ?? null,
          quantity: qty,
          warehouseId: result.warehouseId,
        });
      }

      const updated = await tx.return.update({
        where: { id },
        data: { items: rows as unknown as any },
      });

      const order = await tx.order.findUnique({
        where: { id: (ret as any).orderId },
        select: { status: { select: { name: true } } },
      });
      const statusName = (order as any)?.status?.name ?? 'Unknown';
      await appendOrderTimeline(tx, (ret as any).orderId, [
        {
          status: statusName,
          oldStatus: statusName,
          timestamp: now.toISOString(),
          note:
            `Marked ${touched.reduce((s, t) => s + t.quantity, 0)} unit(s) damaged ` +
            `from return ${(ret as any).displayId ?? id}; sellable stock written off.`,
          performedBy,
        },
      ]);
      return updated;
    });
  }

  // ------------------------------------------------------------- transitions

  /** REQUESTED → IN_TRANSIT (courier in-progress signal). Never regresses. */
  async setReturnTransit(id: string, courierStatus?: string | null) {
    const ret = await this.load(id);
    if ((ret as any).status === 'REQUESTED') {
      return this.prisma.return.update({
        where: { id },
        data: { status: 'IN_TRANSIT' as any, courierStatus: courierStatus ?? (ret as any).courierStatus },
      });
    }
    if (courierStatus && courierStatus !== (ret as any).courierStatus) {
      return this.prisma.return.update({ where: { id }, data: { courierStatus } });
    }
    return ret;
  }

  /** → RECEIVED (parcel back). Never regresses RESTOCKED/CLOSED. */
  async setReturnReceived(id: string, courierStatus?: string | null) {
    const ret = await this.load(id);
    const status = (ret as any).status as string;
    if (status === 'RESTOCKED' || status === 'CLOSED') {
      if (courierStatus && courierStatus !== (ret as any).courierStatus) {
        return this.prisma.return.update({ where: { id }, data: { courierStatus } });
      }
      return ret;
    }
    return this.prisma.return.update({
      where: { id },
      data: {
        status: 'RECEIVED' as any,
        courierStatus: courierStatus ?? (ret as any).courierStatus,
        receivedAt: (ret as any).receivedAt ?? new Date(),
      },
    });
  }

  async linkRefund(id: string, dto: { refundId: string }) {
    await this.load(id);
    const refund = await this.prisma.refund.findUnique({ where: { id: dto.refundId } });
    if (!refund) throw new NotFoundException(`Refund not found: ${dto.refundId}`);
    return this.prisma.return.update({ where: { id }, data: { refundId: dto.refundId } });
  }

  async close(id: string) {
    const ret = await this.load(id);
    if ((ret as any).status === 'CLOSED') {
      throw new BadRequestException('Return is already CLOSED');
    }
    return this.prisma.return.update({ where: { id }, data: { status: 'CLOSED' as any } });
  }

  // ---------------------------------------------------------- courier upsert

  /**
   * First courier signal for (order, courier) → create a COURIER Return
   * (status REQUESTED, empty items — the split is unknown). Later signals →
   * update courierStatus only; courierReturnId is set-once, never clobbered.
   *
   * Hardening (1): deliberately skips assertReturnEligible —
   * COURIER_GUARD_SKIP_REASON (see return-guard.ts). Abuse is impossible
   * downstream: stock moves only via restoreStockForReturnTx (flag-guarded,
   * item-scoped), and a repeat signal re-resolves to this same row.
   */
  async upsertCourierReturn(input: UpsertCourierReturnInput) {
    void COURIER_GUARD_SKIP_REASON;
    const order = await this.prisma.order.findUnique({ where: { id: input.orderId } });
    if (!order || (order as any).trashedAt) {
      throw new NotFoundException(`Order not found: ${input.orderId}`);
    }
    const existing = await this.prisma.return.findFirst({
      where: { orderId: input.orderId, courier: input.courier, status: { not: 'CLOSED' as any } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      const data: Record<string, unknown> = {};
      if (input.courierStatus && input.courierStatus !== (existing as any).courierStatus) {
        data.courierStatus = input.courierStatus;
      }
      if (!(existing as any).courierReturnId && input.courierReturnId) {
        data.courierReturnId = input.courierReturnId;
      }
      if (input.reason !== undefined && input.reason !== (existing as any).reason) {
        data.reason = input.reason;
      }
      if (Object.keys(data).length === 0) return existing;
      return this.prisma.return.update({ where: { id: (existing as any).id }, data: data as any });
    }
    const displayId = await this.generateDisplayId();
    return this.prisma.return.create({
      data: {
        orderId: input.orderId,
        displayId,
        type: (input.type ?? 'FULL') as any,
        status: 'REQUESTED' as any,
        source: 'COURIER' as any,
        items: [] as unknown as Prisma.InputJsonValue,
        courier: input.courier,
        courierReturnId: input.courierReturnId ?? null,
        courierStatus: input.courierStatus ?? null,
        reason: input.reason ?? null,
      },
    });
  }

  /**
   * Full-order item snapshot for reconcile auto-restock (FULL returns only):
   * standalone lines as-is; combo lines expanded to their component products.
   */
  async orderItemsSnapshot(orderId: string): Promise<ReturnItemInput[]> {
    return orderItemsSnapshotForClient(this.prisma, orderId);
  }

  // ------------------------------------------------------------------ helpers

  /**
   * Public shape-check shared by the PARTIAL exchange path (Task 4 Fix 8):
   * productId required, quantity a positive integer, no duplicate lines.
   */
  validateItemsInput(items: unknown): ReturnItemInput[] {
    return this.validateItems(items);
  }

  /**
   * T6 partial restore-or-hold (owner-locked): find the newest OPEN
   * staff-created Return carrying non-empty items for the order.
   *
   * OPEN = status not CLOSED and not RESTOCKED (REQUESTED / IN_TRANSIT /
   * RECEIVED — still awaiting its stock movement). Courier-sourced rows are
   * skipped (their split is unknown by construction). Returns null when no
   * staff Return carries quantities — the reconcile then HOLDs and staff
   * confirm exact quantities at mark-received (which restores later).
   */
  async findOpenStaffReturnWithItems(orderId: string) {
    const candidates = await this.prisma.return.findMany({
      where: { orderId, source: 'STAFF' as any, status: { not: 'CLOSED' as any } },
      orderBy: { createdAt: 'desc' },
    });
    for (const row of (candidates as any[]) ?? []) {
      const status = (row as any)?.status as string;
      if (status === 'CLOSED' || status === 'RESTOCKED') continue;
      const items = (row as any)?.items;
      if (Array.isArray(items) && items.length > 0) return row;
    }
    return null;
  }

  private async load(id: string) {
    const ret = await this.prisma.return.findUnique({ where: { id } });
    if (!ret) throw new NotFoundException(`Return not found: ${id}`);
    return ret;
  }

  private validateItems(items: unknown): ReturnItemInput[] {
    return validateReturnItemsShape(items);
  }

  /**
   * RTN-YYMMDD-NNNN — mirrors OrdersService.generateDisplayId (own
   * ReturnCounter so order numbering never shifts).
   */
  private async generateDisplayId(): Promise<string> {
    return this.prisma.$transaction(async (tx) => generateReturnDisplayId(tx));
  }

  /**
   * Same RTN sequence inside a caller's transaction (single upsert is
   * atomic — no nested $transaction, which interactive tx clients forbid).
   */
  private async generateDisplayIdInTx(tx: Prisma.TransactionClient): Promise<string> {
    return generateReturnDisplayId(tx);
  }
}
