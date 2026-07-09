import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { OrdersService } from '../orders/orders.service';

const ADVANCED_STATUSES = new Set([
  'In Courier',
  'Shipped',
  'Delivered',
  'Return Pending',
  'Partial Return',
  'Returned',
  'Damaged',
]);

@Injectable()
export class CourierWebhookService {
  private readonly logger = new Logger(CourierWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
  ) {}

  async handleSteadfast(body: Record<string, unknown>) {
    const consignmentId = body['consignment_id'] as string;
    const status = (body['status'] as string)?.toLowerCase();

    if (!consignmentId) return { error: 'Missing consignment_id' };

    const order = await this.prisma.order.findFirst({
      where: { courierConsignmentId: consignmentId },
    });
    if (!order) return { error: 'Order not found' };

    const mappedStatus = mapSteadfastStatus(status);
    if (!mappedStatus) return { ok: true, skipped: 'No status change needed' };

    if (this.isRegression(order.courierStatus || '', mappedStatus)) {
      this.logger.warn(
        `Steadfast regression blocked: ${consignmentId} ${order.courierStatus} → ${mappedStatus}`,
      );
      return { ok: true, skipped: 'Status regression blocked' };
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        courierStatus: mappedStatus,
        courierTrackingCode:
          (body['tracking_code'] as string) || order.courierTrackingCode,
        courierService: 'steadfast',
      },
    });
    await this.addTimelineEntry(order.id, 'steadfast', mappedStatus);
    await this.syncToDispatch(
      order.id,
      'steadfast',
      consignmentId,
      mappedStatus,
    );
    this.logger.log(`Steadfast: ${consignmentId} → ${mappedStatus}`);
    return { ok: true, status: mappedStatus };
  }

  async handlePathao(body: Record<string, unknown>) {
    const consignmentId = (body['consignment_id'] ||
      body['data']?.['consignment_id']) as string;
    const event = body['event'] as string;

    if (!consignmentId) return { error: 'Missing consignment_id' };

    const order = await this.prisma.order.findFirst({
      where: { courierConsignmentId: consignmentId },
    });
    if (!order) return { error: 'Order not found' };

    const mappedStatus = mapPathaoStatus(event);
    if (!mappedStatus) return { ok: true, skipped: 'No status change needed' };

    if (this.isRegression(order.courierStatus || '', mappedStatus)) {
      this.logger.warn(
        `Pathao regression blocked: ${consignmentId} ${order.courierStatus} → ${mappedStatus}`,
      );
      return { ok: true, skipped: 'Status regression blocked' };
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { courierStatus: mappedStatus, courierService: 'pathao' },
    });
    await this.addTimelineEntry(order.id, 'pathao', mappedStatus);
    await this.syncToDispatch(order.id, 'pathao', consignmentId, mappedStatus);
    this.logger.log(`Pathao: ${consignmentId} → ${mappedStatus}`);
    return { ok: true, status: mappedStatus };
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
        where: { courierTrackingCode: trackingNumber, courierService: 'redx' },
      });
    if (!order && invoiceNumber)
      order = await this.prisma.order.findFirst({
        where: { displayId: invoiceNumber, courierService: 'redx' },
      });
    if (!order) return { error: 'Order not found or not a RedX order' };

    const mappedStatus = mapRedxStatus(status);
    if (!mappedStatus) return { ok: true, skipped: 'No status change needed' };

    if (this.isRegression(order.courierStatus || '', mappedStatus)) {
      this.logger.warn(
        `RedX regression blocked: ${trackingNumber} ${order.courierStatus} → ${mappedStatus}`,
      );
      return { ok: true, skipped: 'Status regression blocked' };
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        courierStatus: mappedStatus,
        courierTrackingCode: trackingNumber || order.courierTrackingCode,
        courierService: 'redx',
      },
    });
    await this.addTimelineEntry(order.id, 'redx', mappedStatus);
    const redxConsignmentId = trackingNumber || invoiceNumber || '';
    await this.syncToDispatch(
      order.id,
      'redx',
      redxConsignmentId,
      mappedStatus,
    );
    this.logger.log(
      `RedX: ${trackingNumber || invoiceNumber} → ${mappedStatus}${messageEn ? ` (${messageEn})` : ''}`,
    );
    return { ok: true, status: mappedStatus, deliveryType };
  }

  async handleCarrybee(body: Record<string, unknown>) {
    const consignmentId = body['consignment_id'] as string;
    const event = body['event'] as string;
    const deliveryStatus = body['delivery_status'] as string;
    const orderNumber = body['merchant_order_id'] as string;

    let order: {
      id: string;
      courierStatus: string | null;
      courierTrackingCode: string | null;
      courierConsignmentId: string | null;
    } | null = null;
    if (consignmentId)
      order = await this.prisma.order.findFirst({
        where: { courierConsignmentId: consignmentId },
      });
    if (!order && orderNumber)
      order = await this.prisma.order.findFirst({
        where: { displayId: orderNumber },
      });
    if (!order) return { error: 'Order not found' };

    const mappedStatus = mapCarrybeeStatus(event, deliveryStatus);
    if (!mappedStatus) return { ok: true, skipped: 'No status change needed' };

    if (this.isRegression(order.courierStatus || '', mappedStatus)) {
      this.logger.warn(
        `Carrybee regression blocked: ${consignmentId} ${order.courierStatus} → ${mappedStatus}`,
      );
      return { ok: true, skipped: 'Status regression blocked' };
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        courierStatus: mappedStatus,
        courierConsignmentId: consignmentId || order.courierConsignmentId,
        courierService: 'carrybee',
      },
    });
    await this.addTimelineEntry(order.id, 'carrybee', mappedStatus);
    await this.syncToDispatch(
      order.id,
      'carrybee',
      consignmentId || '',
      mappedStatus,
    );
    this.logger.log(
      `Carrybee: ${consignmentId || orderNumber} → ${mappedStatus}`,
    );
    return { ok: true, status: mappedStatus };
  }

  private isRegression(currentStatus: string, newStatus: string): boolean {
    if (!currentStatus || !ADVANCED_STATUSES.has(currentStatus)) return false;
    if (newStatus === 'Cancelled' || newStatus === 'Canceled') return true;
    if (
      currentStatus === 'Delivered' &&
      (newStatus === 'Returned' || newStatus === 'Return Pending')
    )
      return false;
    return false;
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

  private async addTimelineEntry(
    orderId: string,
    courier: string,
    status: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) return;
    const timeline = [
      ...((order.timeline as unknown[]) || []),
      {
        type: 'courier',
        courier,
        status,
        timestamp: new Date().toISOString(),
        note: `${courier}: ${status}`,
      },
    ];
    await this.prisma.order.update({
      where: { id: orderId },
      data: { timeline: timeline as Prisma.InputJsonValue },
    });
  }

  private async syncToDispatch(
    orderId: string,
    courier: string,
    consignmentId: string,
    status: string,
  ) {
    if (!consignmentId) return;
    const mappedStatus = mapToDispatchStatus(status);
    if (!mappedStatus) return;

    const existingDispatch = await this.prisma.dispatch.findUnique({
      where: {
        courier_consignmentId: { courier: courier as any, consignmentId },
      },
    });

    if (existingDispatch) {
      await this.prisma.dispatch.update({
        where: { id: existingDispatch.id },
        data: { status: mappedStatus as any },
      });
    }

    const orderStatusMap: Record<string, string> = {
      DELIVERED: 'Delivered',
      PARTIAL: 'Partial',
      RETURN_PENDING: 'Return Pending',
    };

    const targetOrderStatusName = orderStatusMap[mappedStatus];
    if (targetOrderStatusName) {
      const targetStatus = await this.prisma.orderStatus.findUnique({
        where: { name: targetOrderStatusName },
      });
      if (targetStatus) {
        await this.ordersService.updateStatus(
          orderId,
          { statusId: targetStatus.id },
          'system',
        );
        this.logger.log(
          `Order ${orderId} status auto-synced to ${targetOrderStatusName} via dispatch webhook`,
        );
      }
    }
  }
}

