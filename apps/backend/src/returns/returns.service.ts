import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';
import { dhakaDateParts } from '../common/utils/dhaka-time';

export interface ReturnItemInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
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

  async create(dto: CreateReturnInput, performedBy?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: dto.orderId } });
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

    const displayId = await this.generateDisplayId();
    const ret = await this.prisma.return.create({
      data: {
        orderId: dto.orderId,
        displayId,
        type: dto.type as any,
        status: 'REQUESTED' as any,
        source: source as any,
        items: items as unknown as Prisma.InputJsonValue,
        reason: dto.reason ?? null,
        courier: dto.courier ?? null,
        courierReturnId: dto.courierReturnId ?? null,
        courierStatus: dto.courierStatus ?? null,
        exchangeOrderId: dto.exchangeOrderId ?? null,
      },
    });
    this.logger.log(
      `Return ${displayId} created for order ${(order as any).displayId ?? dto.orderId} ` +
        `(type=${dto.type} source=${source}${performedBy ? ` by=${performedBy}` : ''})`,
    );
    return ret;
  }

  // -------------------------------------------------------------------- read

  async get(id: string) {
    const ret = await this.prisma.return.findUnique({
      where: { id },
      include: { order: { select: { id: true, displayId: true } } },
    });
    if (!ret) throw new NotFoundException(`Return not found: ${id}`);
    return ret;
  }

  async list(filters: {
    orderId?: string;
    status?: string;
    type?: string;
    source?: string;
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
    if (filters.search) where.displayId = { contains: filters.search, mode: 'insensitive' };

    const [data, total] = await Promise.all([
      this.prisma.return.findMany({
        where: where as any,
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
    const orderId = (ret as any).orderId as string;
    const finalRow = await this.prisma.$transaction(async (tx) => {
      if ((ret as any).status !== 'RECEIVED') {
        await tx.return.update({ where: { id }, data: { status: 'RECEIVED' as any } });
      }
      await this.cancelReturnStock.restoreForReturnItems({
        orderId,
        items: effectiveItems,
        returnId: id,
        performedBy,
        tx: tx as Prisma.TransactionClient,
      });
      return tx.return.update({
        where: { id },
        data: {
          status: 'RESTOCKED' as any,
          items: effectiveItems as unknown as Prisma.InputJsonValue,
          stockReconciled: true,
          stockReconciledAt: new Date(),
        },
      });
    });
    this.logger.log(
      `Return ${(ret as any).displayId ?? id} RESTOCKED — ` +
        `${effectiveItems.length} item line(s) restored` +
        `${performedBy ? ` by=${performedBy}` : ''}`,
    );
    return finalRow;
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
      data: { status: 'RECEIVED' as any, courierStatus: courierStatus ?? (ret as any).courierStatus },
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
   */
  async upsertCourierReturn(input: UpsertCourierReturnInput) {
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
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          select: { id: true, productId: true, variantId: true, quantity: true, comboId: true },
        },
      },
    });
    if (!order) throw new NotFoundException(`Order not found: ${orderId}`);
    const out: ReturnItemInput[] = [];
    for (const item of (order as any).items ?? []) {
      if (!item.comboId && item.productId) {
        out.push({ productId: item.productId, variantId: item.variantId ?? null, quantity: item.quantity });
        continue;
      }
      if (item.comboId) {
        const snaps = await this.prisma.orderItemComboComponent.findMany({
          where: { orderItemId: item.id },
          select: { productId: true, variantId: true, totalQuantity: true },
        });
        for (const s of snaps as any[]) {
          out.push({ productId: s.productId, variantId: s.variantId ?? null, quantity: s.totalQuantity });
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ helpers

  private async load(id: string) {
    const ret = await this.prisma.return.findUnique({ where: { id } });
    if (!ret) throw new NotFoundException(`Return not found: ${id}`);
    return ret;
  }

  private validateItems(items: unknown): ReturnItemInput[] {
    if (!Array.isArray(items)) throw new BadRequestException('Return items must be an array');
    const seen = new Set<string>();
    return (items as ReturnItemInput[]).map((it, i) => {
      const productId = String((it as any)?.productId ?? '').trim();
      const variantId = (it as any)?.variantId ? String((it as any).variantId) : null;
      const quantity = Number((it as any)?.quantity);
      if (!productId) throw new BadRequestException(`Return items[${i}].productId is required`);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new BadRequestException(`Return items[${i}].quantity must be a positive integer`);
      }
      const key = `${productId}::${variantId ?? ''}`;
      if (seen.has(key)) throw new BadRequestException(`Duplicate return line: ${productId}`);
      seen.add(key);
      return { productId, variantId, quantity };
    });
  }

  /**
   * RTN-YYMMDD-NNNN — mirrors OrdersService.generateDisplayId (own
   * ReturnCounter so order numbering never shifts).
   */
  private async generateDisplayId(): Promise<string> {
    const { year, month, day } = dhakaDateParts();
    const yy = String(year).slice(2);
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const dateStr = `${yy}${mm}${dd}`;
    const prefix = `RTN-${dateStr}`;

    return this.prisma.$transaction(async (tx) => {
      const counter = await tx.returnCounter.upsert({
        where: { date: dateStr },
        create: { date: dateStr, seq: 1 },
        update: { seq: { increment: 1 } },
      });
      return `${prefix}-${String(counter.seq).padStart(4, '0')}`;
    });
  }
}
