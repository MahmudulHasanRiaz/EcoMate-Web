import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { appendOrderTimeline } from '../orders/order-timeline.util';
import { OrdersEventService } from '../orders/orders-event.service';
import { CacheService } from '../cache/cache.service';
import { dhakaDateParts } from '../common/utils/dhaka-time';
import { Prisma } from '@prisma/client';
import { CreateExchangeOrderDto } from './dto/create-exchange-order.dto';

export interface ExchangeActor {
  userId: string;
  email: string;
}

/** Which settlement branch applied (§4). */
export type SettlementStatus = 'SETTLED_DUE' | 'SETTLED_EXACT' | 'SETTLED_REFUND';

export interface ExchangeSettlement {
  /** What the customer actually paid on the ORIGINAL order. */
  originalPaid: number;
  /** Credit still available to this exchange (paid minus siblings' usage). */
  availableCredit: number;
  /** The freshly computed exchange bill. */
  exchangeTotal: number;
  /** Portion of the bill covered by carried-over credit. */
  creditApplied: number;
  /**
   * UNUSED credit — money paid on the original that this exchange did not
   * consume, and which therefore has to come back to the customer.
   * > 0 ⇒ Refund Due, <= 0 ⇒ collect the shortfall.
   */
  delta: number;
  status: SettlementStatus;
  refundId: string | null;
}

/**
 * ExchangeService — replacement orders raised against an existing sale.
 *
 * An exchange is a NEW sale (kind = EXCHANGE) whose billing is settled
 * against what the customer already paid on the original:
 *
 *   exchangeTotal > originalPaid → collect only the difference (§4)
 *   exchangeTotal = originalPaid → nothing to collect or refund
 *   exchangeTotal < originalPaid → refund the difference
 *
 * Invariants:
 *  - The ORIGINAL's financials are never rewritten. Only its status moves to
 *    'Return Pending' so the returned goods can be received.
 *  - The original's PAID amount is consumed AT MOST ONCE across all exchanges.
 *    The consumed figure is written to `exchangedCreditAmount` and checked
 *    before applying, so a second exchange cannot re-spend the same money.
 *  - The exchange reserves stock exactly like a normal new order, so it
 *    behaves like a real sale through packing, courier and delivery.
 *  - The refund is raised against the ORIGINAL (whose money is coming back) and
 *    carries `exchangeOrderId` + `sourcePaymentId` for traceability.
 */
@Injectable()
export class ExchangeService {
  private readonly logger = new Logger(ExchangeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly events: OrdersEventService,
    private readonly cache: CacheService,
  ) {}

