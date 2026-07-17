import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { OrdersService } from '../orders/orders.service';

const ORDER_TRANSITIONS: Record<string, string[]> = {
  'Pending': ['Payment Pending', 'Hold', 'Confirmed', 'Cancelled'],
  'Payment Pending': ['Payment Verifying', 'Hold', 'Confirmed', 'Cancelled'],
  'Payment Verifying': ['Confirmed', 'Hold', 'Cancelled'],
  'Hold': ['Pending', 'Confirmed', 'Cancelled'],
  'Confirmed': ['Packed', 'Packing Hold', 'Cancelled'],
  'Packed': ['Shipping', 'Packing Hold'],
  'Packing Hold': ['Packed', 'Cancelled'],
  'Shipping': ['Delivered', 'Partial'],
  'Delivered': ['Return Pending'],
  'Partial': ['Return Pending'],
  'Return Pending': ['Returned', 'Damaged'],
  'Returned': ['Damaged'],
  'Cancelled': ['Confirmed'],
  'Damaged': [],
};

const ORDER_STATUS_FLOW = [
  'Pending', 'Payment Pending', 'Payment Verifying', 'Hold', 'Confirmed',
  'Packed', 'Packing Hold', 'Shipping', 'Delivered', 'Partial',
  'Return Pending', 'Returned', 'Damaged', 'Cancelled',
];

// Steadfast status → DispatchStatus (direct mapping)
const STEADFAST_DISPATCH_MAP: Record<string, string | null> = {
  in_review: 'DISPATCHED',
  pending: 'PICKED_UP',
  hold: 'HOLD',
  delivered_approval_pending: 'ASSIGNED_TO_RIDER',
  partial_delivered_approval_pending: 'ASSIGNED_TO_RIDER',
  cancelled_approval_pending: 'ASSIGNED_TO_RIDER',
  unknown_approval_pending: null,
  delivered: 'DELIVERED',
  partial_delivered: 'PARTIAL',
  cancelled: null, // handled conditionally in handleSteadfast
  unknown: 'CANCELLED',
};

// DispatchStatus → OrderStatus name mapping (when webhook should auto-update order)
const DISPATCH_TO_ORDER_STATUS: Record<string, string | null> = {
  HANDED_OVER: 'Shipping',
  PICKED_UP: 'Shipping',
  HOLD: 'Shipping',
  ASSIGNED_TO_RIDER: 'Shipping',
  DELIVERED: 'Delivered',
  PARTIAL: null,
  RETURN_PENDING: 'Return Pending',
  CANCELLED: null,
};

// Pathao event → DispatchStatus
const PATHAO_DISPATCH_MAP: Record<string, string | null> = {
  'order.created': 'DISPATCHED',
  'order.updated': null,
  'order.pickup-requested': null,
  'order.assigned-for-pickup': null,
  'order.picked': 'PICKED_UP',
  'order.pickup-failed': null,
  'order.pickup-cancelled': 'CANCELLED',
  'order.at-the-sorting-hub': 'IN_TRANSIT',
  'order.in-transit': 'IN_TRANSIT',
  'order.received-at-last-mile-hub': 'ASSIGNED_TO_RIDER',
  'order.assigned-for-delivery': 'ASSIGNED_TO_RIDER',
  'order.delivered': 'DELIVERED',
  'order.partial-delivery': 'PARTIAL',
  'order.returned': 'RETURN_PENDING',
  'order.delivery-failed': null,
  'order.on-hold': 'HOLD',
  'order.paid': 'DELIVERED',
  'order.paid-return': 'RETURN_PENDING',
  'order.exchanged': 'DELIVERED',
  'order.return-id-created': 'RETURN_PENDING',
  'order.return-in-transit': 'RETURN_PENDING',
  'order.returned-to-merchant': 'RETURNED',
};

// Pathao DispatchStatus → OrderStatus
const PATHAO_DISPATCH_TO_ORDER: Record<string, string | null> = {
  HANDED_OVER: 'Shipping',
  PICKED_UP: 'Shipping',
  HOLD: 'Shipping',
  ASSIGNED_TO_RIDER: 'Shipping',
  DELIVERED: 'Delivered',
  PARTIAL: 'Partial',
  RETURN_PENDING: 'Return Pending',
  RETURNED: 'Return Pending',
  CANCELLED: null,
};

