/**
 * Business analytics filter service (P2 data layer, §4.1).
 *
 * Single filter pipeline every analytics service consumes. Column-mappable
 * filters become a Prisma Order where clause (trashed excluded always);
 * marketing source resolves to order ids DB-side; customer segment is derived
 * server-side over the recognised candidate set (recognition lives in
 * timeline JSONB, so no static where can express it — this is backend
 * filtering, never client-side).
 */
import { Injectable, BadRequestException } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhone } from '../common/utils/phone-utils';
import {
  ORDER_STATUSES,
  recognitionGroup,
} from './metric-contract';
import {
  resolveAnalyticsRange,
  type AnalyticsRange,
} from './analytics-range.util';
import {
  AnalyticsFilterDto,
  MARKETING_UNATTRIBUTED,
  type CustomerSegment,
} from './analytics-filter.dto';

export { MARKETING_UNATTRIBUTED };

/**
 * VIP default policy — not a universal truth. A returning customer (recognised
 * order before the range) with at least this many lifetime recognised orders
 * counts as VIP. Returned in API thresholds so the UI labels the policy.
 */
export const VIP_MIN_LIFETIME_RECOGNISED_ORDERS = 5;
export const VIP_POLICY_RATIONALE =
  'Default loyalty policy: VIP means returning (recognised revenue before ' +
  'the range) plus at least 5 lifetime recognised orders. Not a universal ' +
  'truth — the UI labels the policy.';

export interface ResolvedAnalyticsContext {
  range: AnalyticsRange;
  filters: AnalyticsFilterDto;
}

export interface RecognisedEvent {
  key: string;
  at: Date;
}

/**
 * Marketing Source resolution (analytical dimension — never Order.source,
 * never Order.sourcePlatform).
 * Attribution chain → platform slug; else session utmSource; else unattributed.
 */
export function resolveMarketingSource(
  attribution: {
    campaign?: {
      adAccount?: { connection?: { platform?: { slug?: string } } };
    } | null;
  } | null,
  session: { utmSource?: string | null } | null,
): string {
  const slug =
    attribution?.campaign?.adAccount?.connection?.platform?.slug;
  if (slug) return slug;
  if (session?.utmSource) return session.utmSource;
  return MARKETING_UNATTRIBUTED;
}

/** Lifetime recognised history per customer key (first date + count). */
export function deriveCustomerSegments(
  events: RecognisedEvent[],
): Map<string, { firstAt: Date; lifetime: number }> {
  const map = new Map<string, { firstAt: Date; lifetime: number }>();
  for (const event of events) {
    const entry = map.get(event.key);
    if (!entry) {
      map.set(event.key, { firstAt: event.at, lifetime: 1 });
    } else {
      entry.lifetime += 1;
      if (event.at < entry.firstAt) entry.firstAt = event.at;
    }
  }
  return map;
}

/** Stable customer key: profile id, else normalized phone, else unattributed. */
export function customerKeyOf(order: {
  customerId?: string | null;
  customerPhone?: string | null;
  guestPhone?: string | null;
}): string {
  if (order.customerId) return `customer:${order.customerId}`;
  const phone = normalizePhone(
    order.customerPhone ?? order.guestPhone ?? '',
  );
  if (phone) return `phone:${phone}`;
  return 'unattributed';
}

@Injectable()
export class AnalyticsFilterService {
  constructor(private readonly prisma: PrismaService) {}

  resolveContext(query: AnalyticsFilterDto): ResolvedAnalyticsContext {
    const preset = query.preset ?? 'last_30_days';
    if (preset === 'custom' && (!query.startDate || !query.endDate)) {
      throw new BadRequestException(
        'custom preset requires both startDate and endDate (YYYY-MM-DD)',
      );
    }
    const range = resolveAnalyticsRange({
      preset,
      startDate: query.startDate,
      endDate: query.endDate,
    });
    if (query.granularity) range.granularity = query.granularity;
    return { range, filters: query };
  }

  segmentOf(
    key: string,
    range: Pick<AnalyticsRange, 'start'>,
    history: Map<string, { firstAt: Date; lifetime: number }>,
  ): CustomerSegment {
    const entry = history.get(key);
    if (!entry || entry.firstAt >= range.start) return 'new';
    if (entry.lifetime >= VIP_MIN_LIFETIME_RECOGNISED_ORDERS) return 'vip';
    return 'returning';
  }

  /**
   * Column-mappable filters as a Prisma where clause. Trashed orders are
   * excluded unconditionally. marketingOrderIds (when the marketingSource
   * filter is set) comes from resolveMarketingOrderIds — DB-side, never
   * client-side. customerSegment is intentionally absent here: it is derived
   * server-side via segmentOf (see module docblock).
   */
  buildOrderWhere(
    filters: AnalyticsFilterDto,
    marketingOrderIds?: string[],
  ): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = { trashedAt: null };

    if (filters.source) where.source = filters.source as any;
    if (filters.salesChannel) where.salesChannel = filters.salesChannel as any;

    if (filters.paymentMethod) {
      where.payments = {
        some: {
          gatewayCode: filters.paymentMethod,
          status: PaymentStatus.PAID,
        },
      };
    }