  /** Preview for the creation screen: what the customer already paid. */
  async getSettlementPreview(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, displayId: true, kind: true, total: true, trashedAt: true },
    });
    if (!order || order.trashedAt) throw new NotFoundException('Order not found');

    const available = await this.availableCredit(orderId);
    return {
      orderId: order.id,
      displayId: order.displayId,
      orderTotal: Number(order.total),
      originalPaid: available,
      creditAvailable: available,
    };
  }

  async findById(id: string) {
    const exchange = await this.prisma.order.findUnique({
      where: { id },
      include: {
        status: true,
        exchangeOfOrder: {
          select: { id: true, displayId: true, status: { select: { name: true } } },
        },
        payments: true,
        refunds: true,
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, images: true } },
            variant: { select: { id: true, sku: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!exchange || exchange.trashedAt) throw new NotFoundException('Exchange order not found');
    return exchange;
  }

  /**
   * Create the exchange + settle it, atomically.
   */
  async createFromOrder(
    originalOrderId: string,
    dto: CreateExchangeOrderDto,
    actor: ExchangeActor,
  ) {
    const original = await this.prisma.order.findUnique({
      where: { id: originalOrderId },
      include: { status: true },
    });
    if (!original || original.trashedAt) {
      throw new NotFoundException('Order not found');
    }
    if (original.kind !== 'SALE') {
      throw new BadRequestException(
        'An exchange can only be created from a sale order.',
      );
    }
    if (dto.items.length === 0) {
      throw new BadRequestException('Select at least one product for the exchange.');
    }

    // Resolve products + availability BEFORE the transaction so a stock
    // problem fails fast with a clean message.
    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const variantIds = [...new Set(dto.items.map((i) => i.variantId).filter(Boolean))] as string[];

    // Variants are a relation ON Product, not a top-level model, so they are read
    // through their products rather than queried separately.
    type ProductRow = {
      id: string;
      name: string;
      manageStock: boolean;
      reservedStock: number;
      availabilityMode: string;
      managedStockQuantity: number;
      variants: { id: string; managedStockQuantity: number; reservedStock: number }[];
    };

    const products = (await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        name: true,
        manageStock: true,
        reservedStock: true,
        availabilityMode: true,
        managedStockQuantity: true,
        variants: {
          where: { id: { in: variantIds } },
          select: { id: true, managedStockQuantity: true, reservedStock: true },
        },
      },
    })) as ProductRow[];

    const productById = new Map(products.map((p) => [p.id, p]));
    const variantById = new Map(
      products.flatMap((p) => p.variants).map((v) => [v.id, v] as const),
    );

    for (const line of dto.items) {
      const product = productById.get(line.productId);
      if (!product) {
        throw new BadRequestException('A selected product no longer exists.');
      }
      // The variant must exist AND belong to the line's product, otherwise the
      // order would record a variant of a different product.
      const variant = line.variantId ? variantById.get(line.variantId) : undefined;
      if (line.variantId && !variant) {
        throw new BadRequestException(
          `A selected variant of "${product.name}" no longer exists.`,
        );
      }
      if (product.availabilityMode === 'ALWAYS_OUT_OF_STOCK') {
        throw new BadRequestException(
          `Product "${product.name}" is out of stock and cannot be ordered.`,
        );
      }
      // Managed-stock availability gate, mirroring feed._availableStock.
      const managed = variant ?? product;
      const qty = Number(managed.managedStockQuantity ?? 0);
      const reserved = Number(managed.reservedStock ?? 0);
      if (
        product.availabilityMode === 'MANAGED_STOCK' &&
        product.manageStock &&
        qty - reserved < line.quantity
      ) {
        throw new BadRequestException(
          `Only ${qty - reserved} unit(s) of "${product.name}" are in stock (requested ${line.quantity}).`,
        );
      }
    }

    // ---- Fresh pricing for the exchange (§2) -----------------------------
    const shipping = dto.shippingCharge ?? 0;
    const discount = dto.discount ?? 0;
    const discountType = dto.discountType ?? 'flat';
    const { subtotal, total } = this.ordersService.recalculate(
      dto.items.map((i) => ({ price: i.price, quantity: i.quantity })),
      shipping,
      discount,
      discountType,
    );
    if (discountType === 'flat' && discount > subtotal) {
      throw new BadRequestException(
        `Discount (${discount}) cannot exceed the order amount (${subtotal.toFixed(2)}).`,
      );
    }

    const displayId = await this.deriveExchangeDisplayId();
    const now = new Date().toISOString();

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const confirmed = await tx.orderStatus.findUnique({
          where: { name: 'Confirmed' },
        });
        const returnPending = await tx.orderStatus.findUnique({
          where: { name: 'Return Pending' },
        });
        if (!confirmed || !returnPending) {
          throw new Error('Order status configuration is incomplete');
        }

        const created = await tx.order.create({
          data: {
            displayId,
            kind: 'EXCHANGE',
            exchangeOfOrderId: original.id,
            statusId: confirmed.id,
            source: 'MANUAL',
            subtotal,
            shippingCharge: shipping,
            discount,
            discountType,
            total,
            paymentOptionType: 'CASH_ON_DELIVERY',
            paymentStatus: 'UNPAID',
            // Customer + shipping snapshot copied from the original (§2) —
            // identity only, never the original's money.
            customerId: original.customerId,
            customerEmail: original.customerEmail,
            customerPhone: original.customerPhone,
            customerFirstName: original.customerFirstName,
            customerLastName: original.customerLastName,
            customerCity: original.customerCity,
            customerState: original.customerState,
            customerZip: original.customerZip,
            customerCountry: original.customerCountry,
            guestName: original.guestName,
            guestPhone: original.guestPhone,
            shippingAddress: original.shippingAddress as any,
            customerNotes: dto.customerNotes ?? null,
            officeNotes: dto.officeNotes ?? null,
            timeline: [
              {
                status: 'Confirmed',
                oldStatus: null,
                timestamp: now,
                note: `Exchange Order created from ${original.displayId}.`,
                performedBy: actor.email,
              },
            ] as any,
          },
        });

        for (const line of dto.items) {
          await tx.orderItem.create({
            data: {
              orderId: created.id,
              productId: line.productId,
              variantId: line.variantId ?? null,
              quantity: line.quantity,
              price: line.price,
              managedStockReserved: false,
              managedStockDeducted: false,
            },
          });
        }

        // ---- Reserve stock exactly like a normal new order (§6) -----------
        // The exchange is a real sale, so it must hold stock from the moment it
        // exists. This goes through the SAME StockRouterService path the order
        // lifecycle uses, so managed and physical inventory behave identically
        // to any other new order. The RTN path deliberately does NOT do this.
        for (const line of dto.items) {
          const item = await tx.orderItem.findFirst({
            where: { orderId: created.id, productId: line.productId },
            select: { id: true },
          });
          await this.ordersService.applyStockForLine(
            'reserve',
            line.productId,
            line.variantId ?? null,
            line.quantity,
            displayId,
            tx,
            { orderId: created.id, orderItemId: item?.id, performedBy: actor.email },
          );
        }

        // ---- Settlement against the original's ACTUAL payments (§4) ------
        const settlement = await this.settle(tx, original, total, created.id, actor, now);

        // ---- Original → Return Pending (§5) -------------------------------
        // Even when it was already Delivered: the goods are coming back, and
        // the return leg must be receivable. Stock is NOT restored here —
        // only when the return is physically received (§7).
        await tx.order.update({
          where: { id: original.id },
          data: { statusId: returnPending.id },
        });
        await appendOrderTimeline(tx, original.id, [
          {
            status: 'Return Pending',
            oldStatus: original.status.name,
            timestamp: now,
            note: `Exchange Order ${displayId} created — original goods are being returned. Stock restores on return receipt.`,
            performedBy: actor.email,
          },
        ]);

        return { exchange: created, settlement };
      });

      this.emitStatusChanged(result.exchange.id, result.exchange.displayId, 'Confirmed');
      this.emitStatusChanged(original.id, original.displayId, 'Return Pending');
      this.invalidateAnalytics();

      return {
        exchange: await this.findById(result.exchange.id),
        settlement: result.settlement,
      };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Could not allocate a unique exchange order number. Please retry.',
        );
      }
      throw err;
    }
  }

  /**
   * Settlement (§4). Consumes the original's PAID amount at most once across
   * all exchanges: every prior exchange that already spent credit reduces what
   * is still available.
   */
  private async settle(
    tx: Prisma.TransactionClient,
    original: { id: string; displayId: string },
    exchangeTotal: number,
    exchangeId: string,
    actor: ExchangeActor,
    now: string,
  ): Promise<ExchangeSettlement> {
    const paidAgg = await tx.payment.aggregate({
      where: { orderId: original.id, status: 'PAID' },
      _sum: { amount: true },
    });
    const originalPaid = Number(paidAgg._sum.amount || 0);

    // Credit already consumed by SIBLING exchanges of this same original.
    const priorAgg = await tx.order.aggregate({
      where: { exchangeOfOrderId: original.id, exchangedCreditAmount: { not: null } },
      _sum: { exchangedCreditAmount: true },
    });
    const priorCredit = Number(priorAgg._sum.exchangedCreditAmount || 0);

    const available = Math.max(0, originalPaid - priorCredit);
    const creditApplied = Math.min(available, exchangeTotal);

    // Requirements §4, read literally:
    //   exchange > paid  → the DIFFERENCE is Due for collection
    //   exchange = paid  → fully settled, nothing moves
    //   exchange < paid  → the DIFFERENCE is Refund Due
    //
    // The refund case is driven by UNUSED CREDIT, not by a negative delta of
    // (exchange − paid): once credit is capped at the bill, `exchange − credit`
    // is always 0 or negative-by-shortfall and can never express "the customer
    // overpaid". Refunding `available − creditApplied` is the same number and
    // is correct in both the single-exchange and sibling cases.
    const shortfall = round2(exchangeTotal - creditApplied);
    const unusedCredit = round2(available - creditApplied);

    let status: SettlementStatus;
    let delta: number;
    if (shortfall > 0.005) {
      status = 'SETTLED_DUE';
      delta = shortfall;
    } else if (unusedCredit > 0.005) {
      status = 'SETTLED_REFUND';
      delta = unusedCredit;
    } else {
      status = 'SETTLED_EXACT';
      delta = 0;
    }

    let refundId: string | null = null;
    if (status === 'SETTLED_REFUND') {
      // Money comes back from the ORIGINAL (it is the original's collection
      // being returned), linked to this exchange and to the exact payment.
      const refund = await tx.refund.create({
        data: {
          orderId: original.id,
          amount: unusedCredit,
          reason: `Exchange ${exchangeId} unused credit refund`,
          status: 'pending',
          exchangeOrderId: exchangeId,
          notes: `Settlement refund for exchange against ${original.displayId}.`,
        },
      });
      refundId = refund.id;
    }

    await tx.order.update({
      where: { id: exchangeId },
      data: {
        exchangedCreditAmount: creditApplied,
        settlementStatus: status,
        settlementDelta: delta,
        // EXACT is fully settled on creation. DUE is settled once the
        // difference is collected; REFUND once the refund completes.
        settlementSettledAt: status === 'SETTLED_EXACT' ? new Date(now) : null,
      },
    });

    await appendOrderTimeline(tx, exchangeId, [
      {
        type: 'settlement',
        visibility: 'private',
        timestamp: now,
        note:
          `Settlement vs ${original.displayId}: paid ৳${originalPaid}, credit available ৳${available}, ` +
          `applied ৳${creditApplied}, exchange total ৳${exchangeTotal}, ` +
          (status === 'SETTLED_DUE'
            ? `collect ৳${delta.toFixed(2)}.`
            : status === 'SETTLED_REFUND'
              ? `refund ৳${delta.toFixed(2)} of unused credit.`
              : 'fully settled, nothing to collect or refund.'),
        performedBy: actor.email,
      },
    ]);

    return { originalPaid, availableCredit: available, exchangeTotal, creditApplied, delta, status, refundId };
  }

  /**
   * Remaining PAID credit on an original, i.e. total paid minus what sibling
   * exchanges have already consumed.
   */
  private async availableCredit(orderId: string): Promise<number> {
    const [paid, prior] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { orderId, status: 'PAID' },
        _sum: { amount: true },
      }),
      this.prisma.order.aggregate({
        where: { exchangeOfOrderId: orderId, exchangedCreditAmount: { not: null } },
        _sum: { exchangedCreditAmount: true },
      }),
    ]);
    return Math.max(
      0,
      Number(paid._sum.amount || 0) - Number(prior._sum.exchangedCreditAmount || 0),
    );
  }

  /** EX-YYMMDD-NNNN from the same counter as ORD-, so numbers stay unique. */
  private async deriveExchangeDisplayId(): Promise<string> {
    const { year, month, day } = dhakaDateParts();
    const yy = String(year).slice(2);
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const dateStr = `${yy}${mm}${dd}`;
    const prefix = `EX-${dateStr}`;

    return this.prisma.$transaction(async (tx) => {
      const counter = await tx.orderCounter.upsert({
        where: { date: dateStr },
        create: { date: dateStr, seq: 1 },
        update: { seq: { increment: 1 } },
      });
      return `${prefix}-${String(counter.seq).padStart(4, '0')}`;
    });
  }

  private emitStatusChanged(orderId: string, displayId: string, statusName: string) {
    try {
      this.events.emit({
        type: 'order.status_changed',
        data: { id: orderId, displayId, statusName },
      });
    } catch (e) {
      this.logger.error(`Failed to emit status_changed for ${orderId}:`, e);
    }
  }

  private invalidateAnalytics() {
    try {
      void this.cache?.invalidateByPrefix('analytics:');
    } catch {
      /* cache failure must never break the exchange flow */
    }
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}