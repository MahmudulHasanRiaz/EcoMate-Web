import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { dhakaStartOfDay } from '../hr-attendance/attendance-date';

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

@Injectable()
export class OrderStaffPerformanceService {
  private readonly logger = new Logger(OrderStaffPerformanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves canonical employee for a given userId (UserProfile.id or betterAuthUserId).
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

    return emp?.id ?? null;
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

      if (data.action === 'STATUS_CHANGED' && data.toStatus) {
        const existing = await client.orderStaffEvent.findFirst({
          where: {
            orderId: data.orderId,
            action: 'STATUS_CHANGED',
            toStatus: data.toStatus,
          },
        });
        if (existing) return existing;
      }

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
    const perPage = query.perPage && query.perPage > 0 ? Number(query.perPage) : 20;

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
        const timeline = Array.isArray(ord.timeline) ? (ord.timeline as any[]) : [];

        // Check if order reached Confirmed
        const reachedConfirmed =
          ['Confirmed', 'Packed', 'Packing Hold', 'Shipping', 'Delivered', 'Returned', 'Damaged', 'Partial'].includes(
            currentStatus,
          ) ||
          timeline.some((t) => t.status === 'Confirmed');

        // Check if order reached Delivered
        const reachedDelivered =
          currentStatus === 'Delivered' ||
          timeline.some((t) => t.status === 'Delivered') ||
          (currentStatus === 'Returned' && timeline.some((t) => t.status === 'Delivered'));

        // Check if order reached Returned
        const reachedReturned =
          ['Returned', 'Damaged'].includes(currentStatus) ||
          timeline.some((t) => t.status === 'Returned' || t.status === 'Damaged');

        // Check if order reached Cancelled
        const reachedCancelled =
          currentStatus === 'Cancelled' ||
          timeline.some((t) => t.status === 'Cancelled');

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
    const perPage = query.perPage && query.perPage > 0 ? Number(query.perPage) : 20;
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
      include: {
        status: { select: { id: true, name: true, color: true } },
        customer: { select: { name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Filter by stage
    const filtered = orders.filter((ord) => {
      if (stage === 'handled') return true;
      const status = ord.status?.name || '';
      const tl = Array.isArray(ord.timeline) ? (ord.timeline as any[]) : [];

      if (stage === 'confirmed') {
        return (
          ['Confirmed', 'Packed', 'Shipping', 'Delivered', 'Returned', 'Damaged', 'Partial'].includes(
            status,
          ) || tl.some((t) => t.status === 'Confirmed')
        );
      }
      if (stage === 'delivered') {
        return (
          status === 'Delivered' ||
          tl.some((t) => t.status === 'Delivered') ||
          (status === 'Returned' && tl.some((t) => t.status === 'Delivered'))
        );
      }
      if (stage === 'returned') {
        return (
          ['Returned', 'Damaged'].includes(status) ||
          tl.some((t) => t.status === 'Returned' || t.status === 'Damaged')
        );
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
  async backfillFromTimeline(): Promise<{ scanned: number; inserted: number }> {
    const orders = await this.prisma.order.findMany({
      where: { timeline: { not: '[]' } },
      select: {
        id: true,
        timeline: true,
        assignedToId: true,
        createdAt: true,
      },
      take: 2000,
    });

    let inserted = 0;

    for (const ord of orders) {
      const timeline = Array.isArray(ord.timeline) ? (ord.timeline as any[]) : [];
      for (const entry of timeline) {
        if (!entry.performedBy || entry.performedBy === 'customer' || entry.performedBy === 'system') {
          continue;
        }

        const ts = entry.timestamp ? new Date(entry.timestamp) : ord.createdAt;
        const action =
          entry.status === 'Confirmed'
            ? 'confirmed'
            : entry.status === 'Delivered'
              ? 'delivered'
              : entry.status === 'Returned'
                ? 'returned'
                : entry.status === 'Cancelled'
                  ? 'cancelled'
                  : 'status_change';

        const existing = await this.prisma.orderStaffEvent.findFirst({
          where: {
            orderId: ord.id,
            userId: entry.performedBy,
            action,
            toStatus: entry.status ?? null,
          },
          select: { id: true },
        });

        if (!existing) {
          const empId = await this.resolveEmployeeByUserId(entry.performedBy);
          await this.prisma.orderStaffEvent.create({
            data: {
              orderId: ord.id,
              userId: entry.performedBy,
              employeeId: empId,
              action,
              fromStatus: entry.oldStatus ?? null,
              toStatus: entry.status ?? null,
              note: entry.note ?? null,
              createdAt: isNaN(ts.getTime()) ? new Date() : ts,
            },
          });
          inserted++;
        }
      }
    }

    return { scanned: orders.length, inserted };
  }
}
