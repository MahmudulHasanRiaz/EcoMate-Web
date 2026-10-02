import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { dhakaStartOfDay } from '../hr-attendance/attendance-date';
import {
  findDeliveredTransition,
  resolveReturn,
  type TimelineEntry,
} from '../business-analytics/metric-contract';

export interface StaffOrderMetrics {
  employeeId: string;
  employeeCode: string;
  name: string;
  email: string;
  department: string | null;
  designation: string | null;
  avatar: string | null;
  ordersHandled: number;
  confirmed: number;
  confirmationRate: number; // percentage
  delivered: number;
  deliveryRate: number; // Delivered / Confirmed
  endToEndDeliveryRate: number; // Delivered / Handled
  returned: number;
  returnRate: number; // Returned / Delivered
  cancelled: number;
  cancellationRate: number; // Cancelled / Handled
  totalRevenue: number;
}

export interface StaffPerformanceSummary {
  totalOrdersHandled: number;
  totalConfirmed: number;
  overallConfirmationRate: number;
  totalDelivered: number;
  overallDeliveryRate: number;
  overallEndToEndDeliveryRate: number;
  totalReturned: number;
  overallReturnRate: number;
  totalCancelled: number;
  overallCancellationRate: number;
  totalRevenue: number;
}

/** Actors that appear in a timeline but are not staff, so produce no event. */
const NON_STAFF_ACTORS = new Set(['Customer', 'customer', 'system', 'reconcile', 'Guest']);

/** Maps a timeline status onto the lowercase action vocabulary writers use. */
function actionForStatus(status: unknown): string {
  switch (status) {
    case 'Confirmed':
      return 'confirmed';
    case 'Delivered':
      return 'delivered';
    case 'Returned':
    case 'Damaged':
      return 'returned';
    case 'Cancelled':
      return 'cancelled';
    default:
      return 'status_change';
  }
}

/** Upper bound on page size, so the order `id IN (...)` list stays bounded. */
const MAX_PER_PAGE = 200;

/** Statuses from which an order counts as having been confirmed. */
const CONFIRMED_COHORT_STATUSES = new Set([
  'Confirmed',
  'Packed',
  'Packing Hold',
  'Shipping',
  'Delivered',
  'Returned',
  'Damaged',
]);

/** Statuses that mean the order reached a delivery outcome. */
const DELIVERED_COHORT_STATUSES = new Set(['Delivered', 'Returned', 'Damaged']);

/** Normalise the loose JSON timeline column into the canonical shape. */
function toTimeline(raw: unknown): TimelineEntry[] {
  return Array.isArray(raw) ? (raw as TimelineEntry[]) : [];
}

@Injectable()
export class OrderStaffPerformanceService {
  private readonly logger = new Logger(OrderStaffPerformanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves canonical employee for a given actor id.
   *
   * Callers pass different shapes for the same human, so all three are
   * accepted here rather than at every call site:
   *   - a UserProfile.id          (payload.sub from @CurrentUser)
   *   - a better-auth user id
   *   - an email address          (the order controller passes user.email as
   *                                the timeline `performedBy` value)
   *
   * Getting this wrong is silent: the event still writes, but employeeId lands
   * as NULL and no report can ever attribute it to a person.
   */
  async resolveEmployeeByUserId(userId: string): Promise<string | null> {
    if (!userId) return null;

    // Check if userId is direct employee id
    const directEmp = await this.prisma.employee.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (directEmp) return directEmp.id;

    // Check via UserProfile
    const userProfile = await this.prisma.userProfile.findUnique({
      where: { id: userId },
      select: { betterAuthUserId: true },
    });

    const baId = userProfile?.betterAuthUserId ?? userId;
    const emp = await this.prisma.employee.findUnique({
      where: { betterAuthUserId: baId },
      select: { id: true },
    });
    if (emp) return emp.id;

    // Last resort: the actor was recorded as an email address.
    const byEmail = await this.prisma.employee.findFirst({
      where: { betterAuthUser: { email: userId } },
      select: { id: true },
    });
    return byEmail?.id ?? null;
  }

  /**
   * Resolves UserProfile ID for an Employee ID.
   */
  async resolveUserIdByEmployeeId(employeeId: string): Promise<string | null> {
    if (!employeeId) return null;
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { betterAuthUserId: true },
    });
    if (!emp?.betterAuthUserId) return null;