// Carrybee event → DispatchStatus
const CARRYBEE_DISPATCH_MAP: Record<string, string | null> = {
  'order.created': 'DISPATCHED',
  'order.create-failed': 'CANCELLED',
  'order.updated': null,
  'order.pickup-requested': null,
  'order.assigned-for-pickup': null,
  'order.picked': 'PICKED_UP',
  'order.pickup-failed': null,
  'order.pickup-cancelled': 'CANCELLED',
  'order.at-the-sorting-hub': 'IN_TRANSIT',
  'order.on-the-way-to-central-warehouse': 'IN_TRANSIT',
  'order.at-central-warehouse': 'IN_TRANSIT',
  'order.in-transit': 'IN_TRANSIT',
  'order.received-at-last-mile-hub': 'ASSIGNED_TO_RIDER',
  'order.assigned-for-delivery': 'ASSIGNED_TO_RIDER',
  'order.delivery-on-hold': 'HOLD',
  'order.delivered': 'DELIVERED',
  'order.partial-delivery': 'PARTIAL',
  'order.delivery-failed': null,
  'order.returned': 'RETURN_PENDING',
  'order.paid-return': 'RETURN_PENDING',
  'order.exchange': 'DELIVERED',
  'order.paid': 'DELIVERED',
  'order.returned-at-sorting': 'RETURN_PENDING',
  'order.returned-in-transit': 'RETURN_PENDING',
  'order.returned-to-merchant': 'RETURNED',
};

// Carrybee DispatchStatus → OrderStatus
const CARRYBEE_DISPATCH_TO_ORDER: Record<string, string | null> = {
  HANDED_OVER: 'Shipping',
  PICKED_UP: 'Shipping',
  HOLD: 'Shipping',
  ASSIGNED_TO_RIDER: 'Shipping',
  DELIVERED: 'Delivered',
  PARTIAL: 'Partial',
  RETURN_PENDING: 'Return Pending',
  RETURNED: 'Return Pending',
  CANCELLED: null,
};

// RedX webhook status → DispatchStatus
const REDX_DISPATCH_MAP: Record<string, string | null> = {
  'ready-for-delivery': 'PICKED_UP',
  'delivery-in-progress': 'ASSIGNED_TO_RIDER',
  delivered: 'DELIVERED',
  'agent-hold': 'HOLD',
  'agent-returning': 'RETURN_PENDING',
  returned: 'RETURN_PENDING',
  'agent-area-change': null,
};

// RedX DispatchStatus → OrderStatus
const REDX_DISPATCH_TO_ORDER: Record<string, string | null> = {
  DISPATCHED: null,
  HANDED_OVER: 'Shipping',
  PICKED_UP: 'Shipping',
  HOLD: 'Shipping',
  ASSIGNED_TO_RIDER: 'Shipping',
  DELIVERED: 'Delivered',
  PARTIAL: 'Partial',
  RETURN_PENDING: 'Return Pending',
  RETURNED: 'Return Pending',
  CANCELLED: null,
};

@Injectable()
export class CourierWebhookService {
  private readonly logger = new Logger(CourierWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
  ) {}

  async handleSteadfast(body: Record<string, unknown>) {
    const notificationType = body['notification_type'] as string;
    const consignmentId = String(body['consignment_id'] ?? '');

    if (!consignmentId) {
      this.logger.warn('Steadfast webhook missing consignment_id');
      return { status: 'error', message: 'Missing consignment_id' };
    }

    const order = await this.prisma.order.findFirst({
      where: { courierConsignmentId: consignmentId, trashedAt: null },
    });
    if (!order) {
      this.logger.warn(`Steadfast: Order not found for consignment ${consignmentId}`);
      return { status: 'error', message: 'Order not found' };
    }

    // Handle tracking_update — just add timeline entry, no status change
    if (notificationType === 'tracking_update') {
      const trackingMsg = (body['tracking_message'] as string) || 'Tracking update';
      await this.addTimelineEntry(order.id, 'steadfast', trackingMsg);
      this.logger.log(`Steadfast tracking: ${consignmentId} — ${trackingMsg}`);
      return { status: 'success', message: 'Tracking update received' };
    }

    const rawStatus = (body['status'] as string)?.toLowerCase() || '';
    let dispatchStatus: string | null = STEADFAST_DISPATCH_MAP[rawStatus];

    if (rawStatus === 'cancelled') {
      dispatchStatus = await this.resolveCancelledStatus(order.id);
    }

    if (!dispatchStatus) {
      this.logger.log(`Steadfast: ${consignmentId} status "${rawStatus}" → skipped`);
      return { status: 'success', message: 'No status change needed' };
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { courierStatus: rawStatus, courierService: 'steadfast' },
    });