    const itemOr: Prisma.OrderItemWhereInput[] = [];
    if (filters.productId) {
      itemOr.push({ productId: filters.productId });
      itemOr.push({
        comboComponents: { some: { productId: filters.productId } },
      });
    }
    if (filters.variantId) {
      itemOr.push({ variantId: filters.variantId });
      itemOr.push({
        comboComponents: { some: { variantId: filters.variantId } },
      });
    }
    if (filters.categoryId) {
      const categoryMatch = {
        OR: [
          { categoryId: filters.categoryId },
          { productCategories: { some: { categoryId: filters.categoryId } } },
        ],
      };
      itemOr.push({ product: categoryMatch } as any);
      itemOr.push({ comboComponents: { some: { product: categoryMatch } } } as any);
    }
    if (filters.warehouseId) {
      // Warehouse narrows the same item cohort (AND with the OR above).
      where.items = {
        ...(where.items as Prisma.OrderItemListRelationFilter),
        some: {
          ...((where.items as any)?.some ?? {}),
          sourceWarehouseId: filters.warehouseId,
        },
      };
    }
    if (itemOr.length > 0) {
      const existingSome = (where.items as any)?.some ?? {};
      // Product/variant/category alternatives widen within the item cohort;
      // the warehouse predicate (already in existingSome) still applies.
      if (existingSome.sourceWarehouseId) {
        where.items = {
          some: { AND: [{ OR: itemOr }, existingSome] } as any,
        };
      } else {
        where.items = { some: { OR: itemOr } };
      }
    }

    // Each dimension's alternatives widen WITHIN that dimension only: the
    // per-dimension ORs nest inside a top-level AND so that combining
    // dimensions (location × collection status × …) always narrows. A shared
    // where.OR across dimensions would widen instead (an order matching ANY
    // dimension would pass).
    const and: Prisma.OrderWhereInput[] = [];
    if (filters.location) {
      const q = filters.location;
      and.push({
        OR: [
          { customerCity: { contains: q, mode: 'insensitive' } },
          { customerState: { contains: q, mode: 'insensitive' } },
          { customerZip: { contains: q, mode: 'insensitive' } },
        ],
      });
    }

    if (filters.deliveryOutcome) {
      where.status = { name: { in: deliveryOutcomeStatuses(filters.deliveryOutcome) } };
    }

    if (filters.collectionStatus === 'online-collected') {
      where.paymentOptionType = {
        in: ['FULL_PAYMENT', 'PARTIAL_PAYMENT'] as any,
      };
    } else if (filters.collectionStatus === 'cod-unavailable') {
      // COD plus unknown (NULL paymentOptionType): collection unconfirmed
      // either way, so both sit in the unavailable bucket (D11-strict).
      and.push({
        OR: [
          { paymentOptionType: 'CASH_ON_DELIVERY' as any },
          { paymentOptionType: null as any },
        ],
      });
    }

    if (and.length > 0) {
      const existing = Array.isArray(where.AND)
        ? where.AND
        : where.AND
          ? [where.AND]
          : [];
      where.AND = [...existing, ...and];
    }

    if (marketingOrderIds !== undefined) {
      where.id = { in: marketingOrderIds };
    }

    return where;
  }

  /**
   * DB-side marketing-source → order ids. Platform slug matches the
   * attribution chain; anything else matches session utmSource; the
   * 'unattributed' literal matches orders with no attribution row.
   */
  async resolveMarketingOrderIds(source: string): Promise<string[]> {
    if (source === MARKETING_UNATTRIBUTED) {
      const rows = await this.prisma.order.findMany({
        where: { trashedAt: null, orderAttribution: null as any },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }
    // The attribution-chain and session lookups are independent reads —
    // issue them together (the session-token → order lookup below still
    // depends on the session rows, so it stays sequential).
    const [attributed, sessions] = await Promise.all([
      this.prisma.orderAttribution.findMany({
        where: {
          campaign: {
            adAccount: { connection: { platform: { slug: source as any } } },
          },
        } as any,
        select: { orderId: true },
      }),
      this.prisma.marketingSession.findMany({
        where: { utmSource: source },
        select: { sessionToken: true },
      }),
    ]);
    const tokens = sessions.map((s) => s.sessionToken).filter(Boolean);
    const viaSessions =
      tokens.length > 0
        ? await this.prisma.order.findMany({
            where: { trashedAt: null, trackingSessionId: { in: tokens } },
            select: { id: true },
          })
        : [];
    return Array.from(
      new Set([
        ...attributed.map((a) => a.orderId),
        ...viaSessions.map((o) => o.id),
      ]),
    );
  }
}

/** Current-status name sets per delivery outcome (metric-contract groups). */
export function deliveryOutcomeStatuses(
  outcome: 'delivered' | 'returned' | 'in_fulfilment' | 'cancelled',
): string[] {
  switch (outcome) {
    case 'delivered':
      return ['Delivered'];
    case 'returned':
      return ['Returned', 'Damaged'];
    case 'cancelled':
      return ['Cancelled'];
    case 'in_fulfilment':
      return ORDER_STATUSES.filter((name) => {
        const group = recognitionGroup(name);
        if (name === 'Return Pending') return true;
        return (
          group === 'pre_fulfilment' ||
          group === 'in_fulfilment' ||
          group === 'unrecognised_flagged'
        );
      }) as string[];
  }
}