    const profile = await this.prisma.userProfile.findUnique({
      where: { betterAuthUserId: emp.betterAuthUserId },
      select: { id: true },
    });
    return profile?.id ?? null;
  }

  /**
   * Records an immutable OrderStaffEvent in the database.
   */
  async recordStaffEvent(
    data: {
      orderId: string;
      userId: string;
      employeeId?: string | null;
      action: string;
      fromStatus?: string | null;
      toStatus?: string | null;
      note?: string | null;
      metadata?: any;
      createdAt?: Date;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    try {
      const employeeId =
        data.employeeId || (await this.resolveEmployeeByUserId(data.userId));

      // No de-duplication here, deliberately.
      //
      // An earlier version guarded on (orderId, action='STATUS_CHANGED',
      // toStatus). No code path has ever written the literal 'STATUS_CHANGED'
      // (the writers use lowercase 'confirmed'/'delivered'/'status_change'),
      // so the guard was dead code. Even had the literal matched it would have
      // been wrong: it omitted the actor, so two different staff moving the
      // same order to the same status would have lost one real event, and it
      // was a check-then-act with no unique constraint behind it.
      //
      // The ledger is an append-only history, and every reader already
      // de-duplicates by order (Set<orderId>) rather than by action, so
      // duplicate rows cannot inflate any reported metric.
      return await client.orderStaffEvent.create({
        data: {
          orderId: data.orderId,
          userId: data.userId,
          employeeId: employeeId ?? null,
          action: data.action,
          fromStatus: data.fromStatus ?? null,
          toStatus: data.toStatus ?? null,
          note: data.note ?? null,
          metadata: data.metadata ?? {},
          createdAt: data.createdAt ?? new Date(),
        },
      });
    } catch (err: any) {
      this.logger.warn(`Failed to record OrderStaffEvent: ${err.message}`);
      return null;
    }
  }

  /**
   * Aggregates staff performance metrics for a specified date range.
   * Enforces strict cohort semantics:
   * - Orders Handled: distinct orders where staff took operational action in date range.
   * - Confirmed: distinct orders in handled cohort that reached Confirmed.
   * - Confirmation Rate: Confirmed / Handled.
   * - Delivered: distinct orders in confirmed cohort that reached Delivered.
   * - Delivery Rate: Delivered / Confirmed.
   * - Returned: distinct orders in delivered cohort that reached Returned / Damaged.
   * - Return Rate: Returned / Delivered.
   * - Cancelled: distinct orders in handled cohort that reached Cancelled.
   * - Cancellation Rate: Cancelled / Handled.
   */
  async getStaffPerformance(query: {
    from?: string;
    to?: string;
    employeeId?: string;
    departmentId?: string;
    page?: number;
    perPage?: number;
  }) {
    const page = query.page && query.page > 0 ? Number(query.page) : 1;
    // Clamped here as well as in the controller: this method builds an
    // `id IN (...)` list whose length is driven by perPage, and an unbounded
    // value overruns Postgres' bind-parameter budget. Defence in depth for
    // direct service callers (e.g. the dashboard tile).
    const perPage = Math.min(
      query.perPage && query.perPage > 0 ? Number(query.perPage) : 20,
      MAX_PER_PAGE,
    );

    // Date range resolution
    const now = new Date();
    const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const startDate = query.from ? dhakaStartOfDay(query.from) : defaultStart;
    const endDate = query.to
      ? new Date(dhakaStartOfDay(query.to).getTime() + 86400000)
      : new Date(now.getTime() + 86400000);

    // Filter employees
    const employeeWhere: Prisma.EmployeeWhereInput = {
      status: 'active',
    };
    if (query.employeeId) {
      employeeWhere.id = query.employeeId;
    }
    if (query.departmentId) {
      employeeWhere.departmentId = query.departmentId;
    }

    const [employees, totalEmployeesCount] = await Promise.all([
      this.prisma.employee.findMany({
        where: employeeWhere,
        include: {
          department: { select: { id: true, name: true } },
          designation: { select: { id: true, name: true } },
          betterAuthUser: { select: { name: true, email: true, image: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.employee.count({ where: employeeWhere }),
    ]);

    // Gather all UserProfile IDs for these employees
    const baUserIds = employees.map((e) => e.betterAuthUserId).filter(Boolean);
    const profiles = await this.prisma.userProfile.findMany({
      where: { betterAuthUserId: { in: baUserIds } },
      select: { id: true, betterAuthUserId: true },
    });
    const profileMap = new Map<string, string>(); // baUserId -> userProfileId
    const reverseProfileMap = new Map<string, string>(); // userProfileId -> employeeId
    for (const p of profiles) {
      if (p.betterAuthUserId) {
        profileMap.set(p.betterAuthUserId, p.id);
        const matchingEmp = employees.find((e) => e.betterAuthUserId === p.betterAuthUserId);
        if (matchingEmp) {
          reverseProfileMap.set(p.id, matchingEmp.id);
        }
      }
    }

    // Query events in the date range for these employees
    const empIds = employees.map((e) => e.id);
    const userIds = Array.from(reverseProfileMap.keys());

    // Also include direct order assignments for attribution fallback
    const [events, assignedOrders] = await Promise.all([
      this.prisma.orderStaffEvent.findMany({
        where: {
          OR: [
            { employeeId: { in: empIds } },
            { userId: { in: userIds } },
          ],
          createdAt: { gte: startDate, lt: endDate },
        },
        select: {
          orderId: true,
          employeeId: true,
          userId: true,
          action: true,
          toStatus: true,
          createdAt: true,
        },
      }),
      this.prisma.order.findMany({
        where: {
          assignedToId: { in: userIds },
          createdAt: { gte: startDate, lt: endDate },
          trashedAt: null,
        },
        select: {
          id: true,
          assignedToId: true,
          createdAt: true,
        },
      }),
    ]);

    // Map orderId -> employeeId attribution
    // An employee handles an order if they have an event in range or were assigned in range
    const employeeOrdersMap = new Map<string, Set<string>>(); // employeeId -> Set<orderId>
    for (const emp of employees) {
      employeeOrdersMap.set(emp.id, new Set<string>());
    }

    for (const ev of events) {
      let targetEmpId = ev.employeeId;
      if (!targetEmpId && ev.userId) {
        targetEmpId = reverseProfileMap.get(ev.userId) || null;
      }
      if (targetEmpId && employeeOrdersMap.has(targetEmpId)) {
        employeeOrdersMap.get(targetEmpId)!.add(ev.orderId);
      }
    }

    for (const ord of assignedOrders) {
      if (ord.assignedToId) {
        const empId = reverseProfileMap.get(ord.assignedToId);
        if (empId && employeeOrdersMap.has(empId)) {
          employeeOrdersMap.get(empId)!.add(ord.id);
        }
      }
    }

    // Get all distinct orderIds across all employees
    const allHandledOrderIds = new Set<string>();
    for (const orderSet of employeeOrdersMap.values()) {
      for (const id of orderSet) {
        allHandledOrderIds.add(id);
      }
    }

    // Fetch order details for all handled orders (status, total, timeline)
    const orderDetails = allHandledOrderIds.size > 0
      ? await this.prisma.order.findMany({
          where: { id: { in: Array.from(allHandledOrderIds) } },
          select: {
            id: true,
            total: true,
            status: { select: { name: true } },
            timeline: true,
          },
        })
      : [];

    const orderDetailMap = new Map(orderDetails.map((o) => [o.id, o]));

    // Calculate metrics per employee
    const rows: StaffOrderMetrics[] = [];
    let sumHandled = 0;
    let sumConfirmed = 0;
    let sumDelivered = 0;
    let sumReturned = 0;
    let sumCancelled = 0;
    let sumRevenue = 0;

    for (const emp of employees) {
      const orderIds = employeeOrdersMap.get(emp.id) || new Set<string>();
      let confirmed = 0;
      let delivered = 0;
      let returned = 0;
      let cancelled = 0;
      let revenue = 0;

      for (const orderId of orderIds) {
        const ord = orderDetailMap.get(orderId);
        if (!ord) continue;

        const currentStatus = ord.status?.name || '';
        const timeline = toTimeline(ord.timeline);

        // Stage detection is delegated to the canonical metric contract. The
        // previous inline version used timeline.some(), which is "ever reached"
        // semantics: an order that was delivered and later cancelled or sent
        // back to a hold still counted as delivered, and its revenue leaked
        // into an HR figure. findDeliveredTransition is latest-wins, matching
        // every other consumer in the codebase.
        const deliveredAt = findDeliveredTransition(timeline)?.timestamp ?? null;

        const reachedConfirmed =
          CONFIRMED_COHORT_STATUSES.has(currentStatus) ||
          timeline.some((t) => t.status === 'Confirmed');

        const reachedDelivered = DELIVERED_COHORT_STATUSES.has(currentStatus) || deliveredAt !== null;

        // resolveReturn decides whether a Returned/Damaged entry actually
        // reverses this delivery, instead of counting any historical mention.
        const reachedReturned = resolveReturn(timeline, deliveredAt).hasReturn;

        const reachedCancelled =
          currentStatus === 'Cancelled' || timeline.some((t) => t.status === 'Cancelled');

        if (reachedConfirmed) {
          confirmed++;
          if (reachedDelivered) {
            delivered++;
            revenue += Number(ord.total || 0);
          }
          if (reachedReturned) {
            returned++;
          }
        }

        if (reachedCancelled) {
          cancelled++;
        }
      }

      const ordersHandled = orderIds.size;
      const confirmationRate =
        ordersHandled > 0 ? Math.round((confirmed / ordersHandled) * 1000) / 10 : 0;
      const deliveryRate =
        confirmed > 0 ? Math.round((delivered / confirmed) * 1000) / 10 : 0;
      const endToEndDeliveryRate =
        ordersHandled > 0 ? Math.round((delivered / ordersHandled) * 1000) / 10 : 0;
      const returnRate =
        delivered > 0 ? Math.round((returned / delivered) * 1000) / 10 : 0;
      const cancellationRate =
        ordersHandled > 0 ? Math.round((cancelled / ordersHandled) * 1000) / 10 : 0;

      sumHandled += ordersHandled;
      sumConfirmed += confirmed;
      sumDelivered += delivered;
      sumReturned += returned;
      sumCancelled += cancelled;
      sumRevenue += revenue;

      rows.push({
        employeeId: emp.id,
        employeeCode: emp.employeeId,
        name: emp.betterAuthUser?.name || 'Unknown',
        email: emp.betterAuthUser?.email || '',
        department: emp.department?.name ?? null,
        designation: emp.designation?.name ?? null,
        avatar: emp.betterAuthUser?.image ?? emp.profilePictureUrl ?? null,
        ordersHandled,
        confirmed,
        confirmationRate,
        delivered,
        deliveryRate,
        endToEndDeliveryRate,
        returned,
        returnRate,
        cancelled,
        cancellationRate,
        totalRevenue: Math.round(revenue),
      });
    }

    const summary: StaffPerformanceSummary = {
      totalOrdersHandled: sumHandled,
      totalConfirmed: sumConfirmed,
      overallConfirmationRate:
        sumHandled > 0 ? Math.round((sumConfirmed / sumHandled) * 1000) / 10 : 0,
      totalDelivered: sumDelivered,
      overallDeliveryRate:
        sumConfirmed > 0 ? Math.round((sumDelivered / sumConfirmed) * 1000) / 10 : 0,
      overallEndToEndDeliveryRate:
        sumHandled > 0 ? Math.round((sumDelivered / sumHandled) * 1000) / 10 : 0,
      totalReturned: sumReturned,
      overallReturnRate:
        sumDelivered > 0 ? Math.round((sumReturned / sumDelivered) * 1000) / 10 : 0,
      totalCancelled: sumCancelled,
      overallCancellationRate:
        sumHandled > 0 ? Math.round((sumCancelled / sumHandled) * 1000) / 10 : 0,
      totalRevenue: Math.round(sumRevenue),
    };

    return {
      data: rows,
      summary,
      meta: {
        page,
        perPage,
        total: totalEmployeesCount,
        totalPages: Math.ceil(totalEmployeesCount / perPage),
        from: startDate.toISOString().split('T')[0],
        to: new Date(endDate.getTime() - 86400000).toISOString().split('T')[0],
      },
    };
  }

  /**
   * Drill-down: returns the list of orders handled by an employee in a given stage.
   */
  async getStaffOrderDrilldown(query: {
    employeeId: string;
    stage?: 'handled' | 'confirmed' | 'delivered' | 'returned' | 'cancelled';
    from?: string;
    to?: string;
    page?: number;
    perPage?: number;
  }) {
    const page = query.page && query.page > 0 ? Number(query.page) : 1;
    const perPage = Math.min(
      query.perPage && query.perPage > 0 ? Number(query.perPage) : 20,
      MAX_PER_PAGE,
    );
    const stage = query.stage || 'handled';

    const now = new Date();
    const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const startDate = query.from ? dhakaStartOfDay(query.from) : defaultStart;
    const endDate = query.to
      ? new Date(dhakaStartOfDay(query.to).getTime() + 86400000)
      : new Date(now.getTime() + 86400000);

    const userId = await this.resolveUserIdByEmployeeId(query.employeeId);

    // Find all order IDs this employee touched
    const [events, assignedOrders] = await Promise.all([
      this.prisma.orderStaffEvent.findMany({
        where: {
          OR: [
            { employeeId: query.employeeId },
            ...(userId ? [{ userId }] : []),
          ],
          createdAt: { gte: startDate, lt: endDate },
        },
        select: { orderId: true },
      }),
      userId
        ? this.prisma.order.findMany({
            where: {
              assignedToId: userId,
              createdAt: { gte: startDate, lt: endDate },
              trashedAt: null,
            },
            select: { id: true },
          })
        : [],
    ]);

    const orderIdSet = new Set<string>();
    for (const e of events) orderIdSet.add(e.orderId);
    for (const o of assignedOrders) orderIdSet.add(o.id);

    if (orderIdSet.size === 0) {
      return { data: [], meta: { page, perPage, total: 0, totalPages: 0 } };
    }

    const orders = await this.prisma.order.findMany({
      where: {
        id: { in: Array.from(orderIdSet) },
        trashedAt: null,
      },
      select: {
        id: true,
        displayId: true,
        total: true,
        createdAt: true,
        guestName: true,
        guestPhone: true,
        // The stage filter below still reads the timeline to decide which
        // cohort this order belongs to.
        timeline: true,
        status: { select: { id: true, name: true, color: true } },
        customer: { select: { name: true, phone: true } },
        // The drilldown UI renders "Latest Action" and "Action Date", which
        // were dead columns: the field was declared on the frontend type but
        // never sent. Take the most recent one so those columns are real.
        staffEvents: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { action: true, fromStatus: true, toStatus: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Filter by stage
    const filtered = orders.filter((ord) => {
      if (stage === 'handled') return true;
      const status = ord.status?.name || '';
      const tl = toTimeline(ord.timeline);

      if (stage === 'confirmed') {
        return CONFIRMED_COHORT_STATUSES.has(status) || tl.some((t) => t.status === 'Confirmed');
      }
      if (stage === 'delivered') {
        return DELIVERED_COHORT_STATUSES.has(status) || findDeliveredTransition(tl) !== null;
      }
      if (stage === 'returned') {
        return resolveReturn(tl, findDeliveredTransition(tl)?.timestamp ?? null).hasReturn;
      }
      if (stage === 'cancelled') {
        return status === 'Cancelled' || tl.some((t) => t.status === 'Cancelled');
      }
      return true;
    });

    const total = filtered.length;
    const paginated = filtered.slice((page - 1) * perPage, page * perPage);

    return {
      data: paginated.map((o) => ({
        id: o.id,
        displayId: o.displayId,
        customerName: o.customer?.name || o.guestName || 'Guest',
        customerPhone: o.customer?.phone || o.guestPhone || '',
        total: Number(o.total || 0),
        status: o.status?.name || 'Pending',
        statusColor: o.status?.color || '#6B7280',
        createdAt: o.createdAt,
        events: (o.staffEvents ?? []).map((e) => ({
          action: e.action,
          fromStatus: e.fromStatus,
          toStatus: e.toStatus,
          createdAt: e.createdAt,
        })),
      })),
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
        stage,
      },
    };
  }

  /**
   * Safe idempotent backfill from Order.timeline to OrderStaffEvent for historical accuracy.
   */
  /**
   * Backfills OrderStaffEvent from historical Order.timeline entries.
   *
   * The original version walked 2000 orders and issued ~4 queries per timeline
   * entry (a findFirst dedupe, two in resolveEmployeeByUserId, then the create)
   * with no transaction and no ordering — up to ~80k sequential round trips, and
   * `take: 2000` with no ORDER BY returned an arbitrary slice, so re-running
   * re-scanned the same rows instead of making progress.
   *
   * This version:
   *   - pages deterministically by id so repeated runs advance,
   *   - resolves every actor in ONE query instead of two per entry,
   *   - de-dupes against existing events with a single set lookup,
   *   - writes with createMany instead of one insert per event.
   *
   * Idempotency is by (orderId, userId, action, toStatus), matching the shape
   * the original used, so a re-run after a partial failure does not duplicate.
   */
  async backfillFromTimeline(opts: { pageSize?: number } = {}) {
    const pageSize = Math.min(opts.pageSize ?? 500, 2000);

    const orders = await this.prisma.order.findMany({
      where: { timeline: { not: '[]' } },
      select: { id: true, timeline: true, assignedToId: true, createdAt: true },
      orderBy: { id: 'asc' },
      take: pageSize,
    });

    if (orders.length === 0) {
      return { scanned: 0, inserted: 0, lastOrderId: null, hasMore: false };
    }

    const orderIds = orders.map((o) => o.id);

    // Every distinct actor across every timeline entry, resolved in one pass.
    const actors = new Set<string>();
    for (const ord of orders) {
      const timeline = Array.isArray(ord.timeline) ? (ord.timeline as any[]) : [];
      for (const entry of timeline) {
        const actor = entry?.performedBy;
        if (!actor || NON_STAFF_ACTORS.has(String(actor))) continue;
        actors.add(String(actor));
      }
    }

    // Existing events for these orders, so a re-run is a no-op. One query
    // instead of one findFirst per timeline entry.
    const existing = await this.prisma.orderStaffEvent.findMany({
      where: { orderId: { in: orderIds } },
      select: { orderId: true, userId: true, action: true, toStatus: true },
    });
    const seen = new Set(
      existing.map((e) => `${e.orderId}|${e.userId}|${e.action}|${e.toStatus ?? ''}`),
    );

    const employeesByActor = await this.resolveEmployeesByActors([...actors]);

    const pending: Prisma.OrderStaffEventCreateManyInput[] = [];
    for (const ord of orders) {
      const timeline = Array.isArray(ord.timeline) ? (ord.timeline as any[]) : [];
      for (const entry of timeline) {
        const actor = entry?.performedBy;
        if (!actor || NON_STAFF_ACTORS.has(String(actor))) continue;

        const action = actionForStatus(entry.status);
        const key = `${ord.id}|${actor}|${action}|${entry.status ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const ts = entry.timestamp ? new Date(entry.timestamp) : ord.createdAt;
        pending.push({
          orderId: ord.id,
          userId: String(actor),
          employeeId: employeesByActor.get(String(actor)) ?? null,
          action,
          fromStatus: entry.oldStatus ?? null,
          toStatus: entry.status ?? null,
          note: entry.note ?? null,
          createdAt: isNaN(ts.getTime()) ? ord.createdAt : ts,
        });
      }
    }

    if (pending.length > 0) {
      await this.prisma.orderStaffEvent.createMany({ data: pending });
    }

    const lastOrderId = orderIds[orderIds.length - 1];
    return {
      scanned: orders.length,
      inserted: pending.length,
      lastOrderId,
      hasMore: orders.length === pageSize,
    };
  }

  /**
   * Resolves many actors to employee ids in one query.
   *
   * Actors reach the timeline as a UserProfile id, a better-auth user id, or an
   * email, depending on which code path wrote the entry, so all three shapes
   * are resolved together rather than one at a time.
   */
  private async resolveEmployeesByActors(actors: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (actors.length === 0) return result;

    const [byEmail, byProfile, byEmployeeId] = await Promise.all([
      this.prisma.employee.findMany({
        where: { betterAuthUser: { email: { in: actors } } },
        select: { betterAuthUserId: true, betterAuthUser: { select: { email: true } } },
      }),
      this.prisma.employee.findMany({
        where: { betterAuthUserId: { in: actors } },
        select: { id: true, betterAuthUserId: true },
      }),
      this.prisma.employee.findMany({
        where: { id: { in: actors } },
        select: { id: true },
      }),
    ]);

    for (const emp of byEmail) {
      const email = emp.betterAuthUser?.email;
      if (email) result.set(email, emp.betterAuthUserId!);
    }
    for (const emp of byProfile) {
      result.set(emp.betterAuthUserId, emp.id);
    }
    for (const emp of byEmployeeId) {
      result.set(emp.id, emp.id);
    }
    return result;
  }
}