    await this.upsertDispatch(order.id, 'steadfast', consignmentId, dispatchStatus, body);

    await this.addTimelineEntry(order.id, 'steadfast', dispatchStatus);

    const orderStatusName = DISPATCH_TO_ORDER_STATUS[dispatchStatus];
    if (orderStatusName) {
      await this.tryAdvanceOrderStatus(order.id, orderStatusName);
    }

    this.logger.log(`Steadfast: ${consignmentId} → dispatch=${dispatchStatus} order=${orderStatusName || '-'}`);
    return { status: 'success', message: 'Webhook received successfully.' };
  }

  private async resolveCancelledStatus(orderId: string): Promise<string> {
    const hasProgress = await this.prisma.dispatch.findFirst({
      where: {
        orderId,
        status: { in: ['HANDED_OVER', 'PICKED_UP', 'IN_TRANSIT', 'ASSIGNED_TO_RIDER', 'DELIVERED', 'PARTIAL'] },
      },
    });
    return hasProgress ? 'RETURN_PENDING' : 'CANCELLED';
  }

  private async upsertDispatch(
    orderId: string,
    courier: string,
    consignmentId: string,
    status: string,
    body: Record<string, unknown>,
  ) {
    const trackingCode = (body['tracking_code'] as string) || undefined;
    await this.prisma.dispatch.upsert({
      where: {
        courier_consignmentId: { courier: courier as any, consignmentId },
      },
      update: { status: status as any, trackingCode },
      create: {
        orderId,
        courier: courier as any,
        consignmentId,
        trackingCode,
        status: status as any,
      },
    });
  }

  private async tryAdvanceOrderStatus(orderId: string, targetName: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { status: true },
    });
    if (!order || order.trashedAt) return;

    const currentIdx = ORDER_STATUS_FLOW.indexOf(order.status.name);
    const targetIdx = ORDER_STATUS_FLOW.indexOf(targetName);
    if (currentIdx < 0 || targetIdx < 0) return;
    if (currentIdx >= targetIdx) return;

    const targetStatus = await this.prisma.orderStatus.findUnique({
      where: { name: targetName },
    });
    if (!targetStatus) return;

    try {
      await this.ordersService.updateStatus(orderId, { statusId: targetStatus.id }, 'system');
      return;
    } catch (e) {
      this.logger.warn(`Direct transition to ${targetName} failed: ${(e as Error).message}`);
    }

    const path = this.findTransitionPath(order.status.name, targetName);
    for (const step of path) {
      const current = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { status: true },
      });
      if (!current || current.status.name === targetName) break;
      const stepStatus = await this.prisma.orderStatus.findUnique({
        where: { name: step },
      });
      if (!stepStatus) continue;
      const allowed = ORDER_TRANSITIONS[current.status.name] || [];
      if (!allowed.includes(step)) continue;
      try {
        await this.ordersService.updateStatus(orderId, { statusId: stepStatus.id }, 'system');
      } catch (e2) {
        this.logger.warn(`Step ${current.status.name}→${step} failed: ${(e2 as Error).message}`);
        break;
      }
    }
  }

  private findTransitionPath(from: string, to: string): string[] {
    const visited = new Set<string>();
    const queue: { status: string; path: string[] }[] = [{ status: from, path: [] }];
    visited.add(from);

    while (queue.length > 0) {
      const { status, path } = queue.shift()!;
      const allowed = ORDER_TRANSITIONS[status] || [];
      for (const next of allowed) {
        if (next === to) return [...path, next];
        if (!visited.has(next)) {
          visited.add(next);
          queue.push({ status: next, path: [...path, next] });
        }
      }
    }
    return [];
  }

  private async addTimelineEntry(
    orderId: string,
    courier: string,
    status: string,
    extra?: Record<string, unknown>,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, trashedAt: null },
    });
    if (!order) return;
    const entry: Record<string, unknown> = {
      type: 'courier',
      courier,
      status,
      timestamp: new Date().toISOString(),
      note: `${courier}: ${status}`,
    };
    if (extra?.reason) entry.reason = extra.reason;
    if (extra?.collected_amount != null) entry.collectedAmount = extra.collected_amount;
    if (extra?.return_type) entry.returnType = extra.return_type;
    if (extra?.return_consignment_id) entry.returnConsignmentId = extra.return_consignment_id;
    if (extra?.remarks) entry.remarks = extra.remarks;
    if (extra?.attempt != null) entry.attempt = extra.attempt;
    if (extra?.agent_name) entry.agentName = extra.agent_name;
    if (extra?.agent_phone) entry.agentPhone = extra.agent_phone;
    const timeline = [
      ...((order.timeline as unknown[]) || []),
      entry,
    ];
    await this.prisma.order.update({
      where: { id: orderId },
      data: { timeline: timeline as Prisma.InputJsonValue },
    });
  }

  async handlePathao(body: Record<string, unknown>) {
    const event = body['event'] as string;

    if (event === 'webhook_integration') {
      this.logger.log('Pathao webhook integration test received');
      return { status: 'success', message: 'Webhook integration successful' };
    }

    if (event?.startsWith('store.')) {
      return { status: 'success', message: 'Store event, no action needed' };
    }

    const consignmentId = body['consignment_id'] as string;
    if (!consignmentId) {
      this.logger.warn('Pathao webhook missing consignment_id');
      return { status: 'error', message: 'Missing consignment_id' };
    }

    const order = await this.prisma.order.findFirst({
      where: { courierConsignmentId: consignmentId, trashedAt: null },
    });
    if (!order) {
      this.logger.warn(`Pathao: Order not found for consignment ${consignmentId}`);
      return { status: 'error', message: 'Order not found' };
    }

    let dispatchStatus: string | null = PATHAO_DISPATCH_MAP[event] ?? null;

    if (['order.pickup-failed', 'order.delivery-failed'].includes(event)) {
      dispatchStatus = await this.resolveCancelledStatus(order.id);
    }

    if (!dispatchStatus) {
      this.logger.log(`Pathao: ${consignmentId} event "${event}" → skipped`);
      return { status: 'success', message: 'No status change needed' };
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { courierStatus: event, courierService: 'pathao' },
    });

    await this.upsertDispatch(order.id, 'pathao', consignmentId, dispatchStatus, body);

    const extra: Record<string, unknown> = {};
    if (body['reason']) extra.reason = body['reason'];
    if (body['collected_amount'] != null) extra.collected_amount = body['collected_amount'];
    if (body['return_type']) extra.return_type = body['return_type'];
    if (body['return_consignment_id']) extra.return_consignment_id = body['return_consignment_id'];
    await this.addTimelineEntry(order.id, 'pathao', dispatchStatus, extra);

    const orderStatusName = PATHAO_DISPATCH_TO_ORDER[dispatchStatus];
    if (orderStatusName) {
      await this.tryAdvanceOrderStatus(order.id, orderStatusName);
    }

    this.logger.log(`Pathao: ${consignmentId} → dispatch=${dispatchStatus} order=${orderStatusName || '-'}`);
    return { status: 'success', message: 'Webhook received successfully.' };
  }

  async handleRedx(body: Record<string, unknown>) {
    const trackingNumber = body['tracking_number'] as string;
    const status = (body['status'] as string)?.toLowerCase();
    const invoiceNumber = body['invoice_number'] as string;
    const messageEn = body['message_en'] as string;
    const deliveryType = body['delivery_type'] as string;

    await this.logWebhookRequest('redx', body);

    let order: {
      id: string;
      courierStatus: string | null;
      courierTrackingCode: string | null;
      courierConsignmentId: string | null;
    } | null = null;
    if (trackingNumber)
      order = await this.prisma.order.findFirst({
        where: { courierTrackingCode: trackingNumber, courierService: 'redx', trashedAt: null },
      });
    if (!order && invoiceNumber)
      order = await this.prisma.order.findFirst({
        where: { displayId: invoiceNumber, courierService: 'redx', trashedAt: null },
      });
    if (!order) return { error: 'Order not found or not a RedX order' };

    let dispatchStatus: string | null = REDX_DISPATCH_MAP[status] ?? null;

    if (status === 'delivered' && deliveryType === 'partial-delivery') {
      dispatchStatus = 'PARTIAL';
    }

    if (!dispatchStatus) {
      this.logger.log(`RedX: ${trackingNumber || invoiceNumber} status "${status}" → skipped`);
      return { status: 'success', message: 'No status change needed' };
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        courierStatus: status,
        courierTrackingCode: trackingNumber || order.courierTrackingCode,
        courierService: 'redx',
      },
    });

    const consignmentId = trackingNumber || invoiceNumber || '';
    await this.upsertDispatch(order.id, 'redx', consignmentId, dispatchStatus, body);

    const extra: Record<string, unknown> = {};
    if (messageEn) extra.remarks = messageEn;
    if (deliveryType) extra.delivery_type = deliveryType;
    await this.addTimelineEntry(order.id, 'redx', dispatchStatus, extra);

    const orderStatusName = REDX_DISPATCH_TO_ORDER[dispatchStatus];
    if (orderStatusName) {
      await this.tryAdvanceOrderStatus(order.id, orderStatusName);
    }

    this.logger.log(`RedX: ${trackingNumber || invoiceNumber} → dispatch=${dispatchStatus} order=${orderStatusName || '-'}${messageEn ? ` (${messageEn})` : ''}`);
    return { status: 'success', message: 'Webhook received successfully.' };
  }

  async handleCarrybee(body: Record<string, unknown>) {
    const event = body['event'] as string;

    if (event === 'webhook_integration') {
      this.logger.log('Carrybee webhook integration test received');
      return { status: 'success', message: 'Webhook integration successful' };
    }

    const consignmentId = body['consignment_id'] as string;
    if (!consignmentId) {
      this.logger.warn('Carrybee webhook missing consignment_id');
      return { status: 'error', message: 'Missing consignment_id' };
    }

    const order = await this.prisma.order.findFirst({
      where: { courierConsignmentId: consignmentId, trashedAt: null },
    });
    if (!order) {
      this.logger.warn(`Carrybee: Order not found for consignment ${consignmentId}`);
      return { status: 'error', message: 'Order not found' };
    }

    let dispatchStatus: string | null = CARRYBEE_DISPATCH_MAP[event] ?? null;

    if (['order.pickup-failed', 'order.delivery-failed'].includes(event)) {
      dispatchStatus = await this.resolveCancelledStatus(order.id);
    }

    if (!dispatchStatus) {
      this.logger.log(`Carrybee: ${consignmentId} event "${event}" → skipped`);
      return { status: 'success', message: 'No status change needed' };
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { courierStatus: event, courierService: 'carrybee' },
    });

    await this.upsertDispatch(order.id, 'carrybee', consignmentId, dispatchStatus, body);

    const extra: Record<string, unknown> = {};
    if (body['reason']) extra.reason = body['reason'];
    if (body['collected_amount'] != null) extra.collected_amount = body['collected_amount'];
    if (body['remarks']) extra.remarks = body['remarks'];
    if (body['attempt'] != null) extra.attempt = body['attempt'];
    if (body['agent_name']) extra.agent_name = body['agent_name'];
    if (body['agent_phone']) extra.agent_phone = body['agent_phone'];
    await this.addTimelineEntry(order.id, 'carrybee', dispatchStatus, extra);

    const orderStatusName = CARRYBEE_DISPATCH_TO_ORDER[dispatchStatus];
    if (orderStatusName) {
      await this.tryAdvanceOrderStatus(order.id, orderStatusName);
    }

    this.logger.log(`Carrybee: ${consignmentId} → dispatch=${dispatchStatus} order=${orderStatusName || '-'}`);
    return { status: 'success', message: 'Webhook received successfully.' };
  }

  private logWebhookRequest(courier: string, body: Record<string, unknown>) {
    const tracking =
      body['tracking_number'] ||
      body['tracking_id'] ||
      body['consignment_id'] ||
      'unknown';
    const invoice =
      body['invoice_number'] ||
      body['merchant_invoice_id'] ||
      body['invoice'] ||
      'unknown';
    this.logger.log(
      `Webhook ${courier}: tracking=${tracking} invoice=${invoice} status=${body['status'] || body['event'] || 'unknown'}`,
    );
  }
}

export function buildTrackingUrl(
  courier: string | null,
  trackingCode: string | null,
  consignmentId: string | null,
): string | null {
  if (!trackingCode && !consignmentId) return null;
  const service = (courier || '').toLowerCase();
  switch (service) {
    case 'steadfast':
      return `https://steadfast.com.bd/t/${encodeURIComponent(consignmentId || trackingCode || '')}`;
    case 'pathao':
      return `https://merchant.pathao.com/tracking?consignment_id=${encodeURIComponent(consignmentId || trackingCode || '')}`;
    case 'redx':
      return `https://redx.com.bd/track-global-parcel/?trackingId=${encodeURIComponent(trackingCode || consignmentId || '')}`;
    case 'carrybee':
      return `https://merchant.carrybee.com/order-track/${encodeURIComponent(consignmentId || trackingCode || '')}`;
    default:
      return null;
  }
}