function mapSteadfastStatus(raw?: string | null): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (
    [
      'in_review',
      'in_review_approval_pending',
      'delivered_approval_pending',
      'partial_delivered_approval_pending',
      'cancelled_approval_pending',
      'unknown_approval_pending',
    ].includes(s)
  )
    return null;
  if (
    [
      'pending',
      'picked',
      'in_transit',
      'at_hub',
      'out_for_delivery',
      'hold',
    ].includes(s)
  )
    return 'In Courier';
  if (s === 'delivered' || s.startsWith('delivered')) return 'Delivered';
  if (s === 'cancelled' || s.startsWith('cancelled')) return 'Cancelled';
  if (['partial', 'partial_delivered'].includes(s)) return 'Partial Return';
  if (s.includes('return')) return 'Return Pending';
  if (s === 'unknown') return 'Unknown';
  return null;
}

function mapPathaoStatus(raw?: string | null): string | null {
  if (!raw) return null;
  const s = (raw || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (s === 'order.pickup-cancelled') return null;
  if (
    [
      'order.picked',
      'order.at-the-sorting-hub',
      'order.in-transit',
      'order.received-at-last-mile-hub',
      'order.assigned-for-delivery',
      'order.on-hold',
    ].includes(s)
  )
    return 'In Courier';
  if (s === 'order.delivered') return 'Delivered';
  if (s === 'order.partial-delivery') return 'Partial Return';
  if (['order.cancelled', 'order.canceled'].includes(s)) return 'Cancelled';
  if (
    ['order.returned', 'order.delivery-failed', 'order.paid-return'].includes(s)
  )
    return 'Return Pending';
  return null;
}

function mapRedxStatus(raw?: string | null): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (
    [
      'pending',
      'picked',
      'in_transit',
      'ofd',
      'out_for_delivery',
      'hold',
    ].includes(s)
  )
    return 'In Courier';
  if (s === 'delivered') return 'Delivered';
  if (['cancelled', 'canceled'].includes(s)) return 'Cancelled';
  if (s === 'partial_delivered') return 'Partial Return';
  if (s.includes('return')) return 'Return Pending';
  return null;
}

