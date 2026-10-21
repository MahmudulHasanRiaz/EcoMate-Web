import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Logger,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { dhakaDateParts } from '../common/utils/dhaka-time';
import { TrackingCaptureService } from '../tracking/tracking-capture.service';
import { TrackingSettingsService } from '../tracking/tracking-settings.service';
import { TrackingContextService } from '../tracking/tracking-context.service';
import { StoredIdentifiers } from '../tracking/context-merge';
import { CustomersService } from '../customers/customers.service';
import { CustomerAddressService } from '../customers/customer-address.service';
import { SalesChannelService } from '../sales-channel/sales-channel.service';
import { OrdersEventService } from './orders-event.service';
import { withTimelineSources } from './timeline-source';
import { resolveEffectivePaymentSettings } from '../payments/payment-settings';
import { buildOrderSearchFilter } from './order-search';
import { orderSnapshotCustomer } from './order-recipient';
import {
  deriveOrderDue,
  type DuePayment,
} from '../common/finance/order-due';
import {
  receivedReturnValue,
  RECEIVED_RETURN_STATUSES,
} from '../common/finance/return-impact';
import { buildOrderAttributionSnapshot } from './order-attribution-snapshot';
import { StockService } from '../stock/stock.service';
import { StockRouterService } from '../stock/stock-router.service';
import { CostingLotService } from '../stock/costing-lot.service';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';
import { OrderStockDeductService } from '../stock/order-stock-deduct.service';
import { CouponsService } from '../coupons/coupons.service';
import {
  CreateOrderDto,
  UpdateOrderStatusDto,
  UpdateOrderDto,
  UpdateOrderItemDto,
  CustomerInfoDto,
} from './dto/order.dto';
import {
  PaymentStatus,
  PaymentOptionType,
  Prisma,
  ManagedStockMovementType,
  MovementDirection,
  ReferenceEntity,
  OrderSource,
} from '@prisma/client';
import { ManagedStockLedgerService } from '../inventory/managed-stock-ledger.service';
import { buildTrackingUrl } from '../courier-manager/courier-webhook.service';
import { normalizePhone } from '../common/utils/phone-utils';
import { resolveDivision } from '../delivery-areas/data/district-division';
import { resolveActionSource } from '../tracking/meta-action-source';
import { resolveWebAttribution } from './web-attribution';
import { BlockedEntriesService } from '../blocked-entries/blocked-entries.service';
import { SecurityService } from '../security/security.service';
import { OrderEditLockService } from './order-edit-lock.service';
import { MarketingAttributionService } from '../marketing/marketing-attribution.service';
import { CommissionsService } from '../commissions/commissions.service';
import { TrackingEligibilityGate } from '../tracking/tracking-eligibility-gate';
import { CacheService } from '../cache/cache.service';
import { OrderStaffPerformanceService } from './order-staff-performance.service';
import { CommissionEngineService } from '../commissions/commission-engine.service';
import { CodMismatchService } from '../cod-mismatch/cod-mismatch.service';
import {
  DispatchCancelService,
  type DispatchCancelPlan,
} from '../dispatch-cancel/dispatch-cancel.service';
import {
  courierLabel,
  evaluateDispatchCancelEligibility,
  isPanelCancelPending,
} from '../dispatch-cancel/dispatch-cancel-eligibility';
import {
  assertNoDuplicateReturn,
  assertReturnEligible,
  generateReturnDisplayId,
  orderItemsSnapshotForClient,
  restoreStockForReturnTx,
} from '../returns/return-guard';

// Order-status transition rules live in one place — the runtime gate and the
// seed share the same map (see order-transitions.ts for the Partial rule).
// Re-exported so existing internal references and tests keep working.
import {
  ORDER_TRANSITIONS,
  ITEM_EDIT_BLOCKED_STATUSES,
} from './order-transitions';
export { ORDER_TRANSITIONS };

/**
 * Task 5 (Fix 9, owner-locked Rule 15): the staff-partial button lives on
 * Shipping AND Partial orders only. Every other status 400s (the menu mirrors
 * this with a disabled reason; the backend enforces it).
 *
 * COHERENT BY DESIGN (review MED status-sets): this flow endpoint allows
 * {Shipping, Partial} while the unified guard (RETURN_ELIGIBLE_STATUSES in
 * returns/return-guard.ts) allows {Shipping, Partial, Delivered}. Delivered
 * partials go via the unified dialog only (POST /returns PARTIAL) — the flow
 * endpoint auto-moves Shipping→Partial / marks instant-delivery, which must
 * never run on an already-Delivered order.
 */
export const STAFF_PARTIAL_ALLOWED_STATUSES: readonly string[] = [
  'Shipping',
  'Partial',
];

/**
 * Order status name → lifecycle custom tracking event. Only genuinely
 * transitioned-into statuses emit; every other status (Hold, Packed,
 * Shipping, Payment *, Partial, Return Pending, Damaged, ...) emits nothing.
 * Meta-only routing is enforced at the adapter boundary, not here.
 */
const ORDER_STATUS_LIFECYCLE_EVENT = {
  Confirmed: { stage: 'confirmed', eventType: 'OrderConfirmed' },
  Cancelled: { stage: 'cancelled', eventType: 'OrderCancelled' },
  Delivered: { stage: 'delivered', eventType: 'OrderDelivered' },
  Returned: { stage: 'returned', eventType: 'OrderReturned' },
} as const;

/**
 * Actors that represent automated processes (courier webhooks, sync jobs)
 * rather than a logged-in staff member. They must never:
 *  - take ownership of an order (auto-assignment),
 *  - mark an order as 'Returned' (manual-confirmation-only, restores stock).
 */
const AUTOMATED_ACTORS = new Set(['system', 'reconcile', 'webhook']);

function isAutomatedActor(actor?: string | null): boolean {
  return !actor || AUTOMATED_ACTORS.has(actor);
}

/**
 * First-mutation ownership: an order may be auto-assigned to the acting staff
 * member ONLY while it is currently unassigned. Once a first assignment exists,
 * it is preserved forever — later manual edits, status changes, webhooks and
 * reconciliation must never overwrite it. Explicit reassignment happens only
 * through bulkAssign / the dedicated assign endpoint.
 */
function shouldAutoAssign(
  actor: string | undefined | null,
  currentAssignedToId: string | null | undefined,
): boolean {
  return !isAutomatedActor(actor) && !currentAssignedToId;
}

/**
 * Analytics cost-capture mapping (P2, §3.2). A provided fulfillment cost is
 * staff-entered ⇒ source defaults to 'manual' (actual); an explicit
 * 'courier_default' is honoured (estimated). Absent input maps to NULL/NULL
 * — never zero-filled, so "not recorded" stays distinguishable. Single home
 * for the defaulting rule used by both create() and updateOrder().
 */
export function resolveShippingCostFields(dto: {
  shippingCost?: number | null;
  shippingCostSource?: string | null;
}): {
  shippingCost: number | null;
  shippingCostSource: string | null;
} {
  if (dto.shippingCost === undefined || dto.shippingCost === null) {
    return { shippingCost: null, shippingCostSource: null };
  }
  return {
    shippingCost: dto.shippingCost,
    shippingCostSource: dto.shippingCostSource ?? 'manual',
  };
}

/** Public display-only tracking item — exported for controller type inference. */
export interface PublicDisplayItem {
  id: string;
  quantity: number;
  price: number;
  product: { name: string; slug: string; images: string[] } | null;
}

/** One public timeline step — status, when it happened, and the customer-facing note. */
export interface PublicTimelineEntry {
  status: string;
  timestamp: string;
  note?: string;
}

/**
 * Public display-only tracking order — no PII.
 *
 * timeline/shipment/shippingAddress are included because the storefront
 * tracking page renders them; without them that page silently showed an empty
 * rail and a permanent "No shipping address available". They are limited to
 * what a status timeline needs: performedBy (a staff email) is never exposed,
 * entries marked `visibility: 'private'` are dropped, and the address is
 * city/district only — no street address and no phone.
 */
export interface PublicDisplayOrder {
  id: string;
  displayId: string;
  createdAt: Date;
  status: { name: string; color?: string } | null;
  items: PublicDisplayItem[];
  total: number;
  trackingUrl: string | null;
  timeline: PublicTimelineEntry[];
  shipment: { courier: string | null; trackingCode: string | null } | null;
  shippingAddress: { city: string | null; district: string | null } | null;
}

/** Guest token-based tracking — minimally richer but still no staff/payment/internal fields. */
export interface PublicTokenOrder extends PublicDisplayOrder {
  customer: { name: string } | null;
  shippingAddress: { city: string; zone: string; district: string } | null;
  timeline: Array<{ status: string; timestamp: string }>;
}

/** Typed Prisma select for public display lookup — fetches no PII. */
const PUBLIC_DISPLAY_SELECT = {
  id: true,
  displayId: true,
  createdAt: true,
  total: true,
  timeline: true,
  // shippingAddress is a scalar String column, not a relation, so it cannot
  // take a nested select. The column is selected whole and only city/district
  // are ever read out of it by toPublicDisplayDto — the street address and
  // phone it also contains never leave the service. This endpoint is reachable
  // by anyone who knows the order number.
  shippingAddress: true,
  courierService: true,
  courierTrackingCode: true,
  courierConsignmentId: true,
  dispatches: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { trackingUrl: true },
  },
  status: { select: { name: true, color: true } },
  items: {
    select: {
      id: true,
      quantity: true,
      price: true,
      product: { select: { name: true, slug: true, images: true } },
    },
  },
} satisfies Prisma.OrderSelect;

