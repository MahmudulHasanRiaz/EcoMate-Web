import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

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

  constructor(private readonly prisma: PrismaService) {}

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
        courierStatus: status,
        courierTrackingCode:
          (body['tracking_code'] as string) || order.courierTrackingCode,
        courierService: 'steadfast',
      },
    });
    await this.addTimelineEntry(order.id, 'steadfast', mappedStatus);
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
      data: { courierStatus: event, courierService: 'pathao' },
    });
    await this.addTimelineEntry(order.id, 'pathao', mappedStatus);
    this.logger.log(`Pathao: ${consignmentId} → ${mappedStatus}`);
    return { ok: true, status: mappedStatus };
  }

  async handleRedx(body: Record<string, unknown>) {
    const trackingId = body['tracking_id'] as string;
    const status = (body['current_status'] as string)?.toLowerCase();
    const invoiceId = body['merchant_invoice_id'] as string;

    let order: {
      id: string;
      courierStatus: string | null;
      courierTrackingCode: string | null;
      courierConsignmentId: string | null;
    } | null = null;
    if (trackingId)
      order = await this.prisma.order.findFirst({
        where: { courierTrackingCode: trackingId },
      });
    if (!order && invoiceId)
      order = await this.prisma.order.findFirst({
        where: { displayId: invoiceId },
      });
    if (!order) return { error: 'Order not found' };

    const mappedStatus = mapRedxStatus(status);
    if (!mappedStatus) return { ok: true, skipped: 'No status change needed' };

    if (this.isRegression(order.courierStatus || '', mappedStatus)) {
      this.logger.warn(
        `RedX regression blocked: ${trackingId} ${order.courierStatus} → ${mappedStatus}`,
      );
      return { ok: true, skipped: 'Status regression blocked' };
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        courierStatus: status,
        courierTrackingCode: trackingId || order.courierTrackingCode,
        courierService: 'redx',
      },
    });
    await this.addTimelineEntry(order.id, 'redx', mappedStatus);
    this.logger.log(`RedX: ${trackingId || invoiceId} → ${mappedStatus}`);
    return { ok: true, status: mappedStatus };
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
        courierStatus: event || deliveryStatus,
        courierConsignmentId: consignmentId || order.courierConsignmentId,
        courierService: 'carrybee',
      },
    });
    await this.addTimelineEntry(order.id, 'carrybee', mappedStatus);
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