function mapCarrybeeStatus(
  event?: string | null,
  deliveryStatus?: string | null,
): string | null {
  const raw = event || deliveryStatus;
  if (!raw) return null;
  const slug = raw.toLowerCase().replace(/[\s-]+/g, '-');
  if (slug === 'order.pickup-cancelled') return null;
  if (
    [
      'order.picked',
      'order.assigned-for-pickup',
      'order.pickup-requested',
    ].includes(slug)
  )
    return 'In Courier';
  if (slug === 'order.delivered') return 'Delivered';
  if (slug === 'order.partial-delivery') return 'Partial Return';
  if (['order.cancelled', 'order.canceled'].includes(slug)) return 'Cancelled';
  if (
    [
      'order.delivery-failed',
      'order.returned',
      'order.returned-at-sorting',
      'order.returned-to-merchant',
    ].includes(slug)
  )
    return 'Return Pending';
  const s = (deliveryStatus || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (
    ['pending', 'picked', 'in_transit', 'ofd', 'out_for_delivery'].includes(s)
  )
    return 'In Courier';
  if (['delivered', 'complete'].includes(s)) return 'Delivered';
  if (s.includes('return')) return 'Return Pending';
  return null;
}

function mapToDispatchStatus(status: string): string | null {
  const map: Record<string, string> = {
    'In Courier': 'IN_TRANSIT',
    Delivered: 'DELIVERED',
    Cancelled: 'CANCELLED',
    Canceled: 'CANCELLED',
    'Partial Return': 'PARTIAL',
    'Return Pending': 'RETURN_PENDING',
    Returned: 'RETURNED',
  };
  return map[status] || null;
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