/** Typed Prisma select for public token lookup. */
const PUBLIC_TOKEN_SELECT = {
  id: true,
  displayId: true,
  createdAt: true,
  total: true,
  shippingAddress: true,
  timeline: true,
  courierService: true,
  courierTrackingCode: true,
  courierConsignmentId: true,
  dispatches: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { trackingUrl: true },
  },
  status: { select: { name: true, color: true } },
  customer: { select: { name: true } },
  items: {
    select: {
      id: true,
      quantity: true,
      price: true,
      comboId: true,
      productId: true,
      product: {
        select: { name: true, slug: true, images: true, category: { select: { name: true } } },
      },
      combo: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.OrderSelect;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trackingCapture: TrackingCaptureService,
    private readonly trackingSettings: TrackingSettingsService,
    private readonly trackingContext: TrackingContextService,
    private readonly customersService: CustomersService,
    private readonly customerAddressService: CustomerAddressService,
    private readonly salesChannelService: SalesChannelService,
    private readonly events: OrdersEventService,
    private readonly stockService: StockService,
    private readonly stockRouter: StockRouterService,
    private readonly blockedEntries: BlockedEntriesService,
    private readonly security: SecurityService,
    private readonly couponsService: CouponsService,
    private readonly managedStockLedger: ManagedStockLedgerService,
    private readonly costingLotService: CostingLotService,
    private readonly cancelReturnStock: CancelReturnStockService,
    private readonly orderStockDeduct: OrderStockDeductService,
    private readonly editLock: OrderEditLockService,
    private readonly commissionsService: CommissionsService,
    private readonly eligibilityGate: TrackingEligibilityGate,
    @Optional()
    private readonly marketingAttribution?: MarketingAttributionService,
    @Optional()
    private readonly cache?: CacheService,
    @Optional()
    private readonly staffPerformance?: OrderStaffPerformanceService,
    // Commission Engine v2. Optional so existing unit tests that build
    // OrdersService without it keep working; production always wires it.
    @Optional()
    private readonly commissionEngine?: CommissionEngineService,
    // Shared COD alert recompute (Feature A). Optional for the same reason.
    @Optional()
    private readonly codMismatch?: CodMismatchService,
    // Cancel a DISPATCHED order with the dispatch (owner directive
    // 2026-10-21). Optional for the same reason (unit tests build
    // OrdersService without it) — production always wires it: OrdersModule
    // imports DispatchCancelModule, so the dispatch cancel gate is never
    // skipped there.
    @Optional()
    private readonly dispatchCancel?: DispatchCancelService,
  ) {}

  /**
   * Business analytics freshness (P2 §6): cached analytics responses are
   * keyed `analytics:*` with short TTLs; mutating an order / payment / refund
   * drops them eagerly. No-op when no cache is wired (unit tests). Resilient —
   * a cache failure must never break the order mutation.
   */
  private async invalidateAnalytics(): Promise<void> {
    try {
      await this.cache?.invalidateByPrefix('analytics:');
    } catch (err) {
      this.logger.warn(`Analytics cache invalidation failed: ${err}`);
    }
  }

  /**
   * Post-dispatch COD alert refresh (Feature A). Resilient — mirrors
   * invalidateAnalytics: an alert failure must never break the mutation.
   * No-op when the order has no dispatch (recompute skips NULL amounts).
   */
  private async refreshCodAlert(orderId: string): Promise<void> {
    try {
      await this.codMismatch?.recompute(orderId);
    } catch (err) {
      this.logger.warn(`COD alert recompute failed for order ${orderId}: ${err}`);
    }
  }

  /**
   * Apply a stock operation for ONE line, routing through the same
   * StockRouterService the order lifecycle uses.
   *
   * Public because other order-domain services (Exchange) must reserve and
   * release stock with identical semantics — re-deriving the router decision
   * in a second place is exactly how the two paths drift apart.
   */
  async applyStockForLine(
    opType: 'reserve' | 'release' | 'deduct' | 'add',
    productId: string | null | undefined,
    variantId: string | null | undefined,
    quantity: number,
    reference: string,
    tx: Prisma.TransactionClient,
    options?: {
      comboId?: string;
      comboSelection?: any;
      warehouseId?: string;
      orderId?: string;
      orderItemId?: string;
      performedBy?: string;
      ledgerType?: string;
    },
  ) {
    return this.resolveAndApplyStock(
      opType, productId, variantId, quantity, reference, tx, options,
    );
  }

  private async resolveAndApplyStock(
    opType: 'reserve' | 'release' | 'deduct' | 'add',
    productId: string | null | undefined,
    variantId: string | null | undefined,
    quantity: number,
    reference: string,
    tx: Prisma.TransactionClient,
    options?: {
      comboId?: string;
      comboSelection?: any;
      warehouseId?: string;
      orderId?: string;
      orderItemId?: string;
      performedBy?: string;
      ledgerType?: string;
    },
  ) {
    if (!productId) return;
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: {
        availabilityMode: true,
        warehouseId: true,
        syncManagedStock: true,
      },
    });
    const imEnabled = await this.stockRouter.isInventoryManagementEnabled();
    const decision = this.stockRouter.resolve(
      product?.availabilityMode,
      opType,
      imEnabled,
      product?.syncManagedStock ?? undefined,
    );
    let wh = options?.warehouseId || product?.warehouseId;
    if (!wh && decision.pi !== 'skip') {
      const firstStock = await tx.physicalInventory.findFirst({
        where: {
          productId,
          variantId: variantId || null,
        },
        select: { warehouseId: true },
      });
      if (firstStock) wh = firstStock.warehouseId;
    }

    if (decision.ms !== 'skip') {
      const shouldApplyMs =
        !decision.msConditionalOnSync || product?.syncManagedStock;
      if (shouldApplyMs) {
        await this.stockService.operate(decision.ms as any, {
          productId,
          variantId: variantId || undefined,
          comboId: options?.comboId,
          comboSelection: options?.comboSelection,
          quantity,
          reference,
          performedBy: options?.performedBy,
          tx,
          ledgerType: options?.ledgerType,
        });

        if (options?.orderItemId) {
          if (decision.ms === 'reserve') {
            await tx.orderItem.update({
              where: { id: options.orderItemId },
              data: { managedStockReserved: true },
            });
          } else if (decision.ms === 'release' || decision.ms === 'deduct') {
            await tx.orderItem.update({
              where: { id: options.orderItemId },
              data: { managedStockReserved: false },
            });
          } else if (decision.ms === 'add') {
            await tx.orderItem.update({
              where: { id: options.orderItemId },
              data: {
                managedStockReserved: false,
                managedStockDeducted: false,
              },
            });
          }
        }
      }
    }

    if (decision.pi === 'add' && wh) {
      await this.stockService.addPhysical({
        productId,
        variantId: variantId || undefined,
        comboId: options?.comboId,
        comboSelection: options?.comboSelection,
        quantity,
        reference,
        performedBy: options?.performedBy,
        warehouseId: wh,
        tx,
        ledgerType: options?.ledgerType,
      });
    }

    // ── Physical reservation: allocate (reserve at order creation/revision) ──
    if (
      decision.pi === 'allocate' &&
      opType === 'reserve' &&
      options?.orderId &&
      options?.orderItemId
    ) {
      let cycle = await tx.orderStockCycle.findFirst({
        where: { orderId: options.orderId, status: 'ACTIVE' },
      });
      if (!cycle) {
        cycle = await tx.orderStockCycle.create({
          data: { orderId: options.orderId, status: 'ACTIVE' },
        });
      }

      if (!wh) {
        const firstStock = await tx.physicalInventory.findFirst({
          where: { productId, variantId: variantId || null },
          select: { warehouseId: true },
        });
        if (firstStock) wh = firstStock.warehouseId;
      }

      if (wh) {
        const alreadyReserved =
          await this.stockService.hasExistingPhysicalReservation(
            options.orderId,
            options.orderItemId,
            undefined,
            cycle.id,
          );
        if (!alreadyReserved) {
          const existingPi = await tx.physicalInventory.findFirst({
            where: { productId, variantId: variantId || null, warehouseId: wh },
          });
          if (!existingPi) {
            throw new BadRequestException(
              `Insufficient physical stock. No physical inventory record found.`,
            );
          }
          const availablePhysical =
            existingPi.quantity - existingPi.reservedQuantity;
          if (availablePhysical < quantity) {
            throw new BadRequestException(
              `Insufficient physical stock. Available: ${availablePhysical}, needed: ${quantity}.`,
            );
          }
          await this.stockService.reservePhysicalAllocated({
            orderId: options.orderId,
            cycleId: cycle.id,
            orderItemId: options.orderItemId,
            productId: productId,
            variantId: variantId ?? undefined,
            warehouseId: wh,
            quantity,
            tx,
          });
        }
      }
    }

    // ── Physical reservation: release (cancel/edit) ──
    if (
      decision.pi === 'release' &&
      opType === 'release' &&
      options?.orderId &&
      options?.orderItemId
    ) {
      const cycle = await tx.orderStockCycle.findFirst({
        where: { orderId: options.orderId, status: 'ACTIVE' },
      });
      if (cycle) {
        await this.stockService.releasePhysicalAllocated({
          orderId: options.orderId,
          cycleId: cycle.id,
          orderItemId: options.orderItemId,
          tx,
        });
      }
    }

    // ── Physical reservation: fulfill (deduct at dispatch/other) ──
    if (
      decision.pi === 'fulfill' &&
      opType === 'deduct' &&
      options?.orderId &&
      options?.orderItemId
    ) {
      const cycle = await tx.orderStockCycle.findFirst({
        where: { orderId: options.orderId, status: 'ACTIVE' },
      });
      if (cycle) {
        await this.stockService.fulfillPhysicalReservation({
          orderId: options.orderId,
          cycleId: cycle.id,
          orderItemId: options.orderItemId,
          quantity,
          reference,
          performedBy: options?.performedBy,
          tx,
        });
      }
    }
  }

  private parseTimeline(timeline: unknown): any[] {
    return Array.isArray(timeline) ? timeline : [];
  }

  private transformOrder(order: any) {
    if (!order) return order;
    const sa = order.shippingAddress;
    const normalizedAddress =
      sa && typeof sa === 'object'
        ? {
            ...sa,
            address: sa.address || sa.addressLine || '',
            city: sa.city || sa.thana || '',
            zone: sa.zone || sa.district || '',
          }
        : sa;
    // Normalize the edit-lock payload: treat expired locks as absent so the UI
    // never shows a stale holder, and expose holder name without extra queries.
    const rawLock = order.editLock as
      | {
          orderId: string;
          userId: string;
          acquiredAt: Date;
          heartbeatAt: Date;
          expiresAt: Date;
          user?: { firstName: string | null; lastName: string | null } | null;
        }
      | null
      | undefined;
    const editLock =
      rawLock && rawLock.expiresAt && rawLock.expiresAt > new Date()
        ? {
            orderId: rawLock.orderId,
            userId: rawLock.userId,
            userName: rawLock.user
              ? `${rawLock.user.firstName ?? ''} ${rawLock.user.lastName ?? ''}`.trim() ||
                null
              : null,
            acquiredAt: rawLock.acquiredAt,
            expiresAt: rawLock.expiresAt,
          }
        : null;
    // Expose each dispatch's tracking link — prefer the courier-provided URL,
    // fall back to a link built from the dispatch's own identifiers.
    const dispatches = Array.isArray(order.dispatches)
      ? order.dispatches.map((d: any) => ({
          ...d,
          trackingUrl:
            d.trackingUrl ||
            buildTrackingUrl(d.courier, d.trackingCode, d.consignmentId),
          // MANUAL fallback (Steadfast): the panel cancellation stays pending
          // until staff confirm it — the admin shows the marker + one-click
          // confirm on this dispatch.
          panelCancelPending: isPanelCancelPending(d),
          // Cancel-a-dispatched-order eligibility (owner directive,
          // 2026-10-21): the admin's cancel dialog explains the outcome
          // BEFORE the staff confirms. The list view selects a slim dispatch
          // shape (no status) — those rows carry no flag.
          ...(d?.status
            ? {
                cancelEligibility: (() => {
                  const evaluation = evaluateDispatchCancelEligibility({
                    courier: d.courier,
                    status: d.status,
                    pickedUpAt: d.pickedUpAt ?? null,
                    handedOverAt: d.handedOverAt ?? null,
                    deliveredAt: d.deliveredAt ?? null,
                    courierStatus: d.courierStatus ?? null,
                    courierStatusAt: d.courierStatusAt ?? null,
                  });
                  return {
                    eligible: evaluation.eligible,
                    reason: evaluation.reason,
                    needsCourierPanel: evaluation.needsCourierPanel,
                    manualPanelCancel: evaluation.manualPanelCancel,
                    warning: evaluation.warning,
                    courierLabel: courierLabel(d.courier),
                    collectedAt: evaluation.collectedAt,
                  };
                })(),
              }
            : {}),
        }))
      : order.dispatches;
    const transformed: any = {
      ...order,
      dispatches,
      editLock,
      // Badge flags for the order list (from the _count include in findAll —
      // absent on shapes that don't request it, e.g. public/my-orders).
      ...(((order as any)._count
        ? {
            activeReturnCount: (order as any)._count.returns ?? 0,
            hasActiveReturn: ((order as any)._count.returns ?? 0) > 0,
            activeExchangeCount: (order as any)._count.exchanges ?? 0,
            hasActiveExchange: ((order as any)._count.exchanges ?? 0) > 0,
          }
        : {}) as any),
      // D-A: `customer` is built FROM the order snapshot so the UI keeps
      // working while the source flips to snapshot. The linked
      // CustomerProfile is never read here.
      customer: orderSnapshotCustomer(order),
      shippingAddress: normalizedAddress,
      timeline: Array.isArray(order.timeline) ? order.timeline : [],
      trackingUrl:
        dispatches?.[0]?.trackingUrl ||
        buildTrackingUrl(
          order.courierService,
          order.courierTrackingCode,
          order.courierConsignmentId,
        ),
    };

    // Derived due (D1): received returns lower the collectable without ever
    // rewriting the order total. Only computed when the caller fetched the
    // received-return summary (order detail), so list rows keep their shape.
    if (Array.isArray((order as any).returns)) {
      const returnsValue = receivedReturnValue({
        returns: (order as any).returns,
        orderItems: Array.isArray(order.items) ? order.items : [],
      });
      transformed.receivedReturnValue = returnsValue;
      transformed.due = deriveOrderDue({
        total: Number(order.total),
        payments: (Array.isArray(order.payments)
          ? order.payments
          : []) as DuePayment[],
        receivedReturnValue: returnsValue,
        cancelled: order.status?.name === 'Cancelled',
      }).due;
    }
    return transformed;
  }

  private async generateDisplayId(): Promise<string> {
    const { year, month, day } = dhakaDateParts();
    const yy = String(year).slice(2);
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const dateStr = `${yy}${mm}${dd}`;
    const prefix = `ORD-${dateStr}`;

    return this.prisma.$transaction(async (tx) => {
      const counter = await tx.orderCounter.upsert({
        where: { date: dateStr },
        create: { date: dateStr, seq: 1 },
        update: { seq: { increment: 1 } },
      });
      return `${prefix}-${String(counter.seq).padStart(4, '0')}`;
    });
  }

  recalculate(
    items: { price: number; quantity: number }[],
    shipping: number,
    discount: number,
    discountType = 'flat',
  ) {
    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const effectiveDiscount =
      discountType === 'percentage' ? subtotal * (discount / 100) : discount;
    return {
      subtotal,
      total: Math.max(0, subtotal + shipping - effectiveDiscount),
    };
  }

  /**
   * Refuse a line-item mutation once the order has left the stage where its
   * stock reservation still describes reality. Shared by updateOrder,
   * addItem and removeItem — all three re-reserve stock, so gating only
   * updateOrder would leave two ways around the rule.
   *
   * 409 (not 400): the request is well-formed and the order exists, it is the
   * order's current state that forbids it — the same shape the edit-lock uses.
   */
  private assertItemsEditable(statusName: string | undefined): void {
    if (!statusName || !ITEM_EDIT_BLOCKED_STATUSES.has(statusName)) return;
    throw new ConflictException({
      statusCode: 409,
      code: 'ORDER_ITEMS_LOCKED',
      statusName,
      message:
        `Items of a "${statusName}" order can no longer be changed — the goods have already left the warehouse. ` +
        `Use the order status or return workflow instead.`,
    });
  }

  async findAll(query: {
    page?: number;
    perPage?: number;
    search?: string;
    statusId?: string;
    paymentStatus?: string;
    courier?: string;
    assignedToId?: string;
    dateFrom?: string;
    dateTo?: string;
    sort?: string;
    order?: string;
    includeTrashed?: boolean;
    kind?: 'SALE' | 'RETURN' | 'EXCHANGE';
    /** Exchange scope filter — only honored with kind=EXCHANGE. */
    type?: string;
  }) {
    // 1000-row pages are a first-class use case (daily volume in the
    // thousands) — but an unbounded `take` with the full list include
    // (items + payments + shipment + locks + dispatches) turns one page into
    // a catalogue dump that hangs both the API and the table.
    const rawPage = query.page || 1;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
    const rawPerPage = query.perPage || 10;
    const perPage = Number.isFinite(rawPerPage) && rawPerPage > 0
      ? Math.min(Math.floor(rawPerPage), 1000)
      : 10;
    const where: any = {};
    if (!query.includeTrashed) where.trashedAt = null;
    // RTN return orders are excluded from the sales list unless explicitly
    // requested — they are operations records, not sales. Task 7: the unified
    // Returns menu owns return visibility, so a kind-less list shows SALE +
    // EXCHANGE only (exchange orders keep their Exchange badge in the list).
    if (query.kind) {
      where.kind = query.kind;
    } else {
      where.kind = { not: 'RETURN' };
    }
    // Exchange scope filter (Exchanges list): server-side Full/Partial.
    // Only meaningful with kind=EXCHANGE — anything else is rejected so a
    // stray `type` can never silently filter the wrong list. Pre-column
    // rows have exchangeScope NULL and never match FULL/PARTIAL.
    if (query.type !== undefined) {
      if (query.kind !== 'EXCHANGE') {
        throw new BadRequestException(
          "The 'type' filter only applies with kind=EXCHANGE.",
        );
      }
      if (query.type !== 'FULL' && query.type !== 'PARTIAL') {
        throw new BadRequestException(
          `Invalid exchange type filter: ${query.type}. Use FULL or PARTIAL.`,
        );
      }
      where.exchangeScope = query.type;
    }
    if (query.search) {
      // Order number · customer/guest name · product SKU · phone (exact once
      // the input is a complete number, digits-only while it is not).
      const searchFilter = buildOrderSearchFilter(query.search);
      if (searchFilter) where.OR = searchFilter.OR;
    }
    if (query.statusId) where.statusId = query.statusId;
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
    if (query.courier) where.courierService = query.courier;
    if (query.assignedToId === 'unassigned') where.assignedToId = null;
    else if (query.assignedToId) where.assignedToId = query.assignedToId;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }
    const statsWhere = { ...where };
    delete statsWhere.statusId;

    const [data, total, stats] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { [query.sort || 'createdAt']: query.order || 'desc' },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          status: true,
          items: {
            include: {
              product: { select: { id: true, name: true, images: true } },
            },
          },
          payments: true,
          shipment: true,
          assignee: { select: { id: true, firstName: true, lastName: true } },
          // Task 7: Exchanges list needs the original-order link without a
          // second query; RTN rows keep their returnOf link for the badge.
          exchangeOfOrder: { select: { id: true, displayId: true } },
          returnOfOrder: { select: { id: true, displayId: true } },
          // One LEFT JOIN for every list row — no per-order lock queries.
          editLock: {
            include: { user: { select: { firstName: true, lastName: true } } },
          },
          // Latest dispatch only — supplies the (correct) tracking link on list rows.
          dispatches: { orderBy: { createdAt: 'desc' }, take: 1 },
          // Badge flags (Return ×N / Exchange) come from the list response
          // itself — one filtered COUNT per relation, never per-row fetches.
          _count: {
            select: {
              returns: { where: { status: { not: 'CLOSED' } } },
              exchanges: { where: { trashedAt: null } },
            },
          },
        },
      }),
      this.prisma.order.count({ where }),
      this.prisma.order.groupBy({
        by: ['statusId'],
        where: statsWhere,
        _count: true,
      }),
    ]);

    const statusCounts = stats.reduce(
      (acc, curr) => {
        acc[curr.statusId] = curr._count;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      data: data.map((o: any) => this.transformOrder(o)),
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
        statusCounts,
      },
    };
  }

  async findMyOrders(
    userId: string,
    query: { page?: number; perPage?: number; status?: string },
  ) {
    const rawPage = query.page || 1;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
    const rawPerPage = query.perPage || 10;
    const perPage = Number.isFinite(rawPerPage) && rawPerPage > 0
      ? Math.min(Math.floor(rawPerPage), 1000)
      : 10;
    const where: any = { customerId: userId, trashedAt: null, kind: 'SALE' };
    if (query.status) {
      where.status = { name: { equals: query.status, mode: 'insensitive' } };
    }
    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          status: true,
          items: {
            include: {
              product: {
                select: { id: true, name: true, images: true, slug: true },
              },
            },
          },
          payments: true,
          dispatches: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      data: data.map((o: any) => this.transformOrder(o)),
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findMyOrderById(userId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, customerId: userId, kind: 'SALE' },
      include: {
        status: true,
        shipment: true,
        items: {
          include: {
            product: {
              select: { id: true, name: true, images: true, slug: true },
            },
          },
        },
        payments: {
          include: {
            verifier: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        dispatchLogs: { orderBy: { createdAt: 'desc' } },
        dispatches: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!order || order.trashedAt)
      throw new NotFoundException('Order not found');
    return this.transformOrder(order);
  }

  async findOne(
    id: string,
    opts: { token?: string; userId?: string; role?: string } = {},
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        status: true,
        shipment: true,
        assignee: { select: { id: true, firstName: true, lastName: true } },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                images: true,
                slug: true,
                category: { select: { name: true } },
              },
            },
            combo: { select: { id: true, name: true } },
            variant: {
              include: {
                product: {
                  select: {
                    id: true,
                    variants: {
                      where: { isActive: true },
                      select: {
                        id: true,
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
                attributeValues: {
                  include: {
                    attributeValue: {
                      include: {
                        attribute: { select: { name: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        payments: {
          include: {
            verifier: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        dispatchLogs: { orderBy: { createdAt: 'desc' } },
        dispatches: { orderBy: { createdAt: 'desc' } },
        // RTN relationship — both directions (original → RTN, RTN → original).
        returnOfOrder: { include: { status: true } },
        returnOrders: { include: { status: true } },
        // Received Return rows: the order-due derivation subtracts their
        // item value (D1 — the order total is never mutated). Summary fetch
        // only; the returns module owns the full lifecycle.
        returns: {
          where: { status: { in: [...RECEIVED_RETURN_STATUSES] as any } },
          select: {
            id: true,
            status: true,
            receivedAt: true,
            items: true,
          },
        },
        // Include edit lock for staff detail view (stripped for customers).
        editLock: {
          include: { user: { select: { firstName: true, lastName: true } } },
        },
        // EXCHANGE children: the original order + its item snapshots ride on
        // the SAME fetch (exchange detail needs old-vs-new). PUBLIC/CUSTOMER
        // responses never see this — stripped below (another customer's data).
        exchangeOfOrder: {
          select: {
            id: true,
            displayId: true,
            kind: true,
            subtotal: true,
            shippingCharge: true,
            discount: true,
            discountType: true,
            total: true,
            status: { select: { id: true, name: true, color: true } },
            items: {
              select: {
                productId: true,
                variantId: true,
                quantity: true,
                price: true,
                product: { select: { id: true, name: true, sku: true, images: true } },
                variant: {
                  select: { id: true, sku: true, image: true, images: true },
                },
              },
            },
          },
        },
      },
    });
    if (!order || order.trashedAt)
      throw new NotFoundException('Order not found');
    const ownsOrder = opts.userId && order.customerId === opts.userId;
    const hasValidToken = opts.token && order.viewToken === opts.token;
    const isAdmin =
      opts.role === 'superadmin' ||
      opts.role === 'admin' ||
      opts.role === 'employee';
    if (!ownsOrder && !hasValidToken && !isAdmin) {
      throw new NotFoundException('Order not found');
    }

    // Edit-lock view gate (staff context only): while another staff member
    // holds a live lock the order cannot be opened — the UI offers an explicit
    // override, which is recorded in the timeline. The holder themselves and
    // public/customer token lookups are never blocked.
    if (isAdmin && opts.userId && !hasValidToken && order.editLock) {
      const lock = order.editLock as any;
      const isLive = lock.expiresAt && new Date(lock.expiresAt) > new Date();
      if (isLive && lock.userId !== opts.userId) {
        const holderName =
          [lock.user?.firstName, lock.user?.lastName].filter(Boolean).join(
            ' ',
          ) || null;
        throw new ConflictException({
          statusCode: 409,
          code: 'ORDER_LOCKED',
          message: holderName
            ? `This order is currently being edited by ${holderName}. Override the lock to open it.`
            : 'This order is currently being edited by another staff member. Override the lock to open it.',
          lock: {
            orderId: lock.orderId,
            userId: lock.userId,
            userName: holderName,
            acquiredAt: lock.acquiredAt ?? null,
            expiresAt: lock.expiresAt ?? null,
          },
        });
      }
    }
    // Note: edit-lock presence is stripped by transformOrder for the public/customer
    // shape (it never exposes the holder). Staff only.
    // exchangeOfOrder is a cross-order snapshot (another order's customer/items):
    // staff only. Public/customer token viewers never see it.
    if (!isAdmin) delete (order as any).exchangeOfOrder;
    const transformed = this.transformOrder(order);
    // Timeline source attribution for the admin All/Staff/Courier/System
    // filters — derived at read time (writers never persist a source field).
    if (Array.isArray(transformed.timeline)) {
      transformed.timeline = withTimelineSources(transformed.timeline);
    }
    return transformed;
  }

  /**
   * Remaining fulfillable quantity per order line.
   *
   * Short fulfillment is a DIFFERENT concept from courier Partial: an order
   * for A × 4 with a dispatch covering A × 2 still has A × 2 fulfillable from
   * the SAME original order — no new customer order, no Partial status. This
   * query makes that deterministic: ordered − Σ(dispatched, non-cancelled).
   */
  async getRemainingFulfillment(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, dispatches: true },
    });
    if (!order || order.trashedAt) throw new NotFoundException('Order not found');

    const dispatched = new Map<string, number>();
    for (const d of order.dispatches) {
      if (d.status === 'CANCELLED') continue;
      const mapping = Array.isArray(d.productMapping) ? d.productMapping : [];
      for (const m of mapping) {
        if (!m || typeof m !== 'object') continue;
        const key = String((m as any).productVariantId ?? '');
        if (!key) continue;
        dispatched.set(key, (dispatched.get(key) ?? 0) + Number((m as any).quantity ?? 0));
      }
    }

    return order.items.map((item) => {
      const keys = [item.variantId, item.productId].filter(Boolean) as string[];
      const total = keys.reduce((sum, k) => sum + (dispatched.get(k) ?? 0), 0);
      return {
        orderItemId: item.id,
        productId: item.productId,
        variantId: item.variantId ?? null,
        ordered: item.quantity,
        dispatched: total,
        remaining: Math.max(0, item.quantity - total),
      };
    });
  }

  private async getDefaultOfficeNote(): Promise<string | null> {
    try {
      const s = await this.prisma.systemSetting.findUnique({
        where: { key: 'default_office_note' },
      });
      return s?.value || null;
    } catch {
      return null;
    }
  }

  async create(
    dto: CreateOrderDto,
    clientIp?: string,
    user?: any,
    userAgent?: string,
  ) {
    const userId = user?.userId;
    const isCustomer = Boolean(user && user.role === 'customer');

    const displayId = await this.generateDisplayId();
    const initialStatus = await this.prisma.orderStatus.findFirst({
      where: { isInitial: true },
    });
    if (!initialStatus)
      throw new BadRequestException('No initial order status configured');

    // ── Authenticated identity override ──
    // Only a logged-in customer placing their own storefront order is locked to
    // their own identity. Staff (admin/employee/cashier/...) creating orders on
    // behalf of customers must keep the client-supplied customer/guest data.
    if (userId && isCustomer) {
      dto.customerId = userId;
      dto.guestPhone = undefined;
      dto.guestName = undefined;
    } else if (!userId) {
      // Guest checkout: ignore any client-supplied customerId
      dto.customerId = undefined;
    }

    if (dto.guestPhone) {
      const normalized = normalizePhone(dto.guestPhone);
      if (!normalized) {
        throw new BadRequestException(
          'Invalid Bangladeshi phone number format. Use 01XXXXXXXXX or +8801XXXXXXXXX.',
        );
      }
      dto.guestPhone = normalized;
    }

    // Staff-created orders (admin/employee/cashier acting on behalf of a
    // customer) are exempt from storefront block rules — the restriction is
    // a storefront-ordering concern, not an absolute ban on serving the
    // customer. The exemption is context-bound (an authenticated staff actor
    // creating the order), NOT a role-based bypass of any other rule, and it
    // is never silent: matching blocks are returned on the created order as
    // `warnings` so the operator UI can surface them.
    const warnings: string[] = [];
    const isStaffCreate = !!userId && !isCustomer;

    // Optional secondary contact number (staff-entered on manual orders).
    // Normalized like every other phone. An invalid value is refused loudly
    // for staff (they typed it) but ignored for guests (never break a
    // storefront checkout over an optional field the storefront never sends).
    if (dto.secondaryPhone) {
      const normalizedSecondary = normalizePhone(dto.secondaryPhone);
      if (!normalizedSecondary) {
        if (isStaffCreate) {
          throw new BadRequestException(
            'Invalid secondary phone number format. Use 01XXXXXXXXX or +8801XXXXXXXXX.',
          );
        }
        dto.secondaryPhone = undefined;
      } else {
        dto.secondaryPhone = normalizedSecondary;
      }
    }

    if (clientIp) {
      const orderBlockIp =
        await this.blockedEntries.findOrderBlockedIp(clientIp);
      if (orderBlockIp) {
        if (!isStaffCreate) {
          throw new BadRequestException(
            'Orders from your IP address are temporarily restricted. Please contact support.',
          );
        }
        warnings.push('This IP address is blocked for storefront ordering.');
      }
    }

    const blockedPhone = dto.guestPhone
      ? await this.blockedEntries.findBlockedPhone(dto.guestPhone)
      : null;
    if (blockedPhone) {
      if (!isStaffCreate) {
        throw new BadRequestException(
          'This phone number has been blocked. Please contact support.',
        );
      }
      warnings.push('This phone number is blocked for storefront ordering.');
    }

    if (dto.guestPhone && !dto.customerId) {
      const isBlocked = await this.customersService.isPhoneBlocked(
        dto.guestPhone,
      );
      if (isBlocked) {
        if (!isStaffCreate) {
          throw new BadRequestException(
            'This phone number has been blocked. Please contact support.',
          );
        }
        warnings.push(
          'This customer account is suspended; the order was created by staff.',
        );
      }
    }

    if (dto.guestPhone && dto.guestName && !dto.customerId) {
      const customer = await this.customersService.findOrCreateCustomer(
        dto.guestPhone,
        dto.guestName,
        clientIp,
        dto.guestEmail,
      );
      dto.customerId = customer.id;
    }

    // Customer profile linked via dto.customerId (if any). Hoisted so the
    // order-time snapshot below can prefer the CUSTOMER's data. Never the
    // authenticated actor: for staff creates `user` is the staff member and
    // must never leak into customer fields (previously a block-scoped
    // `const user` here shadowed the staff param inside this block, while the
    // snapshot below fell back to the staff identity).
    let linkedCustomer: {
      status?: unknown;
      phoneNumber?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      email?: string | null;
    } | null = null;

    if (dto.customerId) {
      linkedCustomer = await this.prisma.userProfile.findUnique({
        where: { id: dto.customerId },
        select: {
          status: true,
          phoneNumber: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      });
      if (linkedCustomer?.status === 'suspended') {
        throw new BadRequestException(
          'This account has been blocked. Please contact support.',
        );
      }
      // Ensure CustomerProfile exists (order FK now references CustomerProfile).
      //
      // OWNERSHIP: creating an order NEVER overwrites canonical customer
      // identity. The order-time values live in the Order.* snapshot columns
      // (written further down), which is order-owned. Previously this was an
      // `upsert` whose `update` branch wrote `name` unconditionally and
      // phone/email whenever supplied, so a staff order for an existing
      // customer silently renamed and re-phoned the real person.
      //
      // The row is created only when genuinely absent (the FK target must
      // exist); an existing profile is left completely untouched.
      const desiredPhone = dto.guestPhone || linkedCustomer?.phoneNumber;
      const name =
        dto.guestName ||
        (linkedCustomer
          ? `${linkedCustomer.firstName} ${linkedCustomer.lastName}`.trim()
          : 'Customer');
      const email = dto.guestEmail || linkedCustomer?.email || undefined;
      if (desiredPhone) {
        // Phone is a unique key — don't clobber another customer's number.
        let phone: string | undefined = desiredPhone;
        if (dto.guestPhone) {
          const phoneOwner = await this.prisma.customerProfile.findFirst({
            where: { phone: dto.guestPhone, id: { not: dto.customerId } },
            select: { id: true },
          });
          if (phoneOwner) phone = undefined; // conflict → keep existing profile phone
        }
        const existingProfile = await this.prisma.customerProfile.findUnique({
          where: { id: dto.customerId },
          select: { id: true },
        });
        if (!existingProfile) {
          await this.prisma.customerProfile.create({
            data: {
              id: dto.customerId,
              phone: phone || desiredPhone,
              name,
              ...(email ? { email } : {}),
            },
          });
        }
      }
    }

    // Secondary phone: link-or-refuse (staff decision: refuse + warn).
    // A secondary identical to the primary is redundant — drop it. Owned by
    // ANOTHER customer → staff gets a 409; guests silently keep the number
    // off the link table (two strangers are never merged through an order).
    // With no customer and no primary phone, a KNOWN secondary still
    // auto-attaches its owner ("type any linked number → same customer").
    if (dto.secondaryPhone && dto.customerId) {
      const primaryPhone = dto.guestPhone || linkedCustomer?.phoneNumber || null;
      if (dto.secondaryPhone === primaryPhone) {
        dto.secondaryPhone = undefined;
      } else {
        try {
          await this.customersService.linkPhones(dto.customerId, [dto.secondaryPhone], 'secondary');
        } catch (err) {
          if (err instanceof ConflictException && !isStaffCreate) {
            dto.secondaryPhone = undefined;
          } else {
            throw err;
          }
        }
      }
    } else if (dto.secondaryPhone && !dto.customerId && !dto.guestPhone) {
      const resolved = await this.customersService.resolveCustomerIdByPhones([dto.secondaryPhone]);
      if (resolved.customerId && !resolved.conflicted) {
        dto.customerId = resolved.customerId;
      } else {
        dto.secondaryPhone = undefined;
      }
    }

    // Blocked-number sweep across EVERY number tied to this order/customer —
    // primary, secondary and previously linked — with the identical
    // throw-for-guests / warn-for-staff outcome as the primary checks above.
    {
      const sweep = new Set(
        [dto.guestPhone, dto.secondaryPhone, linkedCustomer?.phoneNumber].filter(Boolean) as string[],
      );
      if (dto.customerId) {
        const linked = await this.customersService.getLinkedPhones(dto.customerId).catch(() => []);
        for (const l of linked) sweep.add(l.phone);
      }
      for (const phone of sweep) {
        if (phone === dto.guestPhone) continue; // already checked above
        const hit = await this.blockedEntries.findBlockedPhone(phone);
        if (hit) {
          if (!isStaffCreate) {
            throw new BadRequestException(
              'This phone number has been blocked. Please contact support.',
            );
          }
          warnings.push('This phone number is blocked for storefront ordering.');
          continue;
        }
        const suspended = await this.customersService.isPhoneBlocked(phone);
        if (suspended) {
          if (!isStaffCreate) {
            throw new BadRequestException(
              'This phone number has been blocked. Please contact support.',
            );
          }
          warnings.push(
            'This customer account is suspended; the order was created by staff.',
          );
        }
      }
    }

    // ALWAYS_OUT_OF_STOCK guard: block order creation for these products
    const itemProductIds = dto.items
      .filter((i) => i.productId)
      .map((i) => i.productId!);
    if (itemProductIds.length > 0) {
      const blockedProducts = await this.prisma.product.findMany({
        where: {
          id: { in: itemProductIds },
          availabilityMode: 'ALWAYS_OUT_OF_STOCK',
        },
        select: { id: true, name: true },
      });
      if (blockedProducts.length > 0) {
        const names = blockedProducts.map((p) => p.name).join(', ');
        throw new BadRequestException(
          `Cannot order "${names}" — this product is currently unavailable.`,
        );
      }
    }

    // Courier office note: at CREATE, if user provides a note, merge it with
    // the system default office note (user note + default office note).
    // If no user note is provided, copy the default office note.
    const userNote = dto.officeNotes?.trim();
    const defaultNote = (await this.getDefaultOfficeNote())?.trim();
    let resolvedOfficeNotes: string | null = null;
    if (userNote && defaultNote) {
      resolvedOfficeNotes = userNote.includes(defaultNote)
        ? userNote
        : `${userNote} ${defaultNote}`;
    } else {
      resolvedOfficeNotes = userNote || defaultNote || null;
    }

    // Pre-fetch tracking purchase-mode settings OUTSIDE the transaction so a
    // settings-table failure never rolls back the order. Passed to
    // firePurchaseInstant to avoid a non-transactional read inside the tx.
    // Absent keys default to 'instant' on BOTH consumers below
    // (firePurchaseInstant and the OrderPlaced gate), so they always agree.
    let preloadedPurchaseSettings: Record<string, string> = {};
    try {
      const purchaseSettings = await this.prisma.systemSetting.findMany({
        where: {
          key: {
            in: [
              'tracking_meta_purchase_mode',
              'tracking_tiktok_purchase_mode',
            ],
          },
        },
      });
      preloadedPurchaseSettings = Object.fromEntries(
        purchaseSettings.map((s: any) => [s.key, s.value]),
      );
    } catch {
      // Best-effort: unreachable settings table → preloaded stays {} → both
      // consumers fall back to 'instant' (Purchase fires, OrderPlaced silent).
    }

    // Canonical sales-attribution dimensions, resolved once before the write.
    // Channel may be supplied explicitly (manual order); otherwise it is derived
    // from the legacy evidence by the SAME mapper the backfill uses, so a new
    // order and a historical one can never disagree. An omitted or incompatible
    // source resolves to NULL with a warning — never a rejection.
    const canonical = await this.salesChannelService.resolve({
      channel: dto.channel ?? null,
      channelEntity: dto.channelEntity ?? null,
      sourceSlug: dto.sourceSlug ?? null,
      acquisitionType: dto.acquisitionType ?? null,
    }, { staffUserId: userId ?? undefined });

    // Attribution warnings are advisory: the sale still completed, so the order
    // is created and the caller is told what was cleared.
    if (canonical.warnings.length > 0) warnings.push(...canonical.warnings);

    const order = await this.prisma.$transaction(async (tx) => {
      // Fetch and validate database prices and active statuses
      const productIds = Array.from(
        new Set(dto.items.filter((i) => i.productId).map((i) => i.productId!)),
      );
      const products =
        productIds.length > 0
          ? await tx.product.findMany({
              where: { id: { in: productIds } },
              select: {
                id: true,
                basePrice: true,
                salePrice: true,
                isActive: true,
                availabilityMode: true,
                name: true,
                type: true,
                managedStockQuantity: true,
                reservedStock: true,
              },
            })
          : [];
      const productMap = new Map(products.map((p) => [p.id, p]));

      const variantIds = Array.from(
        new Set(dto.items.filter((i) => i.variantId).map((i) => i.variantId!)),
      );
      const variants =
        variantIds.length > 0
          ? await tx.productVariant.findMany({
              where: { id: { in: variantIds } },
              select: {
                id: true,
                price: true,
                salePrice: true,
                isActive: true,
                productId: true,
                managedStockQuantity: true,
                reservedStock: true,
              },
            })
          : [];
      const variantMap = new Map(variants.map((v) => [v.id, v]));

      // A variant-only line item carries no productId, so its parent product was
      // never in the first query and `productMap` came back empty — which made
      // the "Parent product for variant X not found" check reject a perfectly
      // valid order. Resolve those parents now, using the productId the variant
      // rows already carry.
      const missingParentIds = Array.from(
        new Set(
          variants
            .map((v) => v.productId)
            .filter((pid) => pid && !productMap.has(pid)),
        ),
      );
      if (missingParentIds.length > 0) {
        const parents = await tx.product.findMany({
          where: { id: { in: missingParentIds } },
          select: {
            id: true,
            basePrice: true,
            salePrice: true,
            isActive: true,
            availabilityMode: true,
            name: true,
            type: true,
            managedStockQuantity: true,
            reservedStock: true,
          },
        });
        for (const p of parents) productMap.set(p.id, p);
      }

      const comboIds = Array.from(
        new Set(dto.items.filter((i) => i.comboId).map((i) => i.comboId!)),
      );
      const combos =
        comboIds.length > 0
          ? await tx.combo.findMany({
              where: { id: { in: comboIds } },
              select: {
                id: true,
                basePrice: true,
                salePrice: true,
                isActive: true,
                name: true,
                items: {
                  select: {
                    productId: true,
                    variantId: true,
                    quantity: true,
                    product: {
                      select: {
                        type: true,
                        availabilityMode: true,
                        name: true,
                        managedStockQuantity: true,
                        reservedStock: true,
                      },
                    },
                  },
                },
              },
            })
          : [];
      const comboMap = new Map(combos.map((c) => [c.id, c]));

      for (const item of dto.items) {
        if (item.comboId) {
          const combo = comboMap.get(item.comboId);
          if (!combo) {
            throw new BadRequestException(`Combo ${item.comboId} not found`);
          }
          if (!combo.isActive) {
            throw new BadRequestException(
              `Combo "${combo.name}" is no longer active`,
            );
          }
          item.price = Number(combo.salePrice ?? combo.basePrice);

          for (const sub of combo.items) {
            if (
              sub.product?.type === 'variable' &&
              !sub.variantId &&
              (!item.comboSelection || !item.comboSelection[sub.productId])
            ) {
              throw new BadRequestException(
                `Product "${sub.productId}" in combo "${combo.name}" requires a variant selection.`,
              );
            }
            // Managed-stock availability for each combo component, mirroring
            // feed._availableStock (managedStockQuantity - reservedStock).
            const compVariantId =
              sub.variantId ||
              (item.comboSelection as Record<string, string> | null)?.[
                sub.productId
              ] ||
              null;
            const compQty = (sub.quantity ?? 1) * item.quantity;
            if (sub.product?.type === 'variable') {
              if (!compVariantId) continue;
              const compVariant = await tx.productVariant.findUnique({
                where: { id: compVariantId },
                select: {
                  id: true,
                  managedStockQuantity: true,
                  reservedStock: true,
                },
              });
              this.assertManagedAvailability({
                name: sub.product.name ?? sub.productId,
                availabilityMode: sub.product.availabilityMode,
                managedStockQuantity: compVariant?.managedStockQuantity ?? 0,
                reservedStock: compVariant?.reservedStock ?? 0,
                quantity: compQty,
              });
            } else {
              this.assertManagedAvailability({
                name: sub.product?.name ?? sub.productId,
                availabilityMode: sub.product?.availabilityMode,
                managedStockQuantity: sub.product?.managedStockQuantity ?? 0,
                reservedStock: sub.product?.reservedStock ?? 0,
                quantity: compQty,
              });
            }
          }
        } else if (item.variantId) {
          const variant = variantMap.get(item.variantId);
          if (!variant) {
            throw new BadRequestException(
              `Variant ${item.variantId} not found`,
            );
          }
          if (!variant.isActive) {
            throw new BadRequestException(`Variant is no longer active`);
          }
          // Reject variant-product mismatch
          if (item.productId && item.productId !== variant.productId) {
            throw new BadRequestException(
              `Variant ${item.variantId} does not belong to product ${item.productId}`,
            );
          }
          const parentProduct = productMap.get(variant.productId);
          if (!parentProduct) {
            throw new BadRequestException(
              `Parent product for variant ${item.variantId} not found`,
            );
          }
          if (!parentProduct.isActive) {
            throw new BadRequestException(`Product is no longer active`);
          }
          if (parentProduct.availabilityMode === 'ALWAYS_OUT_OF_STOCK') {
            throw new BadRequestException(
              `Product "${parentProduct.name}" is out of stock and cannot be ordered`,
            );
          }
          this.assertManagedAvailability({
            name: parentProduct.name,
            availabilityMode: parentProduct.availabilityMode,
            managedStockQuantity: variant.managedStockQuantity ?? 0,
            reservedStock: variant.reservedStock ?? 0,
            quantity: item.quantity,
          });
          item.price = Number(
            variant.salePrice ??
              variant.price ??
              parentProduct.salePrice ??
              parentProduct.basePrice ??
              0,
          );
        } else if (item.productId) {
          const product = productMap.get(item.productId);
          if (!product) {
            throw new BadRequestException(
              `Product ${item.productId} not found`,
            );
          }
          if (!product.isActive) {
            throw new BadRequestException(`Product is no longer active`);
          }
          if (product.availabilityMode === 'ALWAYS_OUT_OF_STOCK') {
            throw new BadRequestException(
              `Product "${product.name}" is out of stock and cannot be ordered`,
            );
          }
          this.assertManagedAvailability({
            name: product.name,
            availabilityMode: product.availabilityMode,
            managedStockQuantity: product.managedStockQuantity ?? 0,
            reservedStock: product.reservedStock ?? 0,
            quantity: item.quantity,
          });
          item.price = Number(product.salePrice ?? product.basePrice);
        } else {
          throw new BadRequestException(
            'Each item must have a productId, variantId, or comboId',
          );
        }
      }

      // ── Derive shipping server-side ──
      const computedSubtotal = dto.items.reduce(
        (s, i) => s + i.price * i.quantity,
        0,
      );
      const [
        shippingModeSetting,
        deliveryChargeSetting,
        freeDeliveryMinSetting,
        districtChargesSetting,
      ] = await Promise.all([
        tx.systemSetting
          .findUnique({ where: { key: 'shipping_mode' } })
          .catch(() => null),
        tx.systemSetting.findUnique({ where: { key: 'delivery_charge' } }),
        tx.systemSetting.findUnique({ where: { key: 'free_delivery_min' } }),
        tx.systemSetting.findUnique({ where: { key: 'district_charges' } }),
      ]);

      const shippingMode = shippingModeSetting?.value || 'auto_district';

      let derivedShippingCharge = 0;

      if (shippingMode === 'options') {
        // Options mode: use selected option or auto-fallback to highest amount
        const hasOptions = await tx.shippingOption.findFirst({
          where: { isActive: true },
          select: { id: true },
        });
        if (hasOptions) {
          let optionId = dto.selectedShippingOptionId;
          if (!optionId) {
            const highest = await tx.shippingOption.findFirst({
              where: { isActive: true },
              orderBy: { amount: 'desc' },
              select: { id: true },
            });
            optionId = highest?.id;
          }
          if (!optionId) {
            throw new BadRequestException('A shipping option is required');
          }
          const shippingOption = await tx.shippingOption.findUnique({
            where: { id: optionId },
          });
          if (!shippingOption || !shippingOption.isActive) {
            throw new BadRequestException(
              'Selected shipping option is not available',
            );
          }
          derivedShippingCharge = Number(shippingOption.amount);
        }
      } else {
        // auto_district/default mode. Rule (mirrors the storefront
        // `resolveDeliveryCharge` helper — both must agree or the admin bill
        // differs from what the customer saw):
        // - district with a zone/map rule → that rule's charge;
        // - no district, or a district with no rule → the MAXIMUM configured
        //   charge (default, zone custom_amounts, district_charges values).
        const defaultCharge = Number(deliveryChargeSetting?.value || 0);

        // Optional-chained: unit-test tx doubles predate the zone lookup and
        // only stub the delegates their test needs; production tx always
        // carries shippingZoneGroup.
        let activeZones: any[] = [];
        try {
          activeZones =
            (await tx.shippingZoneGroup?.findMany?.({
              where: { isActive: true },
            })) ?? [];
        } catch {
          activeZones = [];
        }

        let districtMap: Record<string, number> = {};
        let districtMapInvalid = false;
        if (districtChargesSetting?.value) {
          try {
            districtMap = JSON.parse(districtChargesSetting.value);
          } catch {
            districtMapInvalid = true;
          }
        }

        let maxCharge = defaultCharge;
        for (const zone of activeZones) {
          if (zone.type === 'custom_amount' && zone.amount != null) {
            maxCharge = Math.max(maxCharge, Number(zone.amount));
          }
        }
        for (const v of Object.values(districtMap)) {
          maxCharge = Math.max(maxCharge, Number(v) || 0);
        }

        const dtoDistrict =
          dto.district ||
          (typeof dto.shippingAddress === 'object' && dto.shippingAddress
            ? dto.shippingAddress.district
            : undefined);
        if (!dtoDistrict) {
          derivedShippingCharge = maxCharge;
        } else {
          derivedShippingCharge = defaultCharge;
          let zoneMatched = false;
          for (const zone of activeZones) {
            const zoneDistricts = zone.districts as string[];
            if (zoneDistricts.includes(dtoDistrict)) {
              zoneMatched = true;
              if (zone.type === 'no_delivery') {
                throw new BadRequestException(
                  'Delivery is not available for your area',
                );
              }
              if (zone.type === 'custom_amount' && zone.amount != null) {
                derivedShippingCharge = Number(zone.amount);
              }
              break;
            }
          }
          if (!zoneMatched) {
            if (districtMapInvalid) {
              throw new BadRequestException(
                'Invalid district charges configuration',
              );
            }
            derivedShippingCharge =
              districtMap[dtoDistrict] !== undefined
                ? districtMap[dtoDistrict]
                : maxCharge;
          }
        }

        // Free delivery threshold — applies to both auto_district and default
        const freeDeliveryMin = Number(freeDeliveryMinSetting?.value || 0);
        if (freeDeliveryMin > 0 && computedSubtotal >= freeDeliveryMin) {
          derivedShippingCharge = 0;
        }
      }

      // Shipping charge: if staff explicitly provided shippingCharge (or if provided in DTO),
      // respect that amount. Otherwise fall back to derivedShippingCharge from settings.
      let finalShippingCharge = derivedShippingCharge;
      let isShippingOverridden = false;
      if (dto.shippingCharge !== undefined && !isNaN(Number(dto.shippingCharge))) {
        const explicitShipping = Number(dto.shippingCharge);
        if (isStaffCreate || explicitShipping >= 0) {
          finalShippingCharge = explicitShipping;
          isShippingOverridden = Math.abs(finalShippingCharge - derivedShippingCharge) > 0.01;
        }
      }

      const { subtotal } = this.recalculate(
        dto.items,
        finalShippingCharge,
        0,
        'flat',
      );

      let effectiveDiscount = 0;
      let effectiveDiscountType: string = 'flat';
      let effectiveDiscountMonetary = 0;
      let couponRow: any = null;

      if (dto.couponCode) {
        // Fetch full coupon server-side and compute validated discount
        [couponRow] = await tx.$queryRawUnsafe(
          'SELECT id, "isActive", type, value, "minOrderValue", "percentageCap", "maxUses", "usedCount", "maxUsesPerCustomer", "expiresAt", "startsAt" FROM "Coupon" WHERE code = $1 FOR UPDATE',
          dto.couponCode,
        );
        if (!couponRow) {
          throw new BadRequestException('Coupon not found');
        }
        if (!couponRow.isActive) {
          throw new BadRequestException('Coupon is no longer active');
        }
        if (couponRow.maxUses && couponRow.usedCount >= couponRow.maxUses) {
          throw new BadRequestException('Coupon usage limit reached');
        }
        if (couponRow.expiresAt && new Date() > new Date(couponRow.expiresAt)) {
          throw new BadRequestException('Coupon has expired');
        }
        if (couponRow.startsAt && new Date() < new Date(couponRow.startsAt)) {
          throw new BadRequestException('Coupon is not yet active');
        }
        if (
          couponRow.minOrderValue &&
          Number(subtotal) < Number(couponRow.minOrderValue)
        ) {
          throw new BadRequestException(
            `Minimum order value of ${couponRow.minOrderValue} required for this coupon`,
          );
        }

        // Check per-customer usage limit inside the transaction
        if (dto.customerId && couponRow.maxUsesPerCustomer) {
          const userUsageCount = await tx.couponUsage.count({
            where: { couponId: couponRow.id, userId: dto.customerId },
          });
          if (userUsageCount >= couponRow.maxUsesPerCustomer) {
            throw new BadRequestException(
              'Per-customer usage limit reached for this coupon',
            );
          }
        }

        // Compute discount from coupon
        const rawValue = Number(couponRow.value);

        if (couponRow.type === 'percentage') {
          let cappedPercent = rawValue;
          if (couponRow.percentageCap) {
            const maxPctOfSubtotal =
              (Number(couponRow.percentageCap) / Number(subtotal)) * 100;
            cappedPercent = Math.min(rawValue, maxPctOfSubtotal);
          }
          effectiveDiscount = cappedPercent;
          effectiveDiscountType = 'percentage';
          effectiveDiscountMonetary = subtotal * (cappedPercent / 100);
          if (couponRow.percentageCap) {
            effectiveDiscountMonetary = Math.min(
              effectiveDiscountMonetary,
              Number(couponRow.percentageCap),
            );
          }
        } else {
          effectiveDiscount = Math.min(rawValue, Number(subtotal));
          effectiveDiscountType = 'flat';
          effectiveDiscountMonetary = effectiveDiscount;
        }
      } else if (dto.discount !== undefined && Number(dto.discount) > 0) {
        // Staff-entered or direct manual discount
        const discVal = Number(dto.discount);
        const discType = dto.discountType === 'percentage' ? 'percentage' : 'flat';
        effectiveDiscountType = discType;
        if (discType === 'percentage') {
          effectiveDiscount = Math.min(100, Math.max(0, discVal));
          effectiveDiscountMonetary = Number(subtotal) * (effectiveDiscount / 100);
        } else {
          effectiveDiscount = Math.min(Number(subtotal), Math.max(0, discVal));
          effectiveDiscountMonetary = effectiveDiscount;
        }
      }

      const { subtotal: finalSubtotal, total: finalTotal } = this.recalculate(
        dto.items,
        finalShippingCharge,
        effectiveDiscount,
        effectiveDiscountType,
      );

      if (dto.paymentOptionType === 'PARTIAL_PAYMENT') {
        if (
          dto.partialAmount !== undefined &&
          (dto.partialAmount <= 0 || dto.partialAmount > Number(finalTotal))
        ) {
          throw new BadRequestException(
            'Partial payment amount must be greater than 0 and not exceed the order total',
          );
        }
      }

      // Website attribution (spec §20-21): an explicitly supplied source wins;
      // otherwise resolve the storefront-collected landing signals (utm /
      // click-id / referrer) through the single canonical resolver.
      const webAttribution = resolveWebAttribution(
        dto.attribution as any,
      );
      const resolvedSourcePlatform =
        dto.sourcePlatform || webAttribution?.sourcePlatform || null;
      const resolvedSourceType =
        dto.sourceType || webAttribution?.sourceType || null;

      // Order-time customer snapshot: capture customer data at order creation
      // time so it's preserved independently of later CustomerProfile mutations.
      // This is the immutable record of what was known about the customer when
      // the order was placed.
      //
      // Fallback chain: explicit DTO fields → linked customer profile →
      // the authenticated actor ONLY when that actor IS the customer
      // (storefront customer placing their own order). A staff member
      // creating an order on someone's behalf must NEVER appear here.
      const orderActor = isCustomer ? user : undefined;
      const shippingAddrObj = typeof dto.shippingAddress === 'object' && dto.shippingAddress
        ? dto.shippingAddress as Record<string, unknown>
        : {};
      const orderTimeEmail = dto.guestEmail || linkedCustomer?.email || orderActor?.email || null;
      const orderTimePhone = dto.guestPhone || linkedCustomer?.phoneNumber || orderActor?.phoneNumber || null;
      const orderTimeFirstName = dto.guestName?.split(' ')[0] || linkedCustomer?.firstName || orderActor?.firstName || null;
      const orderTimeLastName = dto.guestName?.split(' ').slice(1).join(' ') || linkedCustomer?.lastName || orderActor?.lastName || null;
      const orderTimeCity = (shippingAddrObj.city as string) || (shippingAddrObj.district as string) || null;
      const orderTimeState = (shippingAddrObj.state as string) || (shippingAddrObj.division as string) || resolveDivision(dto.district) || null;
      const orderTimeZip = (shippingAddrObj.zip as string) || (shippingAddrObj.zipCode as string) || (shippingAddrObj.postalCode as string) || null;
      const orderTimeCountry = (shippingAddrObj.country as string) || 'BD';

      // Journey session for this ctxId, used ONLY as a fallback for signals the
      // order request did not carry itself (one indexed lookup, no join).
      const sessionFallback = dto.trackingSessionId        ? await tx.marketingSession.findUnique({
            where: { sessionToken: dto.trackingSessionId },
            select: {
              utmSource: true,
              utmMedium: true,
              utmCampaign: true,
              utmContent: true,
              utmTerm: true,
              referrer: true,
              landingUrl: true,
              clickId: true,
              fbclid: true,
              ip: true,
              userAgent: true,
              startedAt: true,
            },
          })
        : null;

      // Configured attribution window (days). Read once per order — a single
      // indexed settings lookup — and only ever recorded on the snapshot.
      const windowSetting = await tx.systemSetting.findUnique({
        where: { key: 'attribution_window_days' },
      });
      const attributionWindowDays = Number(windowSetting?.value) || null;

      // Immutable attribution snapshot (see order-attribution-snapshot.ts).
      // The order payload wins; the journey session is a server-side fallback so
      // a request that carried no signals of its own still records what the
      // session knew (utm/click id/referrer/ip/ua) at order time.
      const attributionSnapshot = buildOrderAttributionSnapshot({
        attribution: dto.attribution as Record<string, any> | null,
        device: (dto as any).device ?? null,
        sessionToken: dto.trackingSessionId ?? null,
        ip: clientIp ?? null,
        userAgent: userAgent ?? null,
        session: sessionFallback,
        resolved: webAttribution,
        sessionStartedAt: sessionFallback?.startedAt ?? null,
        attributionWindowDays: attributionWindowDays,
      });

      const created = await tx.order.create({
        data: {
          displayId,
          customerId: dto.customerId ?? null,
          statusId: initialStatus.id,
          subtotal: finalSubtotal,
          shippingCharge: finalShippingCharge,
          shippingChargeOverridden: isShippingOverridden,
          selectedShippingOptionId: dto.selectedShippingOptionId || null,
          discount: effectiveDiscount,
          discountType: effectiveDiscountType,
          total: finalTotal,
          viewToken: randomUUID(),
          shippingAddress: {
            ...(typeof dto.shippingAddress === 'object' && dto.shippingAddress
              ? dto.shippingAddress
              : {}),
            district: dto.district,
            thana: dto.thana,
            // Canonical division for the selected district (single resolver).
            division: resolveDivision(dto.district) ?? undefined,
          },
          customerNotes: dto.customerNotes,
          officeNotes: resolvedOfficeNotes,
          // Order-owned billing snapshot. Stored ONLY when billing was actually
          // captured at checkout — never derived from shippingAddress, for this
          // order or any historical one.
          billingAddress:
            typeof dto.billingAddress === 'object' && dto.billingAddress
              ? dto.billingAddress
              : {},
          // Source dimension: a staff-created order is MANUAL, never a website
          // order. Before this, Order.source kept its ECOMMERCE default for
          // admin entries, so they were reported as (and ad-tracked like)
          // storefront orders. POS writes its own value in pos-orders.service.
          source: isStaffCreate ? OrderSource.MANUAL : OrderSource.ECOMMERCE,
          salesChannel: dto.salesChannel || 'WEBSITE',
          sourcePlatform: resolvedSourcePlatform,
          sourceType: resolvedSourceType,
          sourceEntity: dto.sourceEntity || null,
          // Canonical attribution dimensions. Derived through the shared
          // service so a new order and a backfilled historical order are
          // mapped by one set of rules. Missing/invalid values resolve to NULL
          // with a warning — an order is never rejected over attribution.
          channel: canonical.channel,
          channelEntity: canonical.channelEntity,
          sourceSlug: canonical.sourceSlug,
          acquisitionType: canonical.acquisitionType,
          // The new runtime writes canonical fields itself, so it marks the row
          // as mapped. That marker is what stops the historical backfill from
          // ever reprocessing it.
          channelMappedAt: new Date(),
          trackingSessionId: dto.trackingSessionId ?? null,
          // Frozen technical + attribution context (never updated afterwards).
          ipAddress: clientIp || null,
          userAgent: userAgent || null,
          attribution: (attributionSnapshot as any) ?? undefined,
          guestName: dto.guestName,
          guestPhone: dto.guestPhone,
          secondaryPhone: dto.secondaryPhone ?? null,
          // Order-time customer snapshot: order-owned historical record of the
          // customer data known when the order was placed. Independent from
          // CustomerProfile — a later profile change never alters it. Staff MAY
          // correct it explicitly via PUT /orders/:id customerInfo.
          customerEmail: orderTimeEmail,
          customerPhone: orderTimePhone,
          customerFirstName: orderTimeFirstName,
          customerLastName: orderTimeLastName,
          customerCity: orderTimeCity,
          customerState: orderTimeState,
          customerZip: orderTimeZip,
          customerCountry: orderTimeCountry,
          paymentOptionType: dto.paymentOptionType,
          paymentStatus:
            dto.paymentOptionType === 'CASH_ON_DELIVERY'
              ? PaymentStatus.UNPAID
              : dto.paymentOptionType === 'PARTIAL_PAYMENT' && isStaffCreate && dto.partialAmount && Number(dto.partialAmount) > 0
                ? (Number(dto.partialAmount) >= Number(finalTotal) ? PaymentStatus.PAID : PaymentStatus.PARTIAL_PAID)
                : PaymentStatus.PAYMENT_PENDING,
          // Analytics cost capture (P2 §3.2): staff-entered fulfillment cost.
          ...resolveShippingCostFields(dto),
          partialAmount:
            dto.paymentOptionType === 'PARTIAL_PAYMENT'
              ? (dto.partialAmount ?? undefined)
              : undefined,
          items: {
            create: dto.items.map((i) => ({
              productId: i.productId,
              variantId: i.variantId,
              comboId: i.comboId,
              comboSelection: i.comboSelection || undefined,
              quantity: i.quantity,
              price: i.price,
            })),
          },
          timeline: [
            {
              status: initialStatus.name,
              timestamp: new Date().toISOString(),
              note: 'Order created',
              // Record WHO created the order — staff email for admin creates,
              // 'Customer' for guest storefront orders. The admin timeline UI
              // reads performedBy to render the actor badge.
              performedBy: user?.email || 'Customer',
            },
          ] as any,
        },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          status: true,
          items: {
            include: {
              product: { select: { id: true, name: true, images: true } },
            },
          },
        },
      });

      // Incomplete-leads supersede (business rule): a customer who successfully
      // placed an order is no longer an "incomplete lead".
      //
      // DECISION #1 — CUSTOMER-LEVEL FOLLOW-UP (intentional, not a bug):
      // Incomplete Leads exist to convert an abandoned customer into a customer —
      // they are NOT a product-specific sales-opportunity tracker. So once the
      // customer has successfully ordered, the follow-up objective is fulfilled and
      // EVERY prior PENDING lead closes (SUPERSEDED), even if it was for a different
      // product (the 10am abandon + 12pm abandon + 3pm order scenario: both close).
      // Matching:
      //   (1) ctxId  — same checkout session (precise, primary, UNLIMITED window:
      //                a session is recent by definition).
      //   (2) phone  — order guest/customer phone (fallback). DECISION #2: this is
      //                TIME-BOUNDED to a configurable window (default 7 days,
      //                setting `checkout_lead_supersede_phone_window_days`) so a
      //                very old lead is never accidentally superseded by a new order.
      // Edge cases: CONVERTED / NOT_CONVERTED / DELETED leads are never touched; an
      // order with neither ctxId nor a phone closes nothing. The phone fallback is a
      // SILENT supersede (not a conversion) and carries the shared-phone tradeoff.
      //
      // This is a SILENT close (status SUPERSEDED): NOT a conversion — no
      // convertedOrderId/convertedAt, no conversion tracking event. Manual recovery
      // via convertToOrder remains the ONLY path that marks a lead CONVERTED.
      if (
        created.trackingSessionId ||
        created.guestPhone ||
        created.customerId
      ) {
        const phones: string[] = [];
        if (created.guestPhone) phones.push(created.guestPhone);
        if (created.customerId) {
          const profile = await tx.customerProfile.findUnique({
            where: { id: created.customerId },
            select: { phone: true },
          });
          if (profile?.phone) phones.push(profile.phone);
        }
        const uniquePhones = Array.from(new Set(phones));

        // DECISION #2 — phone-fallback window (configurable, default 7 days).
        const windowSetting = await tx.systemSetting.findUnique({
          where: { key: 'checkout_lead_supersede_phone_window_days' },
        });
        const phoneWindowDays = Number(windowSetting?.value || 7);
        const phoneCutoff = new Date(
          Date.now() - Math.max(0, phoneWindowDays) * 86400000,
        );

        const leadWhere = {
          status: 'PENDING',
          OR: [
            ...(created.trackingSessionId
              ? [{ ctxId: created.trackingSessionId }]
              : []),
            ...(uniquePhones.length
              ? [
                  {
                    phone: { in: uniquePhones },
                    lastSeenAt: { gte: phoneCutoff },
                  },
                ]
              : []),
          ],
        };
        await tx.checkoutLead.updateMany({
          where: leadWhere,
          data: { status: 'SUPERSEDED' },
        });
      }

      if (dto.paymentOptionType) {
        if (
          isStaffCreate &&
          dto.paymentOptionType === 'PARTIAL_PAYMENT' &&
          dto.partialAmount &&
          Number(dto.partialAmount) > 0
        ) {
          const advancePaid = Number(dto.partialAmount);
          const advanceGateway = dto.gatewayCode || 'cash';
          await tx.payment.create({
            data: {
              orderId: created.id,
              gatewayCode: advanceGateway,
              amount: advancePaid,
              status: PaymentStatus.PAID,
              verifiedAt: new Date(),
              verifiedBy: userId,
              notes: 'Advance payment collected during order creation',
            },
          });
          // D-C actuals-only ledger: the uncollected remainder is DERIVED
          // (total − ΣPAID), never a placeholder row. The courier collects
          // against the derived due; settlement import writes the real PAID
          // row when the money arrives.
        } else {
          // D-C actuals-only ledger: order creation records NO payment row
          // unless money was actually received (the staff-partial advance
          // above). COD cash and in-progress online intents leave no row —
          // the due stays derived (total − ΣPAID) and real money enters via
          // the payment endpoints / gateway callbacks.
        }
      }

      const phoneToClose = dto.guestPhone || created.customer?.phone;
      if (phoneToClose) {
        await tx.checkoutLead.updateMany({
          where: { phone: phoneToClose, status: 'PENDING' },
          data: {
            status: 'CONVERTED',
            convertedOrderId: created.id,
            convertedAt: new Date(),
          },
        });
      }

      // Coupon usage increment — in the same transaction as order creation.
      if (couponRow) {
        await tx.coupon.update({
          where: { id: couponRow.id },
          data: { usedCount: { increment: 1 } },
        });
        await tx.couponUsage.create({
          data: {
            couponId: couponRow.id,
            orderId: created.id,
            userId: dto.customerId || null,
            discount: effectiveDiscountMonetary,
          },
        });
      }

      for (const item of dto.items) {
        const createdItem = created.items.find((ci) => {
          if (item.comboId) {
            return ci.comboId === item.comboId;
          }
          return (
            ci.productId === item.productId &&
            (ci.variantId ?? undefined) === (item.variantId ?? undefined)
          );
        });

        if (item.comboId && createdItem) {
          const combo = await tx.combo.findUnique({
            where: { id: item.comboId },
            include: { items: true },
          });
          if (combo) {
            for (const ci of combo.items) {
              const resolvedVariantId =
                ci.variantId ||
                (item.comboSelection as Record<string, string> | null)?.[
                  ci.productId
                ] ||
                null;
              const unitQty = ci.quantity;
              const totalQty = unitQty * item.quantity;

              const snapshot = await tx.orderItemComboComponent.create({
                data: {
                  orderItemId: createdItem.id,
                  comboItemId: ci.id,
                  productId: ci.productId,
                  variantId: resolvedVariantId,
                  unitQuantity: unitQty,
                  totalQuantity: totalQty,
                  managedStockReserved: false,
                  managedStockDeducted: false,
                },
                include: { product: true },
              });

              if (
                snapshot.product.availabilityMode === 'MANAGED_STOCK' &&
                snapshot.product.manageStock
              ) {
                await this.stockService.operate('reserve', {
                  productId: snapshot.productId,
                  variantId: snapshot.variantId ?? undefined,
                  quantity: snapshot.totalQuantity,
                  reference: `Order create: ${displayId}`,
                  performedBy: 'system',
                  tx,
                });
                await tx.orderItemComboComponent.update({
                  where: { id: snapshot.id },
                  data: { managedStockReserved: true },
                });
              }

              // Physical reservation for INVENTORY_CONTROLLED combo components at order creation
              if (
                snapshot.product.availabilityMode === 'INVENTORY_CONTROLLED'
              ) {
                const imEnabled =
                  await this.stockRouter.isInventoryManagementEnabled();
                if (imEnabled) {
                  const decision = this.stockRouter.resolve(
                    snapshot.product.availabilityMode,
                    'reserve',
                    imEnabled,
                    snapshot.product.syncManagedStock ?? undefined,
                  );
                  if (decision.pi === 'allocate') {
                    let cycle = await tx.orderStockCycle.findFirst({
                      where: { orderId: created.id, status: 'ACTIVE' },
                    });
                    if (!cycle) {
                      cycle = await tx.orderStockCycle.create({
                        data: { orderId: created.id, status: 'ACTIVE' },
                      });
                    }

                    let wh = snapshot.product.warehouseId;
                    if (!wh) {
                      const firstStock = await tx.physicalInventory.findFirst({
                        where: {
                          productId: snapshot.productId,
                          variantId: snapshot.variantId || null,
                        },
                        select: { warehouseId: true },
                      });
                      if (firstStock) wh = firstStock.warehouseId;
                    }

                    if (wh) {
                      const existingPi = await tx.physicalInventory.findFirst({
                        where: {
                          productId: snapshot.productId,
                          variantId: snapshot.variantId || null,
                          warehouseId: wh,
                        },
                      });
                      if (existingPi) {
                        const availablePhysical =
                          existingPi.quantity - existingPi.reservedQuantity;
                        if (availablePhysical < snapshot.totalQuantity) {
                          throw new BadRequestException(
                            `Insufficient physical stock for "${snapshot.product.name}" in combo. Available: ${availablePhysical}, needed: ${snapshot.totalQuantity}.`,
                          );
                        }
                        await this.stockService.reservePhysicalAllocated({
                          orderId: created.id,
                          cycleId: cycle.id,
                          comboComponentId: snapshot.id,
                          productId: snapshot.productId,
                          variantId: snapshot.variantId ?? undefined,
                          warehouseId: wh,
                          quantity: snapshot.totalQuantity,
                          tx,
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        } else if (createdItem) {
          await this.resolveAndApplyStock(
            'reserve',
            item.productId,
            item.variantId,
            item.quantity,
            displayId,
            tx,
            {
              orderId: created.id,
              orderItemId: createdItem.id,
            },
          );
        }
      }

      // Customer-owned side effects of the order, inside the same transaction.
      if (created.customerId) {
        // Latest-order telemetry. The guard lives in the WHERE clause so the
        // max-semantics are evaluated atomically by Postgres — a read-then-write
        // check would race, letting an older order that commits late overwrite
        // a newer order's telemetry. IP and timestamp are written under one
        // guard so they can never disagree. A tie keeps the incumbent.
        await tx.customerProfile.updateMany({
          where: {
            id: created.customerId,
            OR: [{ lastOrderAt: null }, { lastOrderAt: { lt: created.createdAt } }],
          },
          data: {
            lastOrderAt: created.createdAt,
            lastOrderIp: clientIp || null,
          },
        });

        // Enrich the customer's reusable address book. Never destructive: a new
        // address is added, an already-known one is reused, nothing is replaced
        // or deleted, and the order's own snapshots are never touched.
        await this.customerAddressService.syncFromOrder(tx, {
          customerProfileId: created.customerId,
          shippingAddress: created.shippingAddress,
          billingAddress: created.billingAddress,
          orderId: created.id,
        });
      }

      // Capture the purchase snapshot inside the same transaction as the order
      // insert (idempotent). DB errors propagate and roll back the entire
      // transaction — a committed order MUST have a durable Purchase intent.
      const orderWithItems = await tx.order.findUnique({
        where: { id: created.id },
        include: {
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  category: { select: { name: true } },
                },
              },
              combo: { select: { id: true, name: true } },
              variant: { select: { id: true, sku: true } },
            },
          },
          payments: true,
        },
      });
      if (orderWithItems) {
        await this.firePurchaseInstant(
          orderWithItems as any,
          tx,
          preloadedPurchaseSettings,
        );
        // OrderPlaced fires at receipt ONLY when no instant Purchase fired —
        // an instant Purchase already signals receipt (same modes gate as
        // firePurchaseInstant). Validated-mode orders get OrderPlaced now and
        // Purchase later at the configured status. Isolated: capture failure
        // can never roll back the created order.
        const instantFired =
          (preloadedPurchaseSettings['tracking_meta_purchase_mode'] ||
            'instant') === 'instant' ||
          (preloadedPurchaseSettings['tracking_tiktok_purchase_mode'] ||
            'instant') === 'instant';
        if (!instantFired) {
          try {
            await this.fireOrderPlacedEvent(orderWithItems as any, tx);
          } catch (err) {
            this.logger.error(
              `Failed to capture OrderPlaced snapshot for order ${created.id}:`,
              err,
            );
          }
        }
      }

      return created;
    });

    this.security.recordOrder(dto.guestPhone || '', clientIp || '');

    // Deterministic marketing attribution (best-effort, never breaks ordering):
    // maps the order's stored landing signals to a matched campaign/session.
    if (this.marketingAttribution) {
      this.marketingAttribution
        .resolveFromOrder(order.id, {
          sourcePlatform: order.sourcePlatform,
          sourceType: order.sourceType,
          sourceEntity: order.sourceEntity,
          trackingSessionId: order.trackingSessionId,
          attribution: dto.attribution as any,
        })
        .catch((err) => {
          this.logger.error(
            `Marketing attribution resolution failed for order ${order.id}:`,
            err,
          );
        });
    }

    if (dto.couponCode) {
      await this.couponsService.apply(
        dto.couponCode,
        order.id,
        undefined,
        dto.discount || 0,
      );
    }

    this.events.emit({
      type: 'order.created',
      data: { id: order.id, displayId: order.displayId },
    });

    if (warnings.length > 0) {
      (order as any).warnings = warnings;
    }

    await this.invalidateAnalytics();
    // Harmless no-op when no dispatch exists yet (recompute skips the order).
    await this.refreshCodAlert(order.id);
    return order;
  }

  /**
   * Managed-stock availability gate mirroring feed._availableStock
   * (managedStockQuantity - reservedStock). Only MANAGED_STOCK mode is
   * checked here: ALWAYS_IN_STOCK is unlimited, ALWAYS_OUT_OF_STOCK is
   * rejected earlier, and the physical (INVENTORY_CONTROLLED) engine already
   * throws on insufficient physical stock at reservation time.
   */
  private assertManagedAvailability(opts: {
    name: string;
    availabilityMode?: string | null;
    managedStockQuantity: number | null;
    reservedStock: number | null;
    quantity: number;
  }) {
    if (opts.availabilityMode !== 'MANAGED_STOCK') return;
    const available =
      (opts.managedStockQuantity ?? 0) - (opts.reservedStock ?? 0);
    if (available <= 0) {
      throw new BadRequestException(
        `Product "${opts.name}" is out of stock and cannot be ordered`,
      );
    }
    if (opts.quantity > available) {
      throw new BadRequestException(
        `Only ${available} unit(s) of "${opts.name}" are in stock (requested ${opts.quantity})`,
      );
    }
  }

  async updateOrder(
    id: string,
    dto: UpdateOrderDto,
    opts?: { userId?: string; performedBy?: string },
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        status: { select: { name: true } },
        items: {
          include: {
            product: {
              select: { id: true, name: true, availabilityMode: true },
            },
          },
        },
      },
    });
    if (!order || order.trashedAt)
      throw new NotFoundException('Order not found');

    // Edit-lock write gate: a live lock held by another staff member blocks
    // saving. The UI surfaces the holder and offers the override flow; after
    // override the requester holds the lock and writes succeed.
    if (opts?.userId) {
      const live = await this.editLock.getLock(id);
      if (live && live.userId !== opts.userId) {
        throw new ConflictException({
          statusCode: 409,
          code: 'ORDER_LOCKED',
          message: live.userName
            ? `This order is currently being edited by ${live.userName}. Take over the edit lock before saving.`
            : 'This order is currently being edited by another staff member. Take over the edit lock before saving.',
          lock: live,
        });
      }
    }

    // Item-edit status gate. Non-item edits (notes, shipping, payment, customer
    // details) stay available in every status — only a supplied `items` array
    // re-reserves stock, and that is what this blocks.
    if (dto.items !== undefined) {
      this.assertItemsEditable(order.status?.name);
    }

    const timeline = [...this.parseTimeline(order.timeline)];
    const now = new Date().toISOString();
    const data: any = {};

    if (
      dto.shippingCharge !== undefined &&
      Number(dto.shippingCharge) !== Number(order.shippingCharge)
    ) {
      data.shippingChargeOverridden = true;
      timeline.push({
        type: 'shipping',
        visibility: 'public',
        timestamp: now,
        oldValue: Number(order.shippingCharge),
        newValue: Number(dto.shippingCharge),
        note: `Shipping: ৳${Number(order.shippingCharge)} → ৳${Number(dto.shippingCharge)}`,
      });
    }

    const discountChanged =
      dto.discount !== undefined &&
      Number(dto.discount) !== Number(order.discount);
    const discountTypeChanged =
      dto.discountType !== undefined && dto.discountType !== order.discountType;
    if (discountChanged || discountTypeChanged) {
      const logNewVal =
        dto.discount !== undefined
          ? Number(dto.discount)
          : Number(order.discount);
      const logType = dto.discountType || order.discountType;
      timeline.push({
        type: 'discount',
        visibility: 'public',
        timestamp: now,
        oldValue: Number(order.discount),
        newValue: logNewVal,
        discountType: logType,
        note: `Discount changed to ৳${logNewVal} (${logType})`,
      });
    }

    // An explicitly supplied `items: []` is a real instruction to clear the order,
    // so the test is `!== undefined` rather than "has rows". Omitting `items`
    // entirely still means "leave them alone".
    if (dto.items !== undefined) {
      // Build a detailed diff of item changes
      const oldMap = new Map(
        order.items.map((i: any) => {
          const key = i.variantId || i.productId || i.id;
          return [
            key,
            {
              productId: i.productId,
              variantId: i.variantId,
              quantity: i.quantity,
              price: Number(i.price),
              productName: i.product?.name,
            },
          ];
        }),
      );
      const changes: string[] = [];
      for (const newItem of dto.items) {
        const key = newItem.variantId || newItem.productId || '';
        const old = oldMap.get(key);
        if (!old) {
          changes.push(
            `Added: ${newItem.quantity}x ${newItem.productId?.slice(0, 8) || '?'} @ ৳${newItem.price}`,
          );
        } else if (
          old.quantity !== newItem.quantity ||
          old.price !== newItem.price
        ) {
          changes.push(
            `Updated: ${old.productName || old.productId?.slice(0, 8)} qty ${old.quantity}→${newItem.quantity}, price ৳${old.price}→৳${newItem.price}`,
          );
        }
        oldMap.delete(key);
      }
      for (const [_, old] of oldMap) {
        changes.push(
          `Removed: ${old.productName || old.productId?.slice(0, 8)} (${old.quantity}x @ ৳${old.price})`,
        );
      }
      timeline.push({
        type: 'items',
        visibility: 'public',
        timestamp: now,
        note: changes.length > 0 ? changes.join('; ') : 'Order items updated',
      });
    }

    const currentItems =
      dto.items !== undefined
        ? dto.items
        : order.items.map((i) => ({
            price: Number(i.price),
            quantity: i.quantity,
          }));
    const shipping =
      dto.shippingCharge !== undefined
        ? Number(dto.shippingCharge)
        : Number(order.shippingCharge);
    const discount =
      dto.discount !== undefined
        ? Number(dto.discount)
        : Number(order.discount);
    const discountType = dto.discountType || order.discountType || 'flat';
    const { subtotal, total } = this.recalculate(
      currentItems,
      shipping,
      discount,
      discountType,
    );
    data.subtotal = subtotal;
    data.total = total;
    data.timeline = timeline;

    if (dto.shippingCharge !== undefined && data.shippingCharge === undefined)
      data.shippingCharge = dto.shippingCharge;
    if (dto.shippingCost !== undefined) {
      const costFields = resolveShippingCostFields(dto);
      data.shippingCost = costFields.shippingCost;
      data.shippingCostSource = costFields.shippingCostSource;
      timeline.push({
        type: 'fulfillment-cost',
        // Internal cost figure — private even though neighbouring
        // customer-facing charge entries are public.
        visibility: 'private',
        timestamp: now,
        oldValue: order.shippingCost === null ? null : Number(order.shippingCost),
        newValue: costFields.shippingCost,
        shippingCostSource: costFields.shippingCostSource,
        note:
          costFields.shippingCost === null
            ? 'Fulfillment cost cleared (not recorded)'
            : `Fulfillment cost: ৳${costFields.shippingCost} (${costFields.shippingCostSource})`,
      });
    }
    if (dto.selectedShippingOptionId !== undefined)
      data.selectedShippingOptionId = dto.selectedShippingOptionId || null;
    if (dto.discount !== undefined) data.discount = dto.discount;
    if (dto.discountType !== undefined) data.discountType = dto.discountType;
    if (dto.customerNotes !== undefined) data.customerNotes = dto.customerNotes;
    if (dto.officeNotes !== undefined) data.officeNotes = dto.officeNotes;
    if (dto.shippingAddress !== undefined)
      data.shippingAddress = dto.shippingAddress;
    // Billing is an INDEPENDENT order-owned snapshot. Supplying it never
    // derives, clears, or overwrites the shipping snapshot, and omitting it
    // leaves the stored billing value exactly as it was — an absent key is not
    // an instruction to "fall back to shipping".
    if (dto.billingAddress !== undefined) data.billingAddress = dto.billingAddress;

    // First manual mutation takes ownership; an existing assignment is preserved.
    if (shouldAutoAssign(opts?.userId, order.assignedToId)) {
      data.assignedToId = opts!.userId;
      data.assignedAt = new Date();
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.items !== undefined) {
        // Release old items via router
        for (const item of order.items) {
          if (item.comboId) {
            // Release managed stock from each combo component snapshot
            const snapshots = await tx.orderItemComboComponent.findMany({
              where: { orderItemId: item.id },
              include: { product: true },
            });
            for (const snap of snapshots) {
              if (snap.managedStockReserved && !snap.managedStockDeducted) {
                await this.stockService.operate('release', {
                  productId: snap.productId,
                  variantId: snap.variantId ?? undefined,
                  quantity: snap.totalQuantity,
                  reference: `Order update release: ${order.displayId}`,
                  performedBy: 'system',
                  tx,
                });
              }
              // Physical reservation release (if any ACTIVE cycle reservation)
              // Cascade will delete ComboComponentPhysicalReservation when item is deleted,
              // but we must release the physicalInventory.reservedQuantity first
              const activePhysRes =
                await tx.comboComponentPhysicalReservation.findFirst({
                  where: { componentId: snap.id, status: 'ACTIVE' },
                  include: { allocations: true },
                });
              if (activePhysRes) {
                for (const alloc of activePhysRes.allocations) {
                  await tx.physicalInventory.update({
                    where: { id: alloc.physicalInventoryId },
                    data: { reservedQuantity: { decrement: alloc.quantity } },
                  });
                }
                await tx.comboComponentPhysicalReservation.update({
                  where: { id: activePhysRes.id },
                  data: { status: 'RELEASED' },
                });
              }
            }
          } else {
            const itemAny = item as any;
            // Skip managed stock release if already deducted (avoids double-decrement of reservedStock).
            // Physical reservation release (pi:'release') is safe either way — handles CONSUMED skip.
            if (!itemAny.managedStockDeducted) {
              await this.resolveAndApplyStock(
                'release',
                item.productId,
                item.variantId,
                item.quantity,
                order.displayId,
                tx,
                {
                  orderId: id,
                  orderItemId: item.id,
                },
              );
            }
          }
        }

        await tx.orderItem.deleteMany({ where: { orderId: id } });
        await tx.orderItem.createMany({
          data: dto.items.map((i) => ({
            orderId: id,
            productId: i.productId,
            variantId: i.variantId,
            comboId: i.comboId,
            comboSelection: i.comboSelection || undefined,
            quantity: i.quantity,
            price: i.price,
          })),
        });

        const newItems = await tx.orderItem.findMany({
          where: { orderId: id },
        });

        // Reserve stock for new items
        const newProductIds = Array.from(
          new Set(
            dto.items.filter((i) => i.productId).map((i) => i.productId!),
          ),
        );
        if (newProductIds.length > 0) {
          const newProducts = await tx.product.findMany({
            where: { id: { in: newProductIds } },
            select: {
              id: true,
              availabilityMode: true,
              name: true,
              type: true,
              managedStockQuantity: true,
              reservedStock: true,
            },
          });
          const outOfStock = newProducts.find(
            (p) => p.availabilityMode === 'ALWAYS_OUT_OF_STOCK',
          );
          if (outOfStock) {
            throw new BadRequestException(
              `Product "${outOfStock.name}" is out of stock and cannot be ordered`,
            );
          }
          // Managed-stock gate for direct product/variant lines (combos are
          // validated component-by-component in the reserve loop below).
          const newVariantIds = Array.from(
            new Set(
              dto.items
                .filter((i) => i.variantId && !i.comboId)
                .map((i) => i.variantId!),
            ),
          );
          const newVariants =
            newVariantIds.length > 0
              ? await tx.productVariant.findMany({
                  where: { id: { in: newVariantIds } },
                  select: {
                    id: true,
                    managedStockQuantity: true,
                    reservedStock: true,
                  },
                })
              : [];
          const newVariantMap = new Map(
            newVariants.map((v) => [v.id, v]),
          );
          const newProductMap = new Map(
            newProducts.map((p) => [p.id, p]),
          );
          for (const item of dto.items) {
            if (item.comboId) continue;
            const p = newProductMap.get(item.productId ?? '');
            if (!p) continue;
            if (item.variantId) {
              const v = newVariantMap.get(item.variantId);
              this.assertManagedAvailability({
                name: p.name,
                availabilityMode: p.availabilityMode,
                managedStockQuantity: v?.managedStockQuantity ?? 0,
                reservedStock: v?.reservedStock ?? 0,
                quantity: item.quantity,
              });
            } else {
              this.assertManagedAvailability({
                name: p.name,
                availabilityMode: p.availabilityMode,
                managedStockQuantity: p.managedStockQuantity ?? 0,
                reservedStock: p.reservedStock ?? 0,
                quantity: item.quantity,
              });
            }
          }
        }

        // Reserve stock for new items via router
        for (const item of dto.items) {
          const newItem = newItems.find((ni) => {
            if (item.comboId) return ni.comboId === item.comboId;
            return (
              ni.productId === item.productId &&
              (ni.variantId ?? undefined) === item.variantId
            );
          });

          if (item.comboId && newItem) {
            const combo = await tx.combo.findUnique({
              where: { id: item.comboId },
              include: { items: true },
            });
            if (combo) {
              for (const ci of combo.items) {
                const resolvedVariantId =
                  ci.variantId ||
                  (item.comboSelection as Record<string, string> | null)?.[
                    ci.productId
                  ] ||
                  null;
                const unitQty = ci.quantity;
                const totalQty = unitQty * item.quantity;

                const snapshot = await tx.orderItemComboComponent.create({
                  data: {
                    orderItemId: newItem.id,
                    comboItemId: ci.id,
                    productId: ci.productId,
                    variantId: resolvedVariantId,
                    unitQuantity: unitQty,
                    totalQuantity: totalQty,
                    managedStockReserved: false,
                    managedStockDeducted: false,
                  },
                  include: { product: true },
                });

                // variantId on combo components is a plain string (not an FK),
                // so fetch the resolved variant for the managed-stock gate.
                const compVariant = snapshot.variantId
                  ? await tx.productVariant.findUnique({
                      where: { id: snapshot.variantId },
                      select: {
                        managedStockQuantity: true,
                        reservedStock: true,
                      },
                    })
                  : null;

                if (
                  snapshot.product.availabilityMode === 'MANAGED_STOCK' &&
                  snapshot.product.manageStock
                ) {
                  // Managed-stock gate BEFORE reserving, so a zero/negative
                  // stock component fails the whole edit atomically.
                  this.assertManagedAvailability({
                    name: snapshot.product.name,
                    availabilityMode: 'MANAGED_STOCK',
                    managedStockQuantity:
                      compVariant?.managedStockQuantity ??
                      snapshot.product.managedStockQuantity ??
                      0,
                    reservedStock:
                      compVariant?.reservedStock ??
                      snapshot.product.reservedStock ??
                      0,
                    quantity: snapshot.totalQuantity,
                  });
                  await this.stockService.operate('reserve', {
                    productId: snapshot.productId,
                    variantId: snapshot.variantId ?? undefined,
                    quantity: snapshot.totalQuantity,
                    reference: `Order update reserve: ${order.displayId}`,
                    performedBy: 'system',
                    tx,
                  });
                  await tx.orderItemComboComponent.update({
                    where: { id: snapshot.id },
                    data: { managedStockReserved: true },
                  });
                }

                // Physical reservation for INVENTORY_CONTROLLED combo components at order update
                if (
                  snapshot.product.availabilityMode === 'INVENTORY_CONTROLLED'
                ) {
                  const imEnabled =
                    await this.stockRouter.isInventoryManagementEnabled();
                  if (imEnabled) {
                    const decision = this.stockRouter.resolve(
                      snapshot.product.availabilityMode,
                      'reserve',
                      imEnabled,
                      snapshot.product.syncManagedStock ?? undefined,
                    );
                    if (decision.pi === 'allocate') {
                      let cycle = await tx.orderStockCycle.findFirst({
                        where: { orderId: id, status: 'ACTIVE' },
                      });
                      if (!cycle) {
                        cycle = await tx.orderStockCycle.create({
                          data: { orderId: id, status: 'ACTIVE' },
                        });
                      }

                      let wh = snapshot.product.warehouseId;
                      if (!wh) {
                        const firstStock = await tx.physicalInventory.findFirst(
                          {
                            where: {
                              productId: snapshot.productId,
                              variantId: snapshot.variantId || null,
                            },
                            select: { warehouseId: true },
                          },
                        );
                        if (firstStock) wh = firstStock.warehouseId;
                      }

                      if (wh) {
                        const existingPi = await tx.physicalInventory.findFirst(
                          {
                            where: {
                              productId: snapshot.productId,
                              variantId: snapshot.variantId || null,
                              warehouseId: wh,
                            },
                          },
                        );
                        if (existingPi) {
                          const availablePhysical =
                            existingPi.quantity - existingPi.reservedQuantity;
                          if (availablePhysical < snapshot.totalQuantity) {
                            throw new BadRequestException(
                              `Insufficient physical stock for "${snapshot.product.name}" in combo. Available: ${availablePhysical}, needed: ${snapshot.totalQuantity}.`,
                            );
                          }
                          await this.stockService.reservePhysicalAllocated({
                            orderId: id,
                            cycleId: cycle.id,
                            comboComponentId: snapshot.id,
                            productId: snapshot.productId,
                            variantId: snapshot.variantId ?? undefined,
                            warehouseId: wh,
                            quantity: snapshot.totalQuantity,
                            tx,
                          });
                        }
                      }
                    }
                  }
                }
              }
            }
          } else if (newItem) {
            await this.resolveAndApplyStock(
              'reserve',
              item.productId,
              item.variantId,
              item.quantity,
              order.displayId,
              tx,
              {
                orderId: id,
                orderItemId: newItem.id,
              },
            );
          }
        }
      }

      if (dto.customerInfo) {
        // TWO SEPARATE OWNERSHIP OPERATIONS, deliberately independent:
        //
        //  1. The ORDER's own historical snapshot — always corrected. This is
        //     order-owned data; staff correcting an order is a sanctioned
        //     mutation of the order record, not a rewrite of history.
        //  2. The CANONICAL customer profile — only when staff explicitly opt
        //     in with `updateCustomerProfile: true`. This is customer-owned.
        //
        // Previously one blanket `customerProfile.update` did both, so
        // correcting a single order silently rewrote the real person's
        // canonical identity. The two are now separable and the profile write
        // is strictly partial.

        // IMPORTANT: `order.customerId` references a CustomerProfile row, NOT a
        // UserProfile. Editing order customer info must only ever touch
        // CustomerProfile (what Order.customer relation reads) — never
        // UserProfile, which would accidentally overwrite a logged-in staff
        // member's own identity when ids collide across the two tables.
        const firstName = dto.customerInfo.firstName;
        const lastName = dto.customerInfo.lastName;
        const nameProvided = firstName !== undefined || lastName !== undefined;
        const nextFirstName = nameProvided ? String(firstName ?? '').trim() : undefined;
        const nextLastName = nameProvided ? String(lastName ?? '').trim() : undefined;

        // ---- Operation 2: canonical profile, opt-in only, strictly partial ----
        // Requires an existing profile link. A guest order has no
        // CustomerProfile row, and editing one order must never fabricate one —
        // that would silently merge two identities. Guests keep their edit on
        // the order-owned snapshot below and nothing more.
        if (order.customerId && dto.updateCustomerProfile) {
          const customerData: Record<string, string> = {};
          // Only an explicitly supplied name pair writes a name. Omitting the
          // field preserves the stored value rather than blanking it.
          if (nameProvided) {
            const full = [nextFirstName, nextLastName].filter(Boolean).join(' ');
            if (full) customerData.name = full;
          }
          if (dto.customerInfo.phoneNumber !== undefined) {
            const normalized = normalizePhone(dto.customerInfo.phoneNumber);
            if (!normalized) {
              throw new BadRequestException('Invalid phone number');
            }
            const phoneOwner = await tx.customerProfile.findFirst({
              where: { phone: normalized, id: { not: order.customerId } },
              select: { id: true },
            });
            if (phoneOwner) {
              throw new ConflictException(
                'This phone number is already registered to another customer.',
              );
            }
            customerData.phone = normalized;
          }
          if (dto.customerInfo.email !== undefined) {
            const email = String(dto.customerInfo.email).trim();
            if (email) customerData.email = email;
          }
          if (Object.keys(customerData).length > 0) {
            await tx.customerProfile.update({
              where: { id: order.customerId },
              data: customerData,
            });
          }
        }

        // ---- Operation 1: the order's own snapshot, always corrected ----
        const snapshotUpdate: Record<string, string | null> = {};
        if (nameProvided) {
          snapshotUpdate.customerFirstName = nextFirstName || null;
          snapshotUpdate.customerLastName = nextLastName || null;
        }
        if (dto.customerInfo.email !== undefined) {
          snapshotUpdate.customerEmail = String(dto.customerInfo.email).trim() || null;
        }
        if (dto.customerInfo.phoneNumber !== undefined) {
          snapshotUpdate.customerPhone = normalizePhone(dto.customerInfo.phoneNumber) || null;
        }
        if (dto.customerInfo.secondaryPhone !== undefined) {
          // Secondary contact number (staff-entered, optional): normalized,
          // stored on the order snapshot and linked via CustomerPhone.
          // Owned by ANOTHER customer → 409 refuse (never merge). Null/blank
          // clears it. A secondary equal to the primary is redundant.
          const rawInput = dto.customerInfo.secondaryPhone;
          const rawSecondary = rawInput == null ? '' : String(rawInput).trim();
          const normalizedSecondary = rawSecondary ? normalizePhone(rawSecondary) : null;
          if (rawSecondary && !normalizedSecondary) {
            throw new BadRequestException(
              'Invalid secondary phone number format. Use 01XXXXXXXXX or +8801XXXXXXXXX.',
            );
          }
          const primaryPhone =
            (dto.customerInfo.phoneNumber !== undefined
              ? normalizePhone(dto.customerInfo.phoneNumber)
              : null) ||
            order.customerPhone ||
            (!order.customerId ? order.guestPhone : null);
          if (normalizedSecondary && normalizedSecondary === primaryPhone) {
            data.secondaryPhone = null;
          } else {
            data.secondaryPhone = normalizedSecondary;
          }
          if (normalizedSecondary && order.customerId) {
            const owner = await tx.customerPhone.findUnique({
              where: { phone: normalizedSecondary },
              select: { customerProfileId: true },
            });
            if (owner && owner.customerProfileId !== order.customerId) {
              throw new ConflictException(
                'This phone number is already linked to another customer.',
              );
            }
            if (!owner) {
              await tx.customerPhone.create({
                data: {
                  customerProfileId: order.customerId,
                  phone: normalizedSecondary,
                  source: 'secondary',
                },
              });
            }
          }
        }
        // Written directly (not via `?? undefined`, which silently dropped an
        // intentional blank) so an explicit correction is always persisted.
        if (Object.keys(snapshotUpdate).length > 0) {
          Object.assign(data, snapshotUpdate);
        }

        // Guest orders carry no CustomerProfile, so several readers still fall back
        // to the legacy guest* columns. Correct them alongside the snapshot or
        // the same correction would read differently depending on which column
        // the caller looks at. NOTE: Order has no `guestEmail` — email lives
        // only in `customerEmail`, which the snapshot block above already sets.
        if (!order.customerId) {
          if (nameProvided) {
            const full = [nextFirstName, nextLastName].filter(Boolean).join(' ');
            data.guestName = full || null;
          }
          if (dto.customerInfo.phoneNumber !== undefined) {
            const normalized = normalizePhone(dto.customerInfo.phoneNumber);
            data.guestPhone = normalized || null;
          }
        }
      }

      // Payment editing — mirrors create() semantics so staff can switch
      // COD ↔ full online payment ↔ partial payment and pick the gateway.
      // Money already collected is a FACT: PAID rows are never rewritten.
      // The editable surface is the outstanding balance row only.
      // (Test doubles predate the aggregate call — the optional chain keeps
      // them green; production Prisma always has aggregate.)
      const paidAgg =
        typeof tx.payment?.aggregate === 'function'
          ? await tx.payment.aggregate({
              _sum: { amount: true },
              where: { orderId: id, status: PaymentStatus.PAID },
            })
          : null;
      const collectedPaid = Number(paidAgg?._sum?.amount || 0);
      const orderTotal = Number(data.total ?? order.total);
      if (dto.paymentOptionType) {
        // Effective advance for PARTIAL edits: an untouched amount field
        // keeps the stored advance (a no-op save must not move money).
        const advance =
          dto.paymentOptionType === 'PARTIAL_PAYMENT'
            ? (dto.partialAmount !== undefined
                ? Number(dto.partialAmount)
                : Number(order.partialAmount || 0))
            : 0;
        if (dto.paymentOptionType === 'PARTIAL_PAYMENT') {
          if (
            dto.partialAmount !== undefined &&
            (dto.partialAmount <= 0 || dto.partialAmount > orderTotal)
          ) {
            throw new BadRequestException(
              'Partial payment amount must be greater than 0 and not exceed the order total',
            );
          }
          if (advance < collectedPaid) {
            throw new BadRequestException(
              `৳${collectedPaid} is already collected on this order — record a refund to lower the advance below it.`,
            );
          }
          data.partialAmount = dto.partialAmount !== undefined ? dto.partialAmount : order.partialAmount;
        } else if (collectedPaid > 0 && dto.paymentOptionType !== order.paymentOptionType) {
          // Leaving PARTIAL (or any mode) with collected money would strand
          // the PAID rows against a contradictory status — refund first.
          throw new BadRequestException(
            `৳${collectedPaid} is already collected on this order — record a refund before changing the payment mode.`,
          );
        } else {
          // Non-partial mode (and we got past the collected-money guard):
          // no advance lives on the order.
          data.partialAmount = null;
        }
        data.paymentOptionType = dto.paymentOptionType;
        if (dto.paymentOptionType === 'PARTIAL_PAYMENT' && collectedPaid > 0) {
          // Collected money stays collected: status follows the rows, not
          // the mode switch.
          data.paymentStatus =
            collectedPaid >= orderTotal ? PaymentStatus.PAID : PaymentStatus.PARTIAL_PAID;
        } else {
          data.paymentStatus =
            dto.paymentOptionType === 'CASH_ON_DELIVERY'
              ? PaymentStatus.UNPAID
              : PaymentStatus.PAYMENT_PENDING;
        }
        // data.partialAmount preserved above for untouched partial edits.
        data.timeline = [
          ...timeline,
          {
            type: 'payment',
            visibility: 'public',
            timestamp: now,
            note: `Payment updated to ${dto.paymentOptionType.replace(/_/g, ' ').toLowerCase()}${dto.gatewayCode ? ` via ${dto.gatewayCode}` : ''}${dto.paymentOptionType === 'PARTIAL_PAYMENT' && dto.partialAmount ? ` (৳${dto.partialAmount})` : ''}.`,
          },
        ];

        // The editable row is the OUTSTANDING balance (total − advance),
        // never the advance itself: collected money is already a fact.
        const paymentAmount =
          dto.paymentOptionType === 'PARTIAL_PAYMENT'
            ? Math.max(0, orderTotal - advance)
            : Number(data.total ?? order.total);
        const gatewayCode =
          dto.gatewayCode ||
          (dto.paymentOptionType === 'CASH_ON_DELIVERY' ? 'cash' : undefined);
        if (gatewayCode) {
          // Update the earliest non-finalized payment row rather than piling
          // up duplicates; only create when the order has no payment row yet.
          const existing = await tx.payment.findFirst({
            where: {
              orderId: id,
              status: {
                notIn: [
                  PaymentStatus.PAID,
                  PaymentStatus.PARTIAL_PAID,
                  PaymentStatus.REFUNDED,
                  PaymentStatus.PARTIAL_REFUNDED,
                  PaymentStatus.CANCELLED,
                  // D-C: legacy cash/UNPAID placeholders are VOID-marked, never
                  // money — skip them like every other terminal row.
                  PaymentStatus.VOID,
                ],
              },
            },
            orderBy: { createdAt: 'asc' },
          });
          if (existing) {
            if (paymentAmount <= 0) {
              // Append-only ledger: NEVER delete. The lingering balance row
              // is neutralized by a full-reversal correction row (negative of
              // the original) with a reason — an INSERT, so no S2 gate.
              const actor =
                opts?.userId != null ? `staff:${opts.userId}` : null;
              await tx.payment.create({
                data: {
                  orderId: id,
                  gatewayCode: existing.gatewayCode,
                  amount: -Number(existing.amount),
                  status: existing.status,
                  notes: `Reversal of payment ${existing.id}: advance covers the full bill — auto-reversal entry, original row retained.`,
                  recordedBy: actor,
                  submittedBy: actor,
                  recordedAt: new Date(),
                },
              });
            } else {
              const amountChanged =
                Number(existing.amount) !== paymentAmount;
              const gatewayChanged = existing.gatewayCode !== gatewayCode;
              if (amountChanged || gatewayChanged) {
                // S2 gate (default OFF): direct amount/account edits are
                // forbidden — staff record a correction entry instead.
                // D (owner-locked): resolve for the row's gateway — a
                // per-gateway tri-state override wins over the global default.
                const paymentSettings = await resolveEffectivePaymentSettings(
                  tx as any,
                  existing.gatewayCode,
                );
                if (!paymentSettings.editAllowed) {
                  throw new ForbiddenException(
                    'Payment editing is disabled — record a correction entry instead',
                  );
                }
                const oldRow = {
                  gatewayCode: existing.gatewayCode,
                  amount: Number(existing.amount),
                  status: existing.status,
                };
                const newStatus =
                  gatewayCode === 'cash'
                    ? PaymentStatus.UNPAID
                    : PaymentStatus.PENDING;
                await tx.payment.update({
                  where: { id: existing.id },
                  data: {
                    gatewayCode,
                    amount: paymentAmount,
                    status: newStatus,
                  },
                });
                // S2-ON direct edits stay auditable: append old → new + by.
                const editedBy =
                  opts?.userId ?? opts?.performedBy ?? 'staff';
                data.timeline = [
                  ...((data.timeline as any[]) ?? timeline),
                  {
                    type: 'payment',
                    visibility: 'internal',
                    timestamp: now,
                    note: `Payment row edited ৳${oldRow.amount} → ৳${paymentAmount} (${oldRow.gatewayCode} → ${gatewayCode}) by ${editedBy}.`,
                    old: oldRow,
                    new: {
                      gatewayCode,
                      amount: paymentAmount,
                      status: newStatus,
                    },
                    by: editedBy,
                    at: now,
                  },
                ];
              }
              // No-op save (identical amount + gateway): leave the row
              // untouched — no write, no audit, no 403.
            }
          } else {
            const paidRows = await tx.payment.count({
              where: { orderId: id, status: PaymentStatus.PAID },
            });
            if (paidRows > 0) {
              throw new BadRequestException(
                'Payment was already completed — change the gateway via a refund instead of editing the order',
              );
            }
            // D-C actuals-only ledger: switching the method with no money
            // received records nothing — no UNPAID/PENDING placeholder. The
            // due stays derived (total − ΣPAID); real money enters via the
            // payment endpoints.
          }
        }
      }

      return tx.order.update({
        where: { id },
        data,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          status: true,
          shipment: true,
          assignee: { select: { id: true, firstName: true, lastName: true } },
          items: {
            include: {
              product: {
                select: { id: true, name: true, images: true, slug: true },
              },
            },
          },
          payments: true,
          dispatches: { orderBy: { createdAt: 'desc' } },
        },
      });
    });
    await this.invalidateAnalytics();
    // Order edit changes the collectable (total/shipping/discount) — refresh
    // the post-dispatch COD alert (Feature A, resilient no-op if no dispatch).
    await this.refreshCodAlert(id);
    return updated;
  }

  async addNote(
    orderId: string,
    note: string,
    visibility: 'public' | 'private',
    userId: string,
    performedBy?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order || order.trashedAt)
      throw new NotFoundException('Order not found');

    const timeline = [
      ...this.parseTimeline(order.timeline),
      {
        type: 'note',
        visibility,
        timestamp: new Date().toISOString(),
        note,
        performedBy: performedBy || userId,
      },
    ];

    return this.prisma.order.update({
      where: { id: orderId },
      data: { timeline: timeline as any },
      include: {
        status: true,
        customer: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Optional `tx` lets a caller compose this status change into a larger
   * transaction (the packing workspace couples it with releasing the order's
   * packing lock, which must not be left behind if the status write fails).
   * When omitted the method runs in its own transaction, as before.
   */
  /**
   * Task 9 (D5) cancel/refund gate — single source of truth, shared with
   * refunds.service: outstanding = netPaid − legacyRefunded, where netPaid is
   * Σ signed PAID payment rows (Task 5 negative corrections included) and
   * legacyRefunded is Σ approved/completed Refund rows with method NULL
   * (recorded before ledger mirroring; every new-flow refund carries method
   * + a matching negative payment row, so counting new rows here would
   * double-count — they are counted via the ledger instead).
   */
  private async outstandingRefundableBalance(
    orderId: string,
    client?: Prisma.TransactionClient,
  ): Promise<number> {
    const db = client ?? this.prisma;
    const [paidAgg, legacyAgg] = await Promise.all([
      db.payment.aggregate({
        where: { orderId, status: 'PAID' },
        _sum: { amount: true },
      }),
      db.refund.aggregate({
        where: {
          orderId,
          status: { in: ['approved', 'completed'] },
          method: null,
        },
        _sum: { amount: true },
      }),
    ]);
    const netPaid = Number((paidAgg as any)?._sum?.amount || 0);
    const legacyRefunded = Number((legacyAgg as any)?._sum?.amount || 0);
    return netPaid - legacyRefunded;
  }

  /**
   * Stable client contract: the admin matches `code` — never the message
   * text — to deep-link into the refund flow (see $id.tsx statusMut.onError).
   */
  static readonly CANCEL_REQUIRES_REFUND_CODE = 'CANCEL_REQUIRES_REFUND';

  private cancelBlockedMessage(outstanding: number): string {
    return (
      `This order has an outstanding paid balance of ${outstanding}. ` +
      `Record a refund first (the refund flow can cancel atomically via its ` +
      `cancel option), then cancel.`
    );
  }

  private async assertNoOutstandingForCancel(orderId: string): Promise<void> {
    const outstanding = await this.outstandingRefundableBalance(orderId);
    if (outstanding > 0) {
      throw new BadRequestException({
        message: this.cancelBlockedMessage(outstanding),
        code: OrdersService.CANCEL_REQUIRES_REFUND_CODE,
      });
    }
  }

  async updateStatus(
    id: string,
    dto: UpdateOrderStatusDto,
    userId: string,
    performedBy?: string,
    tx?: Prisma.TransactionClient,
    internalOpts?: { allowStaffPartialToDelivered?: boolean },
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { status: true },
    });
    if (!order || order.trashedAt)
      throw new NotFoundException('Order not found');

    const newStatus = await this.prisma.orderStatus.findUnique({
      where: { id: dto.statusId },
    });
    if (!newStatus) throw new NotFoundException('Status not found');

    // Task 5 (Fix 9, owner-locked Rule 15.4): the ONLY automated Partial →
    // Delivered path. confirmStaffPartialDelivered() verifies the open
    // staff-created PARTIAL Return fail-closed BEFORE setting this flag, so a
    // direct updateStatus caller can never smuggle it in via the DTO (the flag
    // is a method parameter, not request input).
    const staffPartialBypass =
      internalOpts?.allowStaffPartialToDelivered === true &&
      order.status.name === 'Partial' &&
      newStatus.name === 'Delivered';

    // AUTHORITATIVE RULE: 'Partial' is an automation-stopped state. Once an
    // order is Partial, only manual staff action may change its status —
    // courier webhooks, webhook replays, the manual courier sync and
    // reconciliation must never transition it. Manual staff members pass a
    // real user id and are unaffected.
    if (order.status.name === 'Partial' && isAutomatedActor(userId) && !staffPartialBypass) {
      throw new BadRequestException(
        'Order is Partial: automated processes cannot change its status. It must be changed manually.',
      );
    }

    const allowed = ORDER_TRANSITIONS[order.status.name] || [];
    // A dispatched order is cancelled by STAFF only (the directive's flow: the
    // dispatch is cancelled with the courier, then the order). An automated
    // actor (courier webhook, reconcile) must never cancel a shipped order.
    const dispatchedCancelByAutomation =
      newStatus.name === 'Cancelled' &&
      order.status.name === 'Shipping' &&
      isAutomatedActor(userId);
    if (
      !allowed.includes(newStatus.name) &&
      !staffPartialBypass &&
      !dispatchedCancelByAutomation
    ) {
      throw new BadRequestException(
        `Cannot transition from "${order.status.name}" to "${newStatus.name}". Allowed: ${allowed.join(', ') || 'none'}`,
      );
    }
    if (dispatchedCancelByAutomation) {
      throw new BadRequestException(
        'A dispatched order cannot be cancelled by an automated process — ' +
          'it must be cancelled by staff, which cancels the dispatch with the courier first.',
      );
    }

    // Task 9 (D5): cancel blocked while money is still out — refund first.
    if (newStatus.name === 'Cancelled') {
      await this.assertNoOutstandingForCancel(id);
    }

    // Cancel a DISPATCHED order (owner directive, 2026-10-21): the dispatch
    // is cancelled WITH THE COURIER first. The eligibility check + the
    // courier push happen BEFORE the transaction (an external, irreversible
    // call must never sit inside one); a courier failure aborts everything,
    // so the order and its dispatch stay exactly as they were. The dispatch
    // rows are flipped inside the order's own transaction (apply()).
    let dispatchPlan: DispatchCancelPlan | null = null;
    if (newStatus.name === 'Cancelled' && this.dispatchCancel) {
      dispatchPlan = await this.dispatchCancel.prepare(id, performedBy || userId);
    }

    // 'Returned' is a manual-confirmation-only status: it restores stock via
    // handleReturnedSideEffects, so automated actors (courier webhooks) must
    // never be able to reach it. Webhooks stop at 'Return Pending'.
    if (newStatus.name === 'Returned' && isAutomatedActor(userId)) {
      throw new BadRequestException(
        'Order cannot be marked Returned by an automated process — it must be manually confirmed from the order detail page.',
      );
    }

    // Task 4 (Fix 8): an exchange-linked original confirms Returned ONLY on
    // BOTH signals — its exchange order(s) delivered AND its Return(EXCHANGE)
    // leg(s) arrived. NEVER auto from an exchange event alone (automated
    // actors are already blocked above; this gates the staff path too).
    if (newStatus.name === 'Returned') {
      await this.assertExchangeReturnReady(id);
    }

    const timeline = [
      ...this.parseTimeline(order.timeline),
      {
        status: newStatus.name,
        oldStatus: order.status.name,
        timestamp: new Date().toISOString(),
        note: dto.note || '',
        performedBy: performedBy || userId,
      },
    ];

    // Runs inside either this method's own transaction or a caller-supplied one.
    const statusChange = async (client: Prisma.TransactionClient) => {
      const u = await client.order.update({
        where: { id },
        data: {
          statusId: dto.statusId,
          timeline: timeline as any,
          // First manual mutation takes ownership; an existing assignment is preserved.
          ...(shouldAutoAssign(userId, order.assignedToId)
            ? { assignedToId: userId, assignedAt: new Date() }
            : {}),
        },
        include: {
          status: true,
          customer: { select: { id: true, name: true } },
          payments: true,
        },
      });

      if (this.staffPerformance && (performedBy || userId)) {
        const actor = performedBy || userId;
        const action =
          newStatus.name === 'Confirmed'
            ? 'confirmed'
            : newStatus.name === 'Delivered'
              ? 'delivered'
              : newStatus.name === 'Returned'
                ? 'returned'
                : newStatus.name === 'Cancelled'
                  ? 'cancelled'
                  : 'status_change';
        await this.staffPerformance.recordStaffEvent(
          {
            orderId: id,
            userId: actor,
            action,
            fromStatus: order.status.name,
            toStatus: newStatus.name,
            note: dto.note || '',
          },
          client,
        );
      }

      if (newStatus.name === 'Confirmed') {
        await this.takeCostSnapshot(id, client);
        await this.verifyStockForOrder(id, client);
      }

      // A cancelled order released its reservation; a Confirmed order's
      // reservation may no longer be fully available. Hold must hold stock
      // again (throws when stock is no longer available). Idempotent: only
      // unreserved items are reserved, so a re-hold is a validation pass.
      if (
        newStatus.name === 'Hold' &&
        (order.status.name === 'Cancelled' || order.status.name === 'Confirmed')
      ) {
        await this.verifyStockForOrder(id, client);
      }

      if (newStatus.name === 'Cancelled') {
        await this.handleCancelledSideEffects(client, id, performedBy);
        // The dispatch is cancelled with the courier in the SAME transaction
        // as the order cancel (the courier push already succeeded above).
        if (dispatchPlan) {
          await this.dispatchCancel!.apply(
            client,
            dispatchPlan,
            performedBy || userId,
          );
        }
      }

      if (newStatus.name === 'Delivered') {
        await this.handleDeliveredSideEffects(client, u, performedBy || userId);
      }

      if (newStatus.name === 'Returned') {
        await this.handleReturnedSideEffects(client, id, performedBy);
      }

      if (newStatus.name === 'Return Pending') {
        // Business rule: 'Return Pending' never restores/releases stock and
        // HOLDS the reservation/deduction. Re-establish the reservation hold
        // consumed by the deduction (idempotent, RETURN_HOLD-ledged).
        await this.cancelReturnStock.holdReservationForReturnPending(id);
      }

      // Capture purchase/refund snapshots inside the same transaction as the
      // status update. firePurchaseValidated/fireRefundEvent self-gate on
      // settings; the block is wrapped so a capture-side failure can never roll
      // back the status change.
      try {
        const withItems = await client.order.findUnique({
          where: { id },
          include: {
            items: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    sku: true,
                    category: { select: { name: true } },
                  },
                },
                combo: { select: { id: true, name: true } },
                variant: { select: { id: true, sku: true } },
              },
            },
            customer: true,
            payments: true,
          },
        });
        if (withItems) {
          await this.firePurchaseValidated(
            newStatus.name,
            withItems as any,
            client,
          );
          // Order-lifecycle custom event for the genuine transition
          // (prev != new is guaranteed by the transition map above; the fire
          // method re-checks defensively). Unmapped statuses emit nothing.
          await this.fireOrderStatusLifecycleEvent(
            withItems as any,
            order.status.name,
            newStatus.name,
            client,
          );
          if (
            ['Cancelled', 'Returned', 'Return Pending'].includes(newStatus.name)
          ) {
            await this.fireRefundEvent(withItems as any, client);
          }
        }
      } catch (err) {
        this.logger.error(
          `Failed to capture tracking snapshot for order ${id}:`,
          err,
        );
      }

      return u;
    };

    const updated = tx
      ? await statusChange(tx)
      : await this.prisma.$transaction(statusChange);

    this.events.emit({
      type: 'order.status_changed',
      data: {
        id: updated.id,
        displayId: updated.displayId,
        statusId: dto.statusId,
        statusName: newStatus.name,
      },
    });

    // Commission Engine v2.
    //
    // Recorded for EVERY status transition, not just Confirmed: "first actor
    // wins" is only meaningful if the ledger holds every transition, because a
    // later transition into a status must be able to tell that it was not the
    // first. The engine decides whether this particular transition earns
    // anything; this call only supplies the event.
    //
    // Resilient — a commission failure must never roll back an order update.
    if (this.commissionEngine) {
      try {
        await this.commissionEngine.recordTransition({
          orderId: updated.id,
          fromStatus: order.status.name,
          toStatus: newStatus.name,
          actorUserId: userId ?? null,
          note: dto.note || null,
        });
      } catch (err) {
        this.logger.error(
          `Commission v2 evaluation failed for order ${updated.id} → ${newStatus.name}:`,
          err,
        );
      }
    }

    // Commission hook (decision #5): when an order reaches the Confirmed
    // status, evaluate its active commission rules. Resilient — never breaks
    // the order update on failure.
    if (updated.status.name === 'Confirmed') {
      try {
        await this.commissionsService.processOrderCommissions(updated.id);
      } catch (err) {
        this.logger.error(
          `Commission hook failed for confirmed order ${updated.id}:`,
          err,
        );
      }
    }

    // Commission reversal hook (G-01, decision D1): an order leaving the
    // pipeline as cancelled/returned reverses any approved earnings earned on
    // it (full reversal — the order is gone). Resilient — never breaks the
    // order update on failure.
    if (['Cancelled', 'Returned'].includes(updated.status.name)) {
      try {
        await this.commissionsService.reverseForOrder(
          updated.id,
          undefined,
          `Order ${updated.status.name.toLowerCase()}`,
        );
      } catch (err) {
        this.logger.warn(
          `Commission reversal hook failed for ${updated.status.name} order ${updated.id}:`,
          err,
        );
      }
    }

    await this.invalidateAnalytics();
    return updated;
  }

  /**
   * Task 5 (Fix 9, owner-locked Rule 15): staff-partial creation.
   *
   * Button 'Create Partial Return Order' on Shipping AND Partial orders →
   * creates Return(PARTIAL, items=marked products, source STAFF) → order →
   * Partial, DISPATCH UNCHANGED. There is deliberately NO dispatch write
   * anywhere in this method: a staff action never rewrites the dispatch
   * (locked by test — dispatch.update/updateMany/upsert/create uncalled).
   *
   * T4 rows adopted: the Return shape here is exactly ReturnsService.create's
   * standalone shape (RTN-YYMMDD-NNNN via the shared ReturnCounter), so rows
   * created by the T4 menu entry need no migration.
   *
   * - Shipping (no instantDelivery) → order → Partial via updateStatus.
   * - Already Partial (no instantDelivery) → Return created, status kept.
   * - instantDelivery → the kept remainder is already delivered: Shipping →
   *   Delivered via updateStatus (legal transition), Partial → Delivered via
   *   confirmStaffPartialDelivered (the Return created above satisfies its
   *   staff-Return check). A later courier partial webhook is then a no-op.
   */
  async createStaffPartialReturn(
    orderId: string,
    dto: { items: unknown; reason?: string; instantDelivery?: boolean },
    actor: { userId: string; email?: string },
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        status: true,
        items: { select: { productId: true, variantId: true, quantity: true } },
      },
    });
    if (!order || (order as any).trashedAt) {
      throw new NotFoundException('Order not found');
    }
    if ((order as any).kind === 'RETURN') {
      throw new BadRequestException(
        'A partial return cannot be created from a Return Order.',
      );
    }
    const statusName = (order as any)?.status?.name as string | undefined;
    if (!STAFF_PARTIAL_ALLOWED_STATUSES.includes(statusName as string)) {
      throw new BadRequestException(
        'A partial return can only be created from an order in Shipping or ' +
          `Partial status (current: ${statusName ?? 'unknown'}).`,
      );
    }
    const items = this.validateStaffPartialItems(
      dto.items,
      ((order as any).items ?? []) as {
        productId: string | null;
        variantId: string | null;
        quantity: number;
      }[],
    );

    // Hardening (1): the shared eligibility guard — an active FULL blocks a
    // second partial, and requested lines are capped at ordered − returned
    // (not just ordered). Courier-driven creation skips this on purpose (see
    // COURIER_GUARD_SKIP_REASON); staff creation never does.
    await assertReturnEligible(this.prisma, orderId, { type: 'PARTIAL', items });
    await assertNoDuplicateReturn(this.prisma, orderId, 'PARTIAL', items);

    const displayId = await this.generateStaffPartialDisplayId();
    const ret = await (this.prisma as any).return.create({
      data: {
        orderId,
        displayId,
        type: 'PARTIAL',
        status: 'REQUESTED',
        source: 'STAFF',
        items: items as unknown as Prisma.InputJsonValue,
        reason: dto.reason?.trim() ? dto.reason.trim() : null,
      },
    });
    this.logger.log(
      `Staff partial return ${displayId} created for order ${(order as any).displayId ?? orderId} ` +
        `by=${actor.email ?? actor.userId} (dispatch unchanged)`,
    );

    const performedBy = actor.email ?? actor.userId;
    if (dto.instantDelivery) {
      if (statusName === 'Shipping') {
        const delivered = await this.prisma.orderStatus.findUnique({
          where: { name: 'Delivered' },
        });
        if (!delivered) {
          throw new BadRequestException('Order status configuration is incomplete');
        }
        const updated = await this.updateStatus(
          orderId,
          {
            statusId: delivered.id,
            note:
              `Staff partial return ${displayId} created — remaining items ` +
              `marked instantly delivered.`,
          },
          actor.userId,
          performedBy,
        );
        return { return: ret, order: updated };
      }
      const updated = await this.confirmStaffPartialDelivered(
        orderId,
        actor.userId,
        `Staff partial return ${displayId} created — remaining items marked ` +
          `instantly delivered.`,
        performedBy,
      );
      return { return: ret, order: updated };
    }

    if (statusName === 'Shipping') {
      const partial = await this.prisma.orderStatus.findUnique({
        where: { name: 'Partial' },
      });
      if (!partial) {
        throw new BadRequestException('Order status configuration is incomplete');
      }
      const updated = await this.updateStatus(
        orderId,
        {
          statusId: partial.id,
          note:
            `Staff partial return ${displayId} created — ` +
            `order moved to Partial; dispatch unchanged.`,
        },
        actor.userId,
        performedBy,
      );
      return { return: ret, order: updated };
    }

    // Already Partial: the Return is the record; the status stays. Leave a
    // staff-visible timeline note so the creation is auditable.
    const timeline = [
      ...this.parseTimeline((order as any).timeline),
      {
        status: 'Partial',
        oldStatus: 'Partial',
        timestamp: new Date().toISOString(),
        note: `Staff partial return ${displayId} created — order stays Partial; dispatch unchanged.`,
        performedBy,
      },
    ];
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { timeline: timeline as any },
      include: { status: true },
    });
    return { return: ret, order: updated };
  }

  /**
   * Task 5 (Fix 9, owner-locked Rule 15.4): the ONLY automated Partial →
   * Delivered path — an explicit exception to the flow-index block in
   * CourierWebhookService.tryAdvanceOrderStatus AND to the updateStatus
   * automation-stop / transition locks (via the internal bypass flag, which
   * is set ONLY here after the fail-closed checks below — never from request
   * input).
   *
   * Fail-closed: throws unless the order is Partial AND an OPEN
   * staff-created PARTIAL Return exists (CLOSED legs never qualify).
   * Approval-pending partials never reach this method (the webhook passes
   * confirmedPartial=false for them); instant-delivery orders never reach it
   * either (they are already Delivered — the webhook is a no-op there).
   */
  async confirmStaffPartialDelivered(
    orderId: string,
    performedBy?: string,
    note?: string,
    performedByEmail?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { status: true },
    });
    if (!order || (order as any).trashedAt) {
      throw new NotFoundException('Order not found');
    }
    if ((order as any)?.status?.name !== 'Partial') {
      throw new BadRequestException(
        'Only a Partial order can be confirmed Delivered through a staff partial return.',
      );
    }
    const db = this.prisma as any;
    const staffReturn =
      typeof db?.return?.findFirst === 'function'
        ? await db.return.findFirst({
            where: {
              orderId,
              source: 'STAFF',
              type: 'PARTIAL',
              status: { not: 'CLOSED' },
            },
          })
        : null;
    if (!staffReturn) {
      throw new BadRequestException(
        'Partial → Delivered requires an open staff-created partial return.',
      );
    }
    const delivered = await this.prisma.orderStatus.findUnique({
      where: { name: 'Delivered' },
    });
    if (!delivered) {
      throw new BadRequestException('Order status configuration is incomplete');
    }
    return this.updateStatus(
      orderId,
      {
        statusId: delivered.id,
        note:
          note ??
          `Staff partial return ${(staffReturn as any)?.displayId ?? (staffReturn as any)?.id} ` +
            `confirmed — kept remainder delivered (Rule 15.4).`,
      },
      'system',
      performedByEmail ?? performedBy ?? 'system',
      undefined,
      { allowStaffPartialToDelivered: true },
    );
  }

  /**
   * Staff-partial item validation: ReturnsService shape rules (productId
   * required, quantity a positive integer, no duplicate lines) PLUS the
   * exchange qty-cap rules (each line must belong to the original order and
   * never exceed its ordered quantity — direct-POST inflation guard).
   */
  private validateStaffPartialItems(
    items: unknown,
    orderLines: { productId: string | null; variantId: string | null; quantity: number }[],
  ): { productId: string; variantId: string | null; quantity: number }[] {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('Select at least one product to return.');
    }
    const orderedQtyByKey = new Map<string, number>();
    const inOriginal = new Set<string>();
    for (const line of orderLines ?? []) {
      if (!line?.productId) continue;
      const key = `${line.productId}::${line.variantId ?? ''}`;
      inOriginal.add(key);
      orderedQtyByKey.set(key, (orderedQtyByKey.get(key) ?? 0) + Number(line.quantity ?? 0));
    }
    const seen = new Set<string>();
    return (items as any[]).map((it, i) => {
      const productId = String((it as any)?.productId ?? '').trim();
      const variantId = (it as any)?.variantId ? String((it as any).variantId) : null;
      const quantity = Number((it as any)?.quantity);
      if (!productId) {
        throw new BadRequestException(`Return items[${i}].productId is required`);
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new BadRequestException(
          `Return items[${i}].quantity must be a positive integer`,
        );
      }
      const key = `${productId}::${variantId ?? ''}`;
      if (seen.has(key)) {
        throw new BadRequestException(`Duplicate return line: ${productId}`);
      }
      seen.add(key);
      if (inOriginal.size > 0 && !inOriginal.has(key)) {
        throw new BadRequestException(
          'A returning item is not part of the original order.',
        );
      }
      const ordered = orderedQtyByKey.get(key);
      if (ordered !== undefined && quantity > ordered) {
        throw new BadRequestException(
          `Returning quantity (${quantity}) exceeds the ordered quantity (${ordered}).`,
        );
      }
      return { productId, variantId, quantity };
    });
  }

  /**
   * RTN-YYMMDD-NNNN — mirrors ReturnsService.generateDisplayId (shared
   * ReturnCounter, so T4-created and T5-created rows number in one sequence).
   */
  private async generateStaffPartialDisplayId(): Promise<string> {
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

  async submitPaymentProof(
    orderId: string,
    proofData: { transactionId?: string; screenshot?: string },
    opts?: { userId?: string; token?: string },
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { status: true },
    });
    if (!order || order.trashedAt)
      throw new NotFoundException('Order not found');

    // Ownership gate: user must own the order (by customerId) or present a valid viewToken
    const ownsOrder = opts?.userId && order.customerId === opts.userId;
    const hasValidToken = opts?.token && order.viewToken === opts.token;
    if (!ownsOrder && !hasValidToken) {
      throw new NotFoundException('Order not found');
    }

    if (
      order.status?.name !== 'Payment Pending' &&
      order.status?.name !== 'Payment Verifying'
    ) {
      throw new BadRequestException(
        'Order is not in Payment Pending or Payment Verifying status',
      );
    }

    const paymentVerifyingStatus = await this.prisma.orderStatus.findUnique({
      where: { name: 'Payment Verifying' },
    });

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        statusId: paymentVerifyingStatus!.id,
        paymentStatus: 'PAYMENT_VERIFYING',
        paymentProof: proofData,
      },
      include: {
        status: true,
        payments: true,
      },
    });
    await this.invalidateAnalytics();
    return updated;
  }

  /**
   * Writes a verification-time gateway fee onto the order's single PENDING
   * payment row (same tx). F3-safe by construction: with zero or several
   * PENDING rows the fee is ambiguous, so it 400s and points at the per-row
   * PUT /payments/:id/verify endpoint instead of guessing.
   */
  private async applyVerificationFee(tx: any, orderId: string, feeAmount: number) {
    const pending = await tx.payment.findMany({
      where: { orderId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    if (pending.length !== 1) {
      throw new BadRequestException(
        `Cannot record the fee on this order: found ${pending.length} PENDING payment rows. Record the fee per payment row via PUT /payments/:id/verify instead.`,
      );
    }
    await tx.payment.update({
      where: { id: pending[0].id },
      data: { feeAmount },
    });
  }

  async verifyPayment(orderId: string, verified: boolean, note?: string, feeAmount?: number, userId?: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { status: true },
      });
      if (!order || order.trashedAt)
        throw new NotFoundException('Order not found');
      if (order.paymentStatus !== 'PAYMENT_VERIFYING') {
        throw new BadRequestException(
          'Order is not awaiting payment verification',
        );
      }

      // Self-approve block (Task 6): the order-level verify approves every
      // PENDING row at once, so a verifier who recorded ANY of them is
      // refused — per-row PUT /payments/:id/verify stays the granular path.
      // userId is optional (pre-Task-6 callers omit it) — without an actor
      // there is nobody to compare against, so the check is skipped.
      if (userId) {
        const pending = await tx.payment.findMany({
          where: { orderId, status: 'PENDING' },
          select: { recordedBy: true },
        });
        if (
          pending.some((p: any) => p.recordedBy === `staff:${userId}`)
        ) {
          throw new ForbiddenException('Staff cannot approve their own entry');
        }
      }

      const targetStatusName = verified ? 'Confirmed' : 'Payment Pending';
      const targetStatus = await tx.orderStatus.findUnique({
        where: { name: targetStatusName },
      });

      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: verified ? 'PAID' : 'PAYMENT_PENDING',
          statusId: targetStatus!.id,
        },
        include: {
          status: true,
          payments: true,
        },
      });

      // Analytics cost capture (P2 §3.2/§3.4): an optional gateway fee rides
      // the verification. F3-safe: it attaches to the single PENDING payment
      // row — never spread across rows. Several/no PENDING rows ⇒ 400 with a
      // pointer to the per-row PUT /payments/:id/verify endpoint.
      if (feeAmount !== undefined) {
        if (!verified) {
          throw new BadRequestException(
            'feeAmount can only be recorded when verifying (verified=true)',
          );
        }
        if (!(feeAmount >= 0)) {
          throw new BadRequestException('feeAmount must be a non-negative number');
        }
        await this.applyVerificationFee(tx, orderId, feeAmount);
      }

      if (verified) {
        await this.handleConfirmedSideEffects(tx, orderId);

        // Payment-verification path: the transition lands this order on
        // `targetStatus.name`; the validated Purchase capture keeps the same
        // canonical configuration-driven gate as updateStatus() (self-gates on
        // `tracking_meta_validated_status`), so the event fires only when the
        // configured validated status matches the status actually reached.
        try {
          const withItems = await tx.order.findUnique({
            where: { id: orderId },
            include: {
              items: {
                include: {
                  product: {
                    select: {
                      id: true,
                      name: true,
                      sku: true,
                      category: { select: { name: true } },
                    },
                  },
                  combo: { select: { id: true, name: true } },
                  variant: { select: { id: true, sku: true } },
                },
              },
              customer: true,
              payments: true,
            },
          });
          if (withItems) {
            await this.firePurchaseValidated(
              targetStatus!.name,
              withItems as any,
              tx,
            );
            // Verified-payment landing on Confirmed is a genuine transition.
            await this.fireOrderStatusLifecycleEvent(
              withItems as any,
              order.status?.name,
              targetStatus!.name,
              tx,
            );
          }
        } catch (err) {
          this.logger.error(
            `Failed to capture tracking snapshot for order ${orderId}:`,
            err,
          );
        }
      }

      return updated;
    });

    await this.invalidateAnalytics();
    // Verification flips PAID status — the collectable changed (Feature A).
    await this.refreshCodAlert(orderId);

    // Commission hook (decision #5): verified payment lands the order on
    // 'Confirmed'; evaluate active commission rules. Resilient.
    if (verified) {
      try {
        await this.commissionsService.processOrderCommissions(orderId);
      } catch (err) {
        this.logger.error(
          `Commission hook failed for verified order ${orderId}:`,
          err,
        );
      }
    }

    return updated;
  }

  async addItem(orderId: string, dto: UpdateOrderItemDto, userId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, status: { select: { name: true } } },
    });
    if (!order || order.trashedAt)
      throw new NotFoundException('Order not found');
    this.assertItemsEditable(order.status?.name);

    if (dto.productId) {
      const product = await this.prisma.product.findUnique({
        where: { id: dto.productId },
        select: { availabilityMode: true, name: true },
      });
      if (product?.availabilityMode === 'ALWAYS_OUT_OF_STOCK') {
        throw new BadRequestException(
          `Product "${product.name}" is out of stock and cannot be ordered`,
        );
      }
    }

    const added = await this.prisma.$transaction(async (tx) => {
      const orderItem = await tx.orderItem.create({
        data: {
          orderId,
          productId: dto.productId,
          variantId: dto.variantId,
          quantity: dto.quantity,
          price: dto.price,
        },
      });

      await this.resolveAndApplyStock(
        'reserve',
        dto.productId,
        dto.variantId,
        dto.quantity,
        order.displayId,
        tx,
        {
          orderId,
          orderItemId: orderItem.id,
        },
      );

      this.events.emit({
        type: 'order.status_changed',
        data: { id: orderId, displayId: order.displayId, note: 'Item added' },
      });

      const items = [
        ...order.items.map((i) => ({
          price: Number(i.price),
          quantity: i.quantity,
        })),
        { price: dto.price, quantity: dto.quantity },
      ];
      const { subtotal, total } = this.recalculate(
        items,
        Number(order.shippingCharge),
        Number(order.discount),
        order.discountType || 'flat',
      );

      const timeline = [
        ...this.parseTimeline(order.timeline),
        {
          type: 'item_added',
          visibility: 'public',
          timestamp: new Date().toISOString(),
          note: `Item added: ${dto.quantity}x @ ৳${dto.price}`,
        },
      ];

      return tx.order.update({
        where: { id: orderId },
        data: {
          subtotal,
          total,
          timeline: timeline as any,
          // First manual mutation takes ownership; an existing assignment is preserved.
          ...(shouldAutoAssign(userId, order.assignedToId)
            ? { assignedToId: userId, assignedAt: new Date() }
            : {}),
        },
        include: {
          items: {
            include: {
              product: {
                select: { id: true, name: true, images: true, slug: true },
              },
            },
          },
        },
      });
    });
    await this.invalidateAnalytics();
    await this.refreshCodAlert(orderId);
    return added;
  }

  async removeItem(orderId: string, itemId: string, userId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, status: { select: { name: true } } },
    });
    if (!order || order.trashedAt)
      throw new NotFoundException('Order not found');
    this.assertItemsEditable(order.status?.name);

    const removedItem = order.items.find((i) => i.id === itemId);
    if (!removedItem) throw new NotFoundException('Order item not found');

    const removed = await this.prisma.$transaction(async (tx) => {
      const itemAny = removedItem as any;
      // Only release stock if not already deducted (avoids double-decrement of reservedStock)
      if (!itemAny.managedStockDeducted) {
        await this.resolveAndApplyStock(
          'release',
          removedItem.productId,
          removedItem.variantId,
          removedItem.quantity,
          order.displayId,
          tx,
          {
            comboId: removedItem.comboId || undefined,
            comboSelection:
              (removedItem.comboSelection as Record<string, string>) ||
              undefined,
            orderId,
            orderItemId: removedItem.id,
          },
        );
      }

      await tx.orderItem.delete({ where: { id: itemId } });

      const remaining = order.items
        .filter((i) => i.id !== itemId)
        .map((i) => ({ price: Number(i.price), quantity: i.quantity }));
      const { subtotal, total } = this.recalculate(
        remaining,
        Number(order.shippingCharge),
        Number(order.discount),
        order.discountType || 'flat',
      );

      const timeline = [
        ...this.parseTimeline(order.timeline),
        {
          type: 'item_removed',
          visibility: 'public',
          timestamp: new Date().toISOString(),
          note: `Item removed: ${removedItem.productId?.slice(0, 8)} (${removedItem.quantity}x @ ৳${Number(removedItem.price)})`,
        },
      ];

      return tx.order.update({
        where: { id: orderId },
        data: {
          subtotal,
          total,
          timeline: timeline as any,
          // First manual mutation takes ownership; an existing assignment is preserved.
          ...(shouldAutoAssign(userId, order.assignedToId)
            ? { assignedToId: userId, assignedAt: new Date() }
            : {}),
        },
        include: {
          items: {
            include: {
              product: {
                select: { id: true, name: true, images: true, slug: true },
              },
            },
          },
        },
      });
    });
    await this.invalidateAnalytics();
    await this.refreshCodAlert(orderId);
    return removed;
  }

  async bulkOrders(ids: string[]) {
    if (!ids?.length || ids.length > 500) return [];
    const orders = await this.prisma.order.findMany({
      where: { id: { in: ids } },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        status: true,
        items: {
          include: {
            product: { select: { id: true, name: true, images: true, sku: true } },
            variant: {
              include: {
                attributeValues: {
                  include: {
                    attributeValue: {
                      include: {
                        attribute: { select: { name: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        payments: true,
        dispatches: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map((o: any) => this.transformOrder(o));
  }

  async bulkStatusChange(ids: string[], statusId: string, userId = 'system') {
    const targetStatus = await this.prisma.orderStatus.findUnique({
      where: { id: statusId },
    });
    if (!targetStatus) throw new BadRequestException('Status not found');

    // 'Returned' restores stock — automated/system callers must never bulk-apply it.
    if (targetStatus.name === 'Returned' && isAutomatedActor(userId)) {
      throw new BadRequestException(
        'Orders cannot be bulk-marked Returned by an automated process — return confirmation is manual.',
      );
    }

    const orders = await this.prisma.order.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        displayId: true,
        timeline: true,
        statusId: true,
        assignedToId: true,
        status: { select: { name: true } },
      },
    });

    const foundIds = new Set(orders.map((o) => o.id));
    const missing = ids.filter((id) => !foundIds.has(id));

    const validIds: string[] = [];
    const failedDetails: { id: string; reason: string }[] = [];
    for (const order of orders) {
      const allowed = ORDER_TRANSITIONS[order.status.name] || [];
      if (allowed.includes(targetStatus.name)) {
        validIds.push(order.id);
      } else {
        failedDetails.push({
          id: order.id,
          reason: `Cannot transition from "${order.status.name}" to "${targetStatus.name}"`,
        });
      }
    }
    for (const missingId of missing) {
      failedDetails.push({ id: missingId, reason: 'Order not found' });
    }

    // Task 4 (Fix 8): bulk Returned collects per-order failures like the
    // cancel gate above — an exchange-linked original whose exchange is not
    // delivered + return not arrived lands in the failed list; the rest
    // still confirm.
    if (targetStatus.name === 'Returned') {
      const stillValid: string[] = [];
      for (const orderId of validIds) {
        try {
          await this.assertExchangeReturnReady(orderId);
          stillValid.push(orderId);
        } catch (e) {
          failedDetails.push({
            id: orderId,
            reason: (e as Error)?.message ?? 'Exchange return not ready',
          });
        }
      }
      validIds.length = 0;
      validIds.push(...stillValid);
    }

    // Task 9 (D5): bulk cancel collects per-order failures instead of
    // throwing the whole batch — an order with money still out lands in the
    // failed list with the gate message; the rest still cancel.
    if (targetStatus.name === 'Cancelled') {
      const stillValid: string[] = [];
      for (const orderId of validIds) {
        const outstanding = await this.outstandingRefundableBalance(orderId);
        if (outstanding > 0) {
          failedDetails.push({
            id: orderId,
            reason: this.cancelBlockedMessage(outstanding),
          });
        } else {
          stillValid.push(orderId);
        }
      }
      validIds.length = 0;
      validIds.push(...stillValid);
    }

    // Bulk cancel of DISPATCHED orders: each order's dispatch is cancelled
    // with its courier first (the eligibility check + the courier push run
    // BEFORE the transaction). A blocked order lands in the failed list with
    // its reason — like the money gate — the rest still cancel.
    const bulkDispatchPlans = new Map<string, DispatchCancelPlan>();
    if (targetStatus.name === 'Cancelled' && this.dispatchCancel) {
      const stillValid: string[] = [];
      for (const orderId of validIds) {
        try {
          bulkDispatchPlans.set(
            orderId,
            await this.dispatchCancel.prepare(orderId, userId),
          );
          stillValid.push(orderId);
        } catch (e) {
          failedDetails.push({
            id: orderId,
            reason:
              (e as Error)?.message ??
              'The dispatch could not be cancelled with the courier',
          });
        }
      }
      validIds.length = 0;
      validIds.push(...stillValid);
    }

    if (validIds.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.order.updateMany({
          where: { id: { in: validIds } },
          data: { statusId },
        });

        // First-mutation ownership: a bulk status change may ASSIGN only orders
        // that are currently unassigned — an existing assignment is preserved.
        const assignableIds = !isAutomatedActor(userId)
          ? validIds.filter(
              (id) => orders.find((o) => o.id === id)?.assignedToId == null,
            )
          : [];
        if (assignableIds.length > 0) {
          await tx.order.updateMany({
            where: { id: { in: assignableIds } },
            data: { assignedToId: userId, assignedAt: new Date() },
          });
        }

        if (targetStatus.name === 'Cancelled') {
          for (const cancelOrderId of validIds) {
            await this.handleCancelledSideEffects(tx, cancelOrderId, userId);
            const plan = bulkDispatchPlans.get(cancelOrderId);
            if (plan) {
              await this.dispatchCancel!.apply(tx, plan, userId);
            }
          }
        }

        if (targetStatus.name === 'Confirmed') {
          for (const confirmOrderId of validIds) {
            await this.handleConfirmedSideEffects(tx, confirmOrderId, userId);
          }
        }

        if (targetStatus.name === 'Returned') {
          for (const returnOrderId of validIds) {
            await this.handleReturnedSideEffects(tx, returnOrderId, userId);
          }
        }

        if (targetStatus.name === 'Delivered') {
          for (const deliveredOrder of orders.filter((o) =>
            validIds.includes(o.id),
          )) {
            await this.handleDeliveredSideEffects(
              tx,
              deliveredOrder as any,
              userId,
            );
          }
        }

        for (const order of orders) {
          if (!validIds.includes(order.id)) continue;
          const tl = [
            ...this.parseTimeline(order.timeline),
            {
              status: targetStatus.name,
              timestamp: new Date().toISOString(),
              note: `Bulk status changed to ${targetStatus.name}`,
              performedBy: userId,
            },
          ];
          await tx.order.update({
            where: { id: order.id },
            data: { timeline: tl as any },
          });

          if (this.staffPerformance && userId) {
            const action =
              targetStatus.name === 'Confirmed'
                ? 'confirmed'
                : targetStatus.name === 'Delivered'
                  ? 'delivered'
                  : targetStatus.name === 'Returned'
                    ? 'returned'
                    : targetStatus.name === 'Cancelled'
                      ? 'cancelled'
                      : 'status_change';
            await this.staffPerformance.recordStaffEvent(
              {
                orderId: order.id,
                userId,
                action,
                fromStatus: order.status?.name,
                toStatus: targetStatus.name,
                note: `Bulk status changed to ${targetStatus.name}`,
              },
              tx,
            );
          }
        }

        // Capture tracking snapshots for every order the bulk change touched.
        // firePurchaseValidated/fireRefundEvent self-gate on settings; each
        // order is isolated so one order's capture failure can never skip the
        // remaining orders' Purchases, and never rolls back the statuses.
        for (const order of orders) {
          if (!validIds.includes(order.id)) continue;
          try {
            const withItems = await tx.order.findUnique({
              where: { id: order.id },
              include: {
                items: {
                  include: {
                    product: {
                      select: {
                        id: true,
                        name: true,
                        sku: true,
                        category: { select: { name: true } },
                      },
                    },
                    combo: { select: { id: true, name: true } },
                    variant: { select: { id: true, sku: true } },
                  },
                },
                customer: true,
                payments: true,
              },
            });
            if (!withItems) continue;
            await this.firePurchaseValidated(
              targetStatus.name,
              withItems as any,
              tx,
            );
            // Same lifecycle coverage as updateStatus(); old status comes from
            // the pre-loaded order row in scope.
            await this.fireOrderStatusLifecycleEvent(
              withItems as any,
              order.status?.name,
              targetStatus.name,
              tx,
            );
            if (
              ['Cancelled', 'Returned', 'Return Pending'].includes(
                targetStatus.name,
              )
            ) {
              await this.fireRefundEvent(withItems as any, tx);
            }
          } catch (err) {
            this.logger.error(
              `Failed to capture tracking snapshot for order ${order.id} in bulk status change:`,
              err,
            );
          }
        }
      });
    }

    // Commission reversal hook (G-01): bulk-cancelled / bulk-returned orders
    // reverse approved earnings. Resilient — never breaks the bulk operation.
    if (['Cancelled', 'Returned'].includes(targetStatus.name)) {
      const reason = `Order ${targetStatus.name.toLowerCase()}`;
      try {
        for (const reversedId of validIds) {
          await this.commissionsService.reverseForOrder(
            reversedId,
            undefined,
            reason,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Commission reversal hook failed for bulk ${targetStatus.name} change:`,
          err,
        );
      }
    }

    await this.invalidateAnalytics();
    return {
      updated: validIds.length,
      skipped: failedDetails.length,
      failed: failedDetails.length,
      failedDetails,
      status: targetStatus.name,
    };
  }

  async bulkDispatch(courier: string, ids: string[], _userId: string) {
    const { CourierManagerService } =
      await import('../courier-manager/courier-manager.service.js');
    const { CourierTokenService } =
      await import('../courier-manager/courier-token.service.js');
    const { CacheService } = await import('../cache/cache.service.js');
    const mgr = new CourierManagerService(
      this.prisma,
      new CourierTokenService(this.prisma, new CacheService()),
    );
    return mgr.dispatch(courier, ids);
  }

  async bulkAssign(ids: string[], assignedToId: string | null) {
    const orders = await this.prisma.order.findMany({
      where: { id: { in: ids }, trashedAt: null },
      select: { id: true },
    });
    const foundIds = orders.map((o) => o.id);
    const data: any = { assignedToId };
    if (assignedToId) data.assignedAt = new Date();
    else data.assignedAt = null;
    const res =
      foundIds.length > 0
        ? await this.prisma.order.updateMany({
            where: { id: { in: foundIds } },
            data,
          })
        : { count: 0 };

    if (this.staffPerformance && assignedToId && foundIds.length > 0) {
      for (const orderId of foundIds) {
        await this.staffPerformance.recordStaffEvent({
          orderId,
          userId: assignedToId,
          action: 'assigned',
          note: 'Assigned to staff',
        });
      }
    }

    return { updated: res.count, total: ids.length };
  }

  async getStaff() {
    return this.prisma.userProfile.findMany({
      where: {
        role: { in: ['admin', 'employee', 'cashier', 'superadmin'] },
        status: 'active',
      },
      select: { id: true, firstName: true, lastName: true, role: true },
      orderBy: { firstName: 'asc' },
    });
  }

  /**
   * Public tracking DTO for displayId / phone-number lookups.
   *
   * No customer name, no street address, no phone, no payment/staff/internal
   * fields. The timeline is reduced to what a status tracker needs: the
   * status, when it happened, and the customer-facing note. `performedBy` is
   * dropped because it is a staff email address, and entries explicitly
   * marked private are excluded.
   *
   * Ordered oldest → newest so the storefront can draw its rail top-to-bottom
   * with the current step last.
   * Type: PublicDisplayOrder.
   */
  private toPublicDisplayDto(order: any): PublicDisplayOrder {
    return {
      id: order.id,
      displayId: order.displayId,
      createdAt: order.createdAt,
      status: order.status
        ? { name: order.status.name, color: order.status.color }
        : null,
      items: (order.items || []).map((i: any) => ({
        id: i.id,
        quantity: i.quantity,
        price: i.price,
        product: i.product
          ? {
              name: i.product.name,
              slug: i.product.slug,
              images: i.product.images,
            }
          : null,
      })),
      total: order.total,
      trackingUrl:
        order.dispatches?.[0]?.trackingUrl ||
        buildTrackingUrl(
          order.courierService,
          order.courierTrackingCode,
          order.courierConsignmentId,
        ),
      timeline: this.toPublicTimeline(order.timeline),
      shipment:
        order.courierService || order.courierTrackingCode
          ? {
              courier: order.courierService || null,
              trackingCode: order.courierTrackingCode || null,
            }
          : null,
      shippingAddress:
        order.shippingAddress &&
        typeof order.shippingAddress === 'object'
          ? {
              city: order.shippingAddress.city || null,
              district: order.shippingAddress.district || null,
            }
          : null,
    };
  }

  /**
   * Reduce the stored order timeline to its public entries.
   *
   * The column is Json and is written by many code paths with differing
   * shapes, so anything unrecognised is skipped rather than passed through.
   * Only `status`, `timestamp` and `note` survive; `performedBy`, `oldValue`,
   * `newValue` and any other internal field are dropped. Status-change rows
   * carry no `visibility` field and are public by default, whereas notes a
   * staff member explicitly marked private are not.
   */
  private toPublicTimeline(timeline: unknown): PublicTimelineEntry[] {
    if (!Array.isArray(timeline)) return [];

    return timeline
      .filter((t: any) => t && typeof t === 'object' && t.visibility !== 'private')
      .map((t: any) => ({
        status: typeof t.status === 'string' ? t.status : '',
        timestamp:
          t.timestamp instanceof Date
            ? t.timestamp.toISOString()
            : typeof t.timestamp === 'string'
              ? t.timestamp
              : '',
        ...(typeof t.note === 'string' && t.note.trim() ? { note: t.note } : {}),
      }))
      .filter((t) => t.status || t.note)
      .sort((a, b) => {
        // Unparseable timestamps sort last rather than corrupting the order.
        const at = Date.parse(a.timestamp);
        const bt = Date.parse(b.timestamp);
        if (Number.isNaN(at)) return 1;
        if (Number.isNaN(bt)) return -1;
        return at - bt;
      });
  }

  /**
   * Slightly richer DTO for view-token-authenticated guest tracking.
   * Still no payment/staff/internal fields; allows customer name and
   * city-level shipping info for order confirmation.
   * Type: PublicTokenOrder.
   */
  private toPublicTokenDto(order: any): PublicTokenOrder {
    return {
      ...this.toPublicDisplayDto(order),
      customer: order.customer ? { name: order.customer.name || '' } : null,
      shippingAddress:
        order.shippingAddress && typeof order.shippingAddress === 'object'
          ? {
              city: order.shippingAddress.city || '',
              zone: order.shippingAddress.zone || '',
              district: order.shippingAddress.district || '',
            }
          : null,
      // Same redaction as the display DTO: a token is a bearer secret found in
      // a customer's own order link, not a licence to expose staff identities.
      timeline: this.toPublicTimeline(order.timeline).map((t) => ({
        status: t.status,
        timestamp: t.timestamp,
        ...(t.note ? { note: t.note } : {}),
      })),
    };
  }

  /** Public order lookup by phone — bounded to 10 most recent, minimal fields only. */
  async findByPhone(phone: string) {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      throw new BadRequestException(
        'Invalid Bangladeshi phone number format. Use 01XXXXXXXXX or +8801XXXXXXXXX.',
      );
    }

    if (normalized.length > 20) {
      throw new BadRequestException('Invalid phone number');
    }

    const orders = await this.prisma.order.findMany({
      where: {
        trashedAt: null,
        kind: 'SALE',
        OR: [{ guestPhone: normalized }, { customer: { phone: normalized } }],
      },
      select: PUBLIC_DISPLAY_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return orders.map((o) => this.toPublicDisplayDto(o));
  }

  /** Public order-number (displayId) lookup — strictly no-PII DTO, viewToken never accepted. */
  async findByDisplayId(displayId: string) {
    let queryStr = displayId.trim();
    if (queryStr.length > 100) {
      throw new BadRequestException('Invalid order reference');
    }
    if (queryStr.startsWith('#')) {
      queryStr = queryStr.substring(1).trim();
    }

    const order = await this.prisma.order.findFirst({
      where: {
        trashedAt: null,
        kind: 'SALE',
        displayId: { equals: queryStr, mode: 'insensitive' },
      },
      select: PUBLIC_DISPLAY_SELECT,
    });
    if (!order) throw new NotFoundException('Order not found');
    return this.toPublicDisplayDto(order);
  }

  /** Guest tracking lookup by secret viewToken — never treated as displayId. */
  async findByViewToken(viewToken: string) {
    const queryStr = viewToken.trim();
    if (queryStr.length > 100) {
      throw new BadRequestException('Invalid token');
    }

    const order = await this.prisma.order.findFirst({
      where: { trashedAt: null, viewToken: queryStr },
      select: PUBLIC_TOKEN_SELECT,
    });
    if (!order) throw new NotFoundException('Order not found');
    return this.toPublicTokenDto(order);
  }

  async rotateViewToken(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order || order.trashedAt)
      throw new NotFoundException('Order not found');
    const viewToken = randomUUID();
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { viewToken },
      select: { id: true, viewToken: true, displayId: true },
    });
    return updated;
  }

  async cancelByCustomer(orderId: string, token: string) {
    if (!token) throw new ForbiddenException('View token is required');
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { status: true },
    });
    if (!order || order.trashedAt || order.viewToken !== token) {
      throw new NotFoundException('Order not found');
    }
    const cancelled = await this.prisma.orderStatus.findFirst({
      where: { name: 'Cancelled' },
    });
    if (!cancelled) {
      throw new BadRequestException('Cancelled status not configured');
    }
    const allowed = ORDER_TRANSITIONS[order.status.name] || [];
    if (!allowed.includes('Cancelled')) {
      throw new BadRequestException(
        `Order in "${order.status.name}" status cannot be cancelled`,
      );
    }
    // Task 9 (D5): customer cancel blocked while money is still out — the
    // customer must contact support for a refund first.
    await this.assertNoOutstandingForCancel(orderId);
    const timeline = [
      ...this.parseTimeline(order.timeline),
      {
        status: cancelled.name,
        timestamp: new Date().toISOString(),
        note: 'Cancelled by customer',
      },
    ];
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.order.update({
        where: { id: orderId },
        data: { statusId: cancelled.id, timeline: timeline as any },
        include: { status: true },
      });

      await this.handleCancelledSideEffects(tx, orderId, 'customer');

      // Capture the refund snapshot inside the same transaction as the cancel.
      // fireRefundEvent self-gates on settings; the block is wrapped so a
      // capture-side failure can never roll back the cancellation.
      try {
        const refundOrder = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            items: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    sku: true,
                    category: { select: { name: true } },
                  },
                },
                combo: { select: { id: true, name: true } },
                variant: { select: { id: true, sku: true } },
              },
            },
            customer: true,
          },
        });
        if (refundOrder) {
          await this.fireRefundEvent(refundOrder as any, tx);
          // Customer-initiated cancellation is a genuine Cancelled transition.
          await this.fireOrderStatusLifecycleEvent(
            refundOrder as any,
            order.status?.name,
            'Cancelled',
            tx,
          );
        }
      } catch (err) {
        this.logger.error(
          `Failed to capture refund snapshot for order ${orderId}:`,
          err,
        );
      }

      return u;
    });

    this.events.emit({
      type: 'order.status_changed',
      data: {
        id: updated.id,
        displayId: updated.displayId,
        statusId: cancelled.id,
        statusName: cancelled.name,
      },
    });

    // Commission reversal hook (G-01): customer cancellation reverses approved
    // earnings on the order. Resilient — never breaks the cancel flow.
    try {
      await this.commissionsService.reverseForOrder(
        orderId,
        undefined,
        'Order cancelled',
      );
    } catch (err) {
      this.logger.warn(
        `Commission reversal hook failed for customer-cancelled order ${orderId}:`,
        err,
      );
    }

    await this.invalidateAnalytics();
    return updated;
  }

  async trash(orderId: string, performedBy?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { status: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.trashedAt)
      throw new BadRequestException('Order is already trashed');

    const timeline = [
      ...this.parseTimeline(order.timeline),
      {
        type: 'trash',
        status: order.status.name,
        timestamp: new Date().toISOString(),
        note: 'Order moved to trash',
        performedBy: performedBy || 'system',
      },
    ];

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          trashedAt: new Date(),
          timeline: timeline as any,
        },
      });

      await this.handleCancelledSideEffects(tx, orderId, performedBy);
    });

    this.events.emit({
      type: 'order.trashed',
      data: { id: order.id, displayId: order.displayId },
    });

    await this.invalidateAnalytics();
    return { success: true, message: 'Order moved to trash' };
  }

  async restore(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (!order.trashedAt) throw new BadRequestException('Order is not trashed');

    const timeline = [
      ...this.parseTimeline(order.timeline),
      {
        type: 'restore',
        timestamp: new Date().toISOString(),
        note: 'Order restored from trash',
      },
    ];

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        trashedAt: null,
        timeline: timeline as any,
      },
    });

    this.events.emit({
      type: 'order.restored',
      data: { id: order.id, displayId: order.displayId },
    });

    await this.invalidateAnalytics();
    return { success: true, message: 'Order restored from trash' };
  }

  async backfillViewTokens() {
    const orders = await this.prisma.order.findMany({
      where: { viewToken: null },
      select: { id: true },
    });
    let updated = 0;
    for (const o of orders) {
      await this.prisma.order.update({
        where: { id: o.id },
        data: { viewToken: randomUUID() },
      });
      updated += 1;
    }
    return { updated, total: orders.length };
  }

  async transitionOrderStatus(
    orderId: string,
    newStatus: string,
    performedBy?: string,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          status: true,
          items: { include: { product: true, variant: true } },
        },
      });
      if (!order || order.trashedAt)
        throw new NotFoundException(`Order ${orderId} not found`);

      // AUTHORITATIVE RULE: 'Partial' is an automation-stopped order state.
      // Only manual staff action may move it (see updateStatus for details).
      if (order.status.name === 'Partial' && isAutomatedActor(performedBy)) {
        throw new BadRequestException(
          'Order is Partial: automated processes cannot change its status. It must be changed manually.',
        );
      }

      const currentStatus = order.status.name;
      const allowed = ORDER_TRANSITIONS[currentStatus];
      if (!allowed || !allowed.includes(newStatus)) {
        throw new BadRequestException(
          `Cannot transition from "${currentStatus}" to "${newStatus}". Allowed: ${allowed?.join(', ') || 'none'}`,
        );
      }

      // 'Returned' restores stock — automated/system actors must never set it.
      if (newStatus === 'Returned' && isAutomatedActor(performedBy)) {
        throw new BadRequestException(
          'Order cannot be marked Returned by an automated process — it must be manually confirmed from the order detail page.',
        );
      }

      const targetStatus = await tx.orderStatus.findUnique({
        where: { name: newStatus },
      });
      if (!targetStatus)
        throw new NotFoundException(`Status "${newStatus}" not found`);

      await tx.order.update({
        where: { id: orderId },
        data: { statusId: targetStatus.id },
      });

      // Lifecycle coverage for this (currently unused) transition path, so a
      // future caller gets the same events as updateStatus().
      await this.fireOrderStatusLifecycleEvent(
        order as any,
        currentStatus,
        newStatus,
        tx,
      );

      await this.executeTransitionSideEffects(
        tx,
        order,
        currentStatus,
        newStatus,
        performedBy,
      );

      return { success: true, from: currentStatus, to: newStatus };
    });

    // Commission reversal hook (G-01): a transition into cancelled/returned
    // reverses approved earnings on the order. Resilient — never breaks the
    // transition result.
    if (['Cancelled', 'Returned'].includes(newStatus)) {
      try {
        await this.commissionsService.reverseForOrder(
          orderId,
          undefined,
          `Order ${newStatus.toLowerCase()}`,
        );
      } catch (err) {
        this.logger.warn(
          `Commission reversal hook failed on transition to ${newStatus} for ${orderId}:`,
          err,
        );
      }
    }

    // Recognition input changed (statusId drives delivered-only revenue) —
    // drop cached analytics like updateStatus/cancelByCustomer do.
    await this.invalidateAnalytics();

    return result;
  }

  private async executeTransitionSideEffects(
    tx: Prisma.TransactionClient,
    order: any,
    fromStatus: string,
    toStatus: string,
    performedBy?: string,
  ) {
    switch (toStatus) {
      case 'Confirmed':
        await this.handleConfirmedSideEffects(tx, order.id, performedBy);
        break;
      case 'Hold':
        // Cancelled orders released their reservation; a Hold must hold stock.
        // Restore the invariant (throws when stock is no longer available).
        if (fromStatus === 'Cancelled') {
          await this.verifyStockForOrder(order.id, tx);
        }
        break;
      case 'Cancelled':
        await this.handleCancelledSideEffects(tx, order.id, performedBy);
        break;
      case 'Returned':
        await this.handleReturnedSideEffects(tx, order.id, performedBy);
        break;
      case 'Delivered':
        await this.handleDeliveredSideEffects(tx, order, performedBy);
        break;
    }
  }

  private async handleConfirmedSideEffects(
    tx: Prisma.TransactionClient,
    orderId: string,
    performedBy?: string,
  ) {
    await this.takeCostSnapshot(orderId, tx);
    await this.verifyStockForOrder(orderId, tx);
  }

  private async handleCancelledSideEffects(
    tx: Prisma.TransactionClient,
    orderId: string,
    performedBy?: string,
  ) {
    await this.cancelReturnStock.restoreForOrder({
      orderId,
      referencePrefix: 'cancel',
      performedBy,
      tx,
    });
  }

  private async handleReturnedSideEffects(
    tx: Prisma.TransactionClient,
    orderId: string,
    performedBy?: string,
  ) {
    // Hardening (2) STOCK AUTHORITY: a status change NEVER writes stock
    // directly. Manual mark-Returned goes find-or-create linked Return →
    // guarded receive (restoreStockForReturnTx — flag + status in the SAME
    // tx as the movement; reconciled rows are no-ops, so an already-received
    // full return moves to Returned with ZERO stock writes here).
    const db = tx as any;
    const all = ((await db.return.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    })) ?? []) as any[];
    const active = all.filter((r) => r?.status !== 'CLOSED');
    const arrived = (r: any) =>
      r?.status === 'RECEIVED' || r?.status === 'RESTOCKED' || !!r?.stockReconciled;
    const unarrived = active.filter((r) => !arrived(r));
    if (unarrived.length > 0) {
      const first = unarrived[0];
      throw new BadRequestException(
        `Cannot mark Returned yet — return ${first.displayId ?? first.id} ` +
          `has not arrived (needs RECEIVED or RESTOCKED).`,
      );
    }
    const reconciledHistory = all.some(
      (r) => r?.status === 'RESTOCKED' || !!r?.stockReconciled,
    );
    let targets = active.filter(
      (r) => !r?.stockReconciled && r?.status !== 'RESTOCKED',
    );
    if (targets.length === 0 && active.length === 0 && !reconciledHistory) {
      // Find-or-create: no linked return and nothing ever reconciled — the
      // legacy manual path. Auto-create ONE FULL return scoped to the order's
      // items, then receive it through the guarded path below.
      const snapshot = await orderItemsSnapshotForClient(tx, orderId);
      if (snapshot.length > 0) {
        const created = await db.return.create({
          data: {
            orderId,
            displayId: await generateReturnDisplayId(tx),
            type: 'FULL',
            status: 'REQUESTED',
            source: 'STAFF',
            items: snapshot,
            reason: 'Auto-created on manual Returned confirmation',
          },
        });
        targets = [created];
        this.logger.log(
          `Order ${orderId} manually marked Returned with no linked return — ` +
            `auto-created ${(created as any)?.displayId ?? (created as any)?.id} ` +
            `(type=FULL, source=STAFF).`,
        );
      }
    }
    for (const target of targets) {
      const rowItems = Array.isArray(target?.items) ? target.items : [];
      if (rowItems.length === 0 && target?.type !== 'FULL') {
        // Unknown split on a partial leg — staff confirm exact quantities via
        // mark-received. Never fabricate a full-order snapshot for a PARTIAL.
        this.logger.warn(
          `Order ${orderId} marked Returned with an item-less ${target?.type} return ` +
            `${target?.displayId ?? target?.id} — stock held for staff confirmation.`,
        );
        continue;
      }
      const items =
        rowItems.length > 0 ? rowItems : await orderItemsSnapshotForClient(tx, orderId);
      if (items.length === 0) continue;
      await restoreStockForReturnTx(
        { db: tx, cancelReturnStock: this.cancelReturnStock },
        target.id,
        { items, performedBy },
      );
    }
  }

  /**
   * Task 4 (Fix 8): BOTH-signals gate for confirming an exchange-linked
   * original Returned — every exchange order DELIVERED (dispatch) AND every
   * Return(EXCHANGE) leg RECEIVED/RESTOCKED.
   *
   * Unlinked orders pass straight through. Legacy exchanges (pre-Feature, no
   * Return record) gate on delivery only. Fail-CLOSED when exchange children
   * are known but the delivery state is unknown (dispatch surface missing or
   * query throws): the gate blocks with an explicit error rather than
   * allowing Returned on no evidence. Zero-exchange orders keep the lenient
   * path — a return-leg query failure with nothing to gate on still passes.
   */
  private async assertExchangeReturnReady(id: string): Promise<void> {
    const db = this.prisma as any;
    if (typeof db?.order?.findMany !== 'function') return;
    let children: any[];
    try {
      children = (await db.order.findMany({
        where: { exchangeOfOrderId: id, trashedAt: null },
        select: { id: true, displayId: true },
      })) ?? [];
    } catch {
      return;
    }
    // An order is never its own exchange child (also keeps arg-insensitive
    // test doubles from false-positiving on the order row itself).
    const exchanges = (children ?? []).filter((e) => e?.id !== id);
    let exReturns: any[] = [];
    if (typeof db?.return?.findMany === 'function') {
      try {
        exReturns =
          (await db.return.findMany({
            where: { orderId: id, type: 'EXCHANGE' },
            select: { id: true, displayId: true, status: true },
          })) ?? [];
      } catch {
        exReturns = [];
      }
    }
    if (exchanges.length === 0 && exReturns.length === 0) return;

    if (exchanges.length > 0) {
      // Fail-CLOSED: with known exchange children, an unknown delivery state
      // must block — never silently allow Returned. (Zero-exchange orders
      // keep the lenient path: nothing to gate on.)
      if (typeof db?.dispatch?.findMany !== 'function') {
        throw new BadRequestException(
          'Cannot mark Returned yet — exchange delivery state is unknown. ' +
            'Verify the exchange order delivery before confirming.',
        );
      }
      let dispatches: any[];
      try {
        dispatches =
          (await db.dispatch.findMany({
            where: { orderId: { in: exchanges.map((e) => e.id) } },
            select: { orderId: true, status: true },
          })) ?? [];
      } catch {
        throw new BadRequestException(
          'Cannot mark Returned yet — exchange delivery state is unknown. ' +
            'Verify the exchange order delivery before confirming.',
        );
      }
      const delivered = new Set(
        (dispatches ?? [])
          .filter((d) => d?.status === 'DELIVERED')
          .map((d) => d.orderId),
      );
      const undelivered = exchanges.filter((e) => !delivered.has(e.id));
      if (undelivered.length > 0) {
        const first = undelivered[0];
        throw new BadRequestException(
          `Cannot mark Returned yet — exchange order ${first.displayId ?? first.id} ` +
            `has not been delivered.`,
        );
      }
    }

    if (exReturns.length > 0) {
      const unarrived = exReturns.filter(
        (r) => r?.status !== 'RECEIVED' && r?.status !== 'RESTOCKED',
      );
      if (unarrived.length > 0) {
        const first = unarrived[0];
        throw new BadRequestException(
          `Cannot mark Returned yet — return ${first.displayId ?? first.id} ` +
            `has not arrived (needs RECEIVED or RESTOCKED).`,
        );
      }
    }
  }

  private async handleDeliveredSideEffects(
    tx: Prisma.TransactionClient,
    order: any,
    performedBy?: string,
  ) {
    // COD cash payment verification on delivery — a single path for manual,
    // bulk, and courier-sync deliveries (idempotent: only UNPAID → PAID).
    //
    // verifiedBy is a FK to UserProfile(id), but the status endpoints receive
    // the acting staff member's EMAIL as performedBy (see
    // OrdersController.updateStatus) — writing it raw violates
    // Payment_verifiedBy_fkey. Resolve to the staff user id the way the
    // verify path does (PaymentsService.verify writes the user id, never an
    // email).
    //
    // Errors here MUST propagate: a failed statement swallowed inside this
    // Postgres transaction poisons it into a silent rollback — the API would
    // return the in-transaction Delivered object with HTTP 200 while the DB
    // still holds Shipping. Never catch around these writes.
    const codPayment = await tx.payment.findFirst({
      where: {
        orderId: order.id,
        gatewayCode: 'cash',
        status: PaymentStatus.UNPAID,
      },
    });
    if (codPayment) {
      const verifierId = await this.resolvePaymentVerifierId(tx, performedBy);
      await tx.payment.update({
        where: { id: codPayment.id },
        data: {
          status: PaymentStatus.PAID,
          verifiedBy: verifierId,
          verifiedAt: new Date(),
        },
      });
    }

    // Final stock deduction on delivery.
    // Idempotent: managed stock only deducts when managedStockDeducted === false;
    // physical reservation only when ACTIVE. Safe for courier auto-delivery.
    try {
      await this.orderStockDeduct.deductForOrder({
        orderId: order.id,
        reference: `Order Delivered: ${order.displayId || order.id}`,
        performedBy,
        tx,
        strict: false,
      });
    } catch (err) {
      // Never let a stock side-effect block the Delivered status from persisting.
      this.logger.error(
        `Failed to deduct stock on delivery for order ${order.id}:`,
        err,
      );
    }
  }

  /**
   * Resolve a status-actor string to a UserProfile id for Payment.verifiedBy.
   * Staff endpoints pass the user EMAIL as performedBy — look it up so the FK
   * holds. Automated actors ('system', webhooks, reconcile) and unknown emails
   * have no user row; the column is nullable so they resolve to null.
   * A raw user id passes through untouched (verify-path pattern).
   */
  private async resolvePaymentVerifierId(
    tx: Prisma.TransactionClient,
    actor?: string,
  ): Promise<string | null> {
    if (!actor || isAutomatedActor(actor)) return null;
    if (actor.includes('@')) {
      const user = await tx.userProfile.findUnique({
        where: { email: actor },
        select: { id: true },
      });
      return user?.id ?? null;
    }
    return actor;
  }

  private async takeCostSnapshot(
    orderId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const order = await (tx || this.prisma).order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: { select: { standardCost: true, availabilityMode: true } },
            variant: { select: { standardCost: true } },
          },
        },
      },
    });

    if (!order) return;

    for (const item of order.items) {
      const cost = item.variant?.standardCost ?? item.product?.standardCost;
      if (cost != null) {
        await (tx || this.prisma).orderItem.update({
          where: { id: item.id },
          data: {
            costSnapshot: cost,
            costType: 'estimated',
          },
        });
      }
    }
  }

  private async verifyStockForOrder(
    orderId: string,
    tx: Prisma.TransactionClient,
  ) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                availabilityMode: true,
                manageStock: true,
                type: true,
                warehouseId: true,
                name: true,
                syncManagedStock: true,
              },
            },
            variant: { select: { id: true } },
          },
        },
      },
    });

    if (!order) return;

    // Resolve or create ACTIVE cycle
    let cycle = await tx.orderStockCycle.findFirst({
      where: { orderId, status: 'ACTIVE' },
    });
    if (!cycle) {
      cycle = await tx.orderStockCycle.create({
        data: { orderId, status: 'ACTIVE' },
      });
    }
    const cycleId = cycle.id;

    const imEnabled = await this.stockRouter.isInventoryManagementEnabled();

    for (const item of order.items) {
      // ── 1. Combo Items ───────────────────────────────────────────────────────
      if (item.comboId) {
        const components = await tx.orderItemComboComponent.findMany({
          where: { orderItemId: item.id },
          include: { product: true },
        });

        for (const comp of components) {
          const compProduct = comp.product;
          if (compProduct.availabilityMode === 'ALWAYS_OUT_OF_STOCK') {
            throw new BadRequestException(
              `Product "${compProduct.name}" in combo is out of stock and cannot be ordered`,
            );
          }

          // A. Managed Stock reserve if not already reserved
          if (
            compProduct.availabilityMode === 'MANAGED_STOCK' &&
            compProduct.manageStock
          ) {
            if (!comp.managedStockReserved) {
              const avail = await this.stockService.getAvailableStock(
                comp.productId,
                comp.variantId ?? undefined,
              );
              if (avail.available < comp.totalQuantity) {
                throw new BadRequestException(
                  `Insufficient managed stock for combo component "${compProduct.name}". Available: ${avail.available}, needed: ${comp.totalQuantity}.`,
                );
              }
              await this.stockService.operate('reserve', {
                productId: comp.productId,
                variantId: comp.variantId ?? undefined,
                quantity: comp.totalQuantity,
                reference: `Order Confirm Reserve: ${order.displayId}`,
                performedBy: 'system',
                tx,
              });
              await tx.orderItemComboComponent.update({
                where: { id: comp.id },
                data: { managedStockReserved: true },
              });
            }
          }

          // B. Physical Stock reserve if applicable and IM is ON
          const decision = this.stockRouter.resolve(
            compProduct.availabilityMode,
            'allocate',
            imEnabled,
            compProduct.syncManagedStock ?? undefined,
          );

          if (decision.pi !== 'skip') {
            let compWhId = compProduct.warehouseId;
            if (!compWhId) {
              const firstStock = await tx.physicalInventory.findFirst({
                where: {
                  productId: comp.productId,
                  variantId: comp.variantId || null,
                },
                select: { warehouseId: true },
              });
              compWhId = firstStock?.warehouseId || null;
            }

            if (!compWhId) {
              throw new BadRequestException(
                `"${compProduct.name}" in combo has no physical stock record. Cannot confirm order without physical stock when Inventory Management is active.`,
              );
            }

            const alreadyReserved =
              await this.stockService.hasExistingPhysicalReservation(
                orderId,
                undefined,
                comp.id,
                cycleId,
              );

            if (!alreadyReserved) {
              const existingPi = await tx.physicalInventory.findFirst({
                where: {
                  productId: comp.productId,
                  variantId: comp.variantId || null,
                  warehouseId: compWhId,
                },
              });
              if (!existingPi) {
                throw new BadRequestException(
                  `"${compProduct.name}" in combo has no physical stock record in warehouse. Cannot confirm order.`,
                );
              }
              const availablePhysical =
                existingPi.quantity - existingPi.reservedQuantity;
              if (availablePhysical < comp.totalQuantity) {
                throw new BadRequestException(
                  `Insufficient physical stock for combo component "${compProduct.name}". Available: ${availablePhysical}, needed: ${comp.totalQuantity}.`,
                );
              }

              await this.stockService.reservePhysicalAllocated({
                orderId,
                cycleId,
                comboComponentId: comp.id,
                productId: comp.productId,
                variantId: comp.variantId ?? undefined,
                warehouseId: compWhId,
                quantity: comp.totalQuantity,
                tx,
              });
            }
          }
        }
        continue;
      }

      // ── 2. Standalone Items ──────────────────────────────────────────────────
      const product = item.product;
      if (!product) continue;
      if (product.availabilityMode === 'ALWAYS_OUT_OF_STOCK') {
        throw new BadRequestException(
          `Product "${product.name}" is out of stock and cannot be ordered`,
        );
      }

      if (product.availabilityMode === 'MANAGED_STOCK') {
        if (product.manageStock) {
          if (!item.managedStockReserved) {
            const avail = await this.stockService.getAvailableStock(
              item.productId!,
              item.variantId ?? undefined,
            );
            if (avail.available < item.quantity) {
              throw new BadRequestException(
                `Insufficient stock for "${product.name}". Available: ${avail.available}, needed: ${item.quantity}.`,
              );
            }

            await this.resolveAndApplyStock(
              'reserve',
              item.productId,
              item.variantId ?? undefined,
              item.quantity,
              order.displayId,
              tx,
              {
                orderId,
                orderItemId: item.id,
              },
            );
          }

          const decision = this.stockRouter.resolve(
            product.availabilityMode,
            'allocate',
            imEnabled,
            product.syncManagedStock ?? undefined,
          );

          if (decision.pi !== 'skip') {
            let whId = product.warehouseId;
            if (!whId) {
              const firstStock = await tx.physicalInventory.findFirst({
                where: {
                  productId: item.productId!,
                  variantId: item.variantId || null,
                },
                select: { warehouseId: true },
              });
              whId = firstStock?.warehouseId || null;
            }

            if (!whId) {
              throw new BadRequestException(
                `"${product.name}" এর Physical Inventory-তে কোনো Stock রেকর্ড নেই। ` +
                  `Inventory Management চালু থাকলে Physical Stock ছাড়া Order Confirm করা যাবে না।`,
              );
            }

            const alreadyReserved =
              await this.stockService.hasExistingPhysicalReservation(
                orderId,
                item.id,
                undefined,
                cycleId,
              );
            if (!alreadyReserved) {
              const existingPi = await tx.physicalInventory.findFirst({
                where: {
                  productId: item.productId!,
                  variantId: item.variantId || null,
                  warehouseId: whId,
                },
              });
              if (!existingPi) {
                throw new BadRequestException(
                  `"${product.name}" এর Physical Inventory-তে কোনো Stock রেকর্ড নেই। ` +
                    `Inventory Management চালু থাকলে Physical Stock ছাড়া Order Confirm করা যাবে না।`,
                );
              }
              const availablePhysical =
                existingPi.quantity - existingPi.reservedQuantity;
              if (availablePhysical < item.quantity) {
                throw new BadRequestException(
                  `"${product.name}" এর Physical Stock অপর্যাপ্ত। ` +
                    `Available: ${availablePhysical}, Needed: ${item.quantity}। ` +
                    `Inventory Management চালু থাকলে Physical Stock ছাড়া Order Confirm করা যাবে না।`,
                );
              }
              await this.stockService.reservePhysicalAllocated({
                orderId,
                cycleId,
                orderItemId: item.id,
                productId: item.productId!,
                variantId: item.variantId ?? undefined,
                warehouseId: whId,
                quantity: item.quantity,
                tx,
              });
            }
          }
        }
      }

      if (product.availabilityMode === 'INVENTORY_CONTROLLED') {
        if (imEnabled) {
          let icWhId = product.warehouseId;
          if (!icWhId) {
            const firstStock = await tx.physicalInventory.findFirst({
              where: {
                productId: item.productId!,
                variantId: item.variantId || null,
              },
              select: { warehouseId: true },
            });
            icWhId = firstStock?.warehouseId || null;
          }

          if (icWhId) {
            const alreadyReserved =
              await this.stockService.hasExistingPhysicalReservation(
                orderId,
                item.id,
                undefined,
                cycleId,
              );
            if (!alreadyReserved) {
              const existingPi = await tx.physicalInventory.findFirst({
                where: {
                  productId: item.productId!,
                  variantId: item.variantId || null,
                  warehouseId: icWhId,
                },
              });
              if (!existingPi) {
                throw new BadRequestException(
                  `Insufficient physical stock for "${product.name}". No physical inventory record found.`,
                );
              }
              const availablePhysical =
                existingPi.quantity - existingPi.reservedQuantity;
              if (availablePhysical < item.quantity) {
                throw new BadRequestException(
                  `Insufficient physical stock for "${product.name}". Available: ${availablePhysical}, needed: ${item.quantity}.`,
                );
              }
              await this.stockService.reservePhysicalAllocated({
                orderId,
                cycleId,
                orderItemId: item.id,
                productId: item.productId!,
                variantId: item.variantId ?? undefined,
                warehouseId: icWhId,
                quantity: item.quantity,
                tx,
              });
            } else {
              const physAvail =
                await this.stockService.checkPhysicalAvailability(
                  item.productId!,
                  icWhId,
                  item.variantId ?? undefined,
                );
              if (physAvail.availableStock < 0) {
                throw new BadRequestException(
                  `Insufficient physical stock for "${product.name}". Available: ${physAvail.availableStock}, needed: ${item.quantity}.`,
                );
              }
            }
          }
        }
      }
    }
  }

  /**
   * Fire the instant Purchase capture inside the order transaction. Settings
   * are pre-loaded outside the tx (see create()) to avoid non-transactional
   * reads. DB errors propagate to the caller → transaction rollback, ensuring
   * a committed order always has a durable Purchase intent.
   */
  private async firePurchaseInstant(
    order: any,
    tx: Prisma.TransactionClient,
    preloadedSettings: Record<string, string> = {},
  ) {
    const settingMap = preloadedSettings;
    const metaInstant =
      (settingMap['tracking_meta_purchase_mode'] || 'instant') === 'instant';
    const tiktokInstant =
      (settingMap['tracking_tiktok_purchase_mode'] || 'instant') === 'instant';

    if (!metaInstant && !tiktokInstant) return;

    // Check order source eligibility before capturing
    const eligibility = await this.eligibilityGate.checkOrderEvent('Purchase', order.id);
    if (!eligibility.eligible) {
      this.logger.log(`Skipping instant Purchase for order ${order.id}: ${eligibility.reason}`);
      return;
    }

    await this.buildAndSendPurchaseEvent(order, 'instant', tx);
  }

  private async firePurchaseValidated(
    statusName: string,
    order: any,
    tx?: Prisma.TransactionClient,
  ) {
    try {
      const settings = await this.prisma.systemSetting.findMany({
        where: {
          key: {
            in: [
              'tracking_meta_purchase_mode',
              'tracking_tiktok_purchase_mode',
              'tracking_meta_validated_status',
              'tracking_tiktok_validated_status',
            ],
          },
        },
      });
      const settingMap = Object.fromEntries(
        settings.map((s: any) => [s.key, s.value]),
      );
      const metaMode = settingMap['tracking_meta_purchase_mode'] || 'instant';
      const tiktokMode = settingMap['tracking_tiktok_purchase_mode'] || 'instant';
      const metaStatus = settingMap['tracking_meta_validated_status'] || '';
      const tiktokStatus = settingMap['tracking_tiktok_validated_status'] || '';

      // Canonical trigger: a validated Purchase fires only when the order
      // reaches the configured validated status AND the provider is in
      // validated mode. Gating on mode keeps the two trigger paths mutually
      // exclusive (one Purchase per order) so payment verification can never
      // add a second Purchase on top of an instant-mode capture.
      const metaFires = metaMode === 'validated' && metaStatus === statusName;
      const tiktokFires =
        tiktokMode === 'validated' && tiktokStatus === statusName;

      if (!metaFires && !tiktokFires) return;

      // Check order source eligibility before capturing
      const eligibility = await this.eligibilityGate.checkOrderEvent('Purchase', order.id);
      if (!eligibility.eligible) {
        this.logger.log(`Skipping validated Purchase for order ${order.id}: ${eligibility.reason}`);
        return;
      }

      const result = await this.buildAndSendPurchaseEvent(order, 'validated', tx);
      // Instant capture already owns the canonical snapshot (same deterministic
      // eventId → DEDUPED): revive providers deferred at dispatch time so the
      // SAME event is now delivered to the validated-mode providers.
      if (result?.status === 'DEDUPED') {
        const providers = [
          ...(metaFires ? ['meta'] : []),
          ...(tiktokFires ? ['tiktok'] : []),
        ];
        await this.trackingCapture.ensureValidatedDispatch(
          `purchase_${order.id}`,
          providers,
        );
      }
    } catch (err) {
      this.logger.error('Failed to fire validated purchase event:', err);
    }
  }

  /**
   * Canonical order tracking data shared by Purchase and the five
   * order-lifecycle custom events (OrderPlaced/OrderConfirmed/OrderCancelled/
   * OrderDelivered/OrderReturned). Single source of truth for: customer
   * identity precedence, SKU chain, state/zip/division resolution, currency,
   * action source, and frozen capture-time tracking identity. Returns
   * everything EXCEPT eventId/eventType/triggerMode — callers stamp their own
   * deterministic identity on top. This is what keeps Purchase and custom
   * events from drifting apart field by field.
   */
  private async buildCanonicalOrderTrackingData(
    order: any,
    opts: { eventTimeSec: number },
  ): Promise<{
    businessOrderId: string;
    orderIdColumn: string;
    ctxId?: string;
    eventTime: number;
    actionSource: string;
    configSnapshot: Record<string, unknown>;
    payload: Record<string, unknown>;
  }> {
    let email = '';
    let phone = '';
    let firstName = '';
    let lastName = '';
    let city = '';
    let state = '';
    let zip = '';
    let country = 'BD';

    // Order-time customer snapshot (PREFERRED): immutable record of customer
    // data at order creation time. This is the authoritative source for Purchase
    // tracking events because it preserves what was known when the order was
    // placed, independent of later CustomerProfile mutations.
    email = order.customerEmail || '';
    phone = order.customerPhone || '';
    firstName = order.customerFirstName || '';
    lastName = order.customerLastName || '';
    city = order.customerCity || '';
    state = order.customerState || '';
    zip = order.customerZip || '';
    country = order.customerCountry || 'BD';

    // Fallback to shippingAddress JSON for fields not in the snapshot
    // (legacy orders created before the snapshot was added).
    const shippingAddr = order.shippingAddress || {};
    if (typeof shippingAddr === 'object') {
      if (!phone) phone = shippingAddr.phone || '';
      if (!firstName) firstName = shippingAddr.name || '';
      if (!city) city = shippingAddr.city || shippingAddr.district || '';
      if (!state) state = shippingAddr.state || shippingAddr.division || resolveDivision(shippingAddr.district) || '';
      if (!zip) zip = shippingAddr.zip || shippingAddr.zipCode || shippingAddr.postalCode || '';
      if (shippingAddr.country && !order.customerCountry) country = shippingAddr.country;
    }

    // Fallback to CustomerProfile for fields not in the snapshot
    // (legacy orders created before the snapshot was added).
    if (order.customer) {
      if (!email) email = order.customer.email || '';
      if (!phone) phone = order.customer.phone || '';
      if (!firstName) firstName = order.customer.name || '';
      if (!lastName) lastName = order.customer.lastName || '';
    }

    // Fallback to guest fields for legacy orders.
    if (!phone) phone = order.guestPhone || '';
    if (!firstName) firstName = order.guestName || '';

    const itemsList = (order.items as any[]) || [];
    const totalValue = Number(order.total || order.subtotal || 0);

    const contents = itemsList.map((i: any) => {
      // Number(undefined) is NaN (typeof NaN === 'number') — JSON turns it into
      // null and Meta rejects the row (2804008). Omit a non-finite price so the
      // content row survives on every provider.
      const price = Number(i.price);
      return {
        id: i.variant?.sku || i.product?.sku || i.productId || i.comboId || '',
        quantity: i.quantity,
        ...(Number.isFinite(price) ? { item_price: price } : {}),
      };
    });

    // content_name/content_category drive Meta catalog matching. Single values
    // from the first line item keep both sides (browser + CAPI) in lockstep.
    const firstItem = itemsList[0];
    const contentName = firstItem
      ? firstItem.product?.name || firstItem.combo?.name || undefined
      : undefined;
    const contentCategory = firstItem?.product?.category?.name || undefined;

    // Business event time is caller-supplied: instant Purchase = order
    // creation, validated Purchase = the actual qualifying status transition
    // (now — a late validation must not backdate to checkout time), lifecycle
    // events = their transition moment.
    const createdAt = opts.eventTimeSec;

    const actionSource = resolveActionSource(order);

    const configSnapshot = await this.trackingSettings.buildConfigSnapshot();

    // orderId = human-readable displayId (Meta custom_data.order_id) for
    // business-order identification; event_id = purchase_{internal UUID} for
    // dedup — the two serve different purposes and must never be conflated.
    // The event_id reaches Meta unchanged so Pixel + CAPI dedup correctly.
    const businessOrderId = order.displayId || order.id;

    // Freeze the order-time tracking identity so the Purchase payload uses the
    // exact identity that existed at checkout — not a later-mutated live context.
    // The dispatcher reads this snapshot field instead of dereferencing ctxId
    // against the mutable TrackingContext table.
    let trackingIdentity: import('../tracking/tracking-snapshot.types').FrozenTrackingIdentity | undefined;
    if (order.trackingSessionId) {
      try {
        const ctx = await this.trackingContext.getByCtxId(order.trackingSessionId);
        if (ctx) {
          const identifiers = (ctx.identifiers ?? {}) as unknown as StoredIdentifiers;
          trackingIdentity = {
            ip: ctx.ip || undefined,
            userAgent: ctx.userAgent || undefined,
            url: ctx.url || undefined,
            referrer: ctx.referrer || undefined,
            externalId: ctx.externalId || undefined,
            fbp: identifiers.meta?.fbp?.value,
            fbc: identifiers.meta?.fbc?.value,
            gclid: identifiers.google?.gclid?.value,
            ttclid: identifiers.tiktok?.ttclid?.value,
          };
        }
      } catch {
        // Best-effort freeze — if context lookup fails, dispatcher falls back to live
      }
    }

    return {
      businessOrderId,
      orderIdColumn: businessOrderId,
      ctxId: order.trackingSessionId || undefined,
      eventTime: createdAt,
      actionSource,
      configSnapshot: configSnapshot as unknown as Record<string, unknown>,
      payload: {
          value: totalValue,
          currency: (configSnapshot as any).currency || 'BDT',
          content_ids: itemsList
            .map((i: any) => i.variant?.sku || i.product?.sku || i.productId || i.comboId || '')
            .filter(Boolean),
          content_type: 'product',
          content_name: contentName,
          content_category: contentCategory,
          contents,
          num_items: itemsList.reduce(
            (s: number, i: any) => s + (i.quantity || 0),
            0,
          ),
          customerId: order.customerId ?? undefined,
          orderId: businessOrderId,
          ...(trackingIdentity ? { trackingIdentity } : {}),
          customer: {
            email: email || undefined,
            phone: phone || undefined,
            firstName: firstName || undefined,
            lastName: lastName || undefined,
            city: city || undefined,
            state: state || undefined,
            zip: zip || undefined,
            country: country || undefined,
          },
      },
    };
  }

  private async buildAndSendPurchaseEvent(
    order: any,
    mode: 'instant' | 'validated',
    tx?: Prisma.TransactionClient,
  ): Promise<{ status: 'CAPTURED' | 'DEDUPED'; snapshotId?: string } | undefined> {
    // CRITICAL: The business event_time MUST always represent the original order
    // creation instant (T0), regardless of when the Purchase is triggered.
    // For validated mode, the Purchase is DISPATCHED at T1 (confirmation time)
    // but the event_time must still be T0 (order creation time).
    // Using Date.now() here would incorrectly backdate the event to T1.
    const eventTimeSec = order.createdAt
      ? Math.floor(new Date(order.createdAt).getTime() / 1000)
      : Math.floor(Date.now() / 1000);
    const base = await this.buildCanonicalOrderTrackingData(order, {
      eventTimeSec,
    });
    return this.trackingCapture.capture(
      {
        eventId: `purchase_${order.id}`,
        eventType: 'Purchase',
        orderId: base.orderIdColumn,
        ctxId: base.ctxId,
        eventTime: base.eventTime,
        actionSource: base.actionSource,
        payload: {
          triggerMode: mode,
          ...base.payload,
        },
        configSnapshot: base.configSnapshot as any,
      },
      tx,
    );
  }

  /**
   * Order status → lifecycle custom event. Emits at most one logical event per
   * (order, target status): the deterministic `order_<stage>_<orderId>` id
   * collapses repeats, retries, and concurrent writers through the snapshot
   * eventId UNIQUE (second writer gets DEDUPED, no new snapshot/outbox).
   * Self-contained: never throws, never rolls back the caller's transaction.
   */
  /**
   * Public so DispatchService's courier-sync path (which writes statusId
   * directly, bypassing updateStatus) can emit the same lifecycle events.
   * Server-resolved order only — never accepts a client-supplied identity.
   */
  async fireOrderStatusLifecycleEvent(
    order: any,
    fromStatusName: string | null | undefined,
    toStatusName: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    try {
      const mapping =
        ORDER_STATUS_LIFECYCLE_EVENT[
          toStatusName as keyof typeof ORDER_STATUS_LIFECYCLE_EVENT
        ];
      // Unmapped statuses (Hold, Packed, Shipping, ...) emit nothing, and a
      // same-status rewrite (prev === new) is never a transition.
      if (!mapping) return;
      if (fromStatusName && fromStatusName === toStatusName) return;

      // Check order source eligibility before capturing lifecycle event
      const eligibility = await this.eligibilityGate.checkOrderEvent(mapping.eventType, order.id);
      if (!eligibility.eligible) {
        this.logger.log(`Skipping ${mapping.eventType} for order ${order.id}: ${eligibility.reason}`);
        return;
      }

      const base = await this.buildCanonicalOrderTrackingData(order, {
        eventTimeSec: Math.floor(Date.now() / 1000),
      });
      await this.trackingCapture.capture(
        {
          eventId: `order_${mapping.stage}_${order.id}`,
          eventType: mapping.eventType,
          orderId: base.orderIdColumn,
          ctxId: base.ctxId,
          eventTime: base.eventTime,
          actionSource: base.actionSource,
          payload: {
            lifecycleStage: mapping.stage,
            lifecycleFromStatus: fromStatusName || undefined,
            lifecycleToStatus: toStatusName,
            ...base.payload,
          },
          configSnapshot: base.configSnapshot as any,
        },
        tx,
      );
    } catch (err) {
      this.logger.error(
        `Failed to capture order lifecycle event for order ${order?.id} (${fromStatusName} → ${toStatusName}):`,
        err,
      );
    }
  }

  /**
   * Order receipt lifecycle event. Fires ONLY when no instant Purchase fired
   * at creation (instant Purchase already signals receipt). Validated-mode
   * orders therefore get OrderPlaced at birth and Purchase later at the
   * configured status. Idempotent via `order_placed_<orderId>`.
   */
  private async fireOrderPlacedEvent(
    order: any,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    try {
      // Check order source eligibility before capturing
      const eligibility = await this.eligibilityGate.checkOrderEvent('OrderPlaced', order.id);
      if (!eligibility.eligible) {
        this.logger.log(`Skipping OrderPlaced for order ${order.id}: ${eligibility.reason}`);
        return;
      }

      const base = await this.buildCanonicalOrderTrackingData(order, {
        eventTimeSec: order.createdAt
          ? Math.floor(new Date(order.createdAt).getTime() / 1000)
          : Math.floor(Date.now() / 1000),
      });
      await this.trackingCapture.capture(
        {
          eventId: `order_placed_${order.id}`,
          eventType: 'OrderPlaced',
          orderId: base.orderIdColumn,
          ctxId: base.ctxId,
          eventTime: base.eventTime,
          actionSource: base.actionSource,
          payload: {
            lifecycleStage: 'placed',
            ...base.payload,
          },
          configSnapshot: base.configSnapshot as any,
        },
        tx,
      );
    } catch (err) {
      this.logger.error(
        `Failed to capture OrderPlaced event for order ${order?.id}:`,
        err,
      );
    }
  }

  private async fireRefundEvent(order: any, tx?: Prisma.TransactionClient) {
    try {
      // Check order source eligibility before capturing
      const eligibility = await this.eligibilityGate.checkOrderEvent('Refund', order.id);
      if (!eligibility.eligible) {
        this.logger.log(`Skipping Refund for order ${order.id}: ${eligibility.reason}`);
        return;
      }

      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: 'tracking_refund_enabled' },
      });
      if (setting?.value === 'false') return;

      const itemsList = (order.items as any[]) || [];
      const totalValue = Number(order.total || 0);
      if (totalValue <= 0) return;

      // Refund pairing gate: only emit a Refund for an order whose Purchase
      // event was captured AND either already delivered to providers (SENT) or
      // still deliverable (PENDING/CLAIMED/RETRY in-flight). Skip only when the
      // Purchase definitively never reached Meta/TikTok:
      //   - no Purchase capture at all (order never hit the configured trigger)
      //   - Purchase outbox DEAD (5 failed attempts — never delivered)
      //   - Purchase outbox missing (corrupted pipeline state)
      // An order that never produced a Purchase must not emit a standalone
      // refund — Meta/TikTok would record negative revenue with no matching
      // purchase. Same eventId contract as every Purchase path
      // (`purchase_{order.id}` in orders/POS/checkout-leads), so one lookup
      // covers instant, validated, and offline captures.
      const client = (tx ?? this.prisma) as Prisma.TransactionClient;
      const purchaseSnapshot = await client.trackingSnapshot.findUnique({
        where: { eventId: `purchase_${order.id}` },
        select: { id: true },
      });
      if (!purchaseSnapshot) {
        this.logger.log(
          `Skipping refund event for order ${order.id}: no Purchase capture exists (purchase never sent)`,
        );
        return;
      }
      const purchaseOutbox = await client.trackingOutbox.findUnique({
        where: { snapshotId: purchaseSnapshot.id },
        select: { status: true },
      });
      if (!purchaseOutbox || purchaseOutbox.status === 'DEAD') {
        this.logger.log(
          `Skipping refund event for order ${order.id}: Purchase never delivered to providers (outbox ${purchaseOutbox?.status ?? 'missing'})`,
        );
        return;
      }

      let phone = '';
      let firstName = '';
      const country = 'BD';
      if (order.customer) {
        phone = order.customer.phoneNumber || '';
        firstName = order.customer.firstName || '';
      }
      if (!phone) phone = order.guestPhone || '';
      if (!firstName) firstName = order.guestName || '';

      const actionSource = resolveActionSource(order);

      const configSnapshot = await this.trackingSettings.buildConfigSnapshot();

      const businessOrderId = order.displayId || order.id;

      await this.trackingCapture.capture(
        {
          eventId: `refund_${order.id}`,
          eventType: 'Refund',
          orderId: businessOrderId,
          ctxId: order.trackingSessionId || undefined,
          eventTime: Math.floor(Date.now() / 1000),
          actionSource,
          payload: {
            value: -totalValue,
            currency: (configSnapshot as any).currency || 'BDT',
            content_ids: itemsList
              .map((i: any) => i.variant?.sku || i.product?.sku || i.productId || i.comboId || '')
              .filter(Boolean),
            content_type: 'product',
            contents: itemsList.map((i: any) => {
              const price = Number(i.price);
              return {
                id: i.variant?.sku || i.product?.sku || i.productId || i.comboId || '',
                quantity: i.quantity,
                ...(Number.isFinite(price) ? { item_price: price } : {}),
              };
            }),
            num_items: itemsList.reduce(
              (s: number, i: any) => s + (i.quantity || 0),
              0,
            ),
            customerId: order.customerId ?? undefined,
            orderId: businessOrderId,
            customer: {
              phone: phone || undefined,
              firstName: firstName || undefined,
              country,
            },
          },
          configSnapshot,
        },
        tx,
      );
    } catch (err) {
      this.logger.error('Failed to fire refund event:', err);
    }
  }
}
