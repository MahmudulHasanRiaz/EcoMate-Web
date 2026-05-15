import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class CourierWebhookService {
  private readonly logger = new Logger(CourierWebhookService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handleSteadfast(body: Record<string, unknown>) {
    const consignmentId = body['consignment_id'] as string;
    const status = (body['status'] as string)?.toLowerCase();
    const trackingCode = body['tracking_code'] as string;

    if (!consignmentId) return { error: 'Missing consignment_id' };

    const order = await this.prisma.order.findFirst({
      where: { courierConsignmentId: consignmentId },
    });
    if (!order) return { error: 'Order not found' };

    const statusMap: Record<string, string> = {
      'pending': 'In Courier', 'picked': 'In Courier', 'in_review': 'Confirmed',
      'delivered': 'Delivered', 'cancelled': 'Cancelled', 'hold': 'On Hold',
      'partial_returned': 'Partial Return', 'returned': 'Returned',
      'in_transit': 'In Courier',
    };
    const mappedStatus = statusMap[status || ''] || status;

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        courierStatus: mappedStatus,
        courierTrackingCode: trackingCode || order.courierTrackingCode,
        courierService: 'steadfast',
      },
    });
    await this.addTimelineEntry(order.id, 'steadfast', mappedStatus, body['note'] as string);
    this.logger.log(`Steadfast webhook: ${consignmentId} → ${mappedStatus}`);
    return { ok: true };
  }

  async handlePathao(body: Record<string, unknown>) {
    const consignmentId = body['consignment_id'] as string;
    const event = body['event'] as string;
    const status = body['order_status'] as string;

    if (!consignmentId) return { error: 'Missing consignment_id' };

    const order = await this.prisma.order.findFirst({
      where: { courierConsignmentId: consignmentId },
    });
    if (!order) return { error: 'Order not found' };

    const statusMap: Record<string, string> = {
      'picked': 'In Courier', 'assigned': 'In Courier', 'accepted': 'In Courier',
      'pickup': 'In Courier', 'cancelled': 'Cancelled', 'delivered': 'Delivered',
      'partial': 'Partial Return', 'return': 'Returned', 'hold': 'On Hold',
      'transit': 'In Courier',
    };
    const mappedStatus = statusMap[status?.toLowerCase() || ''] || status || event;

    await this.prisma.order.update({
      where: { id: order.id },
      data: { courierStatus: mappedStatus, courierService: 'pathao' },
    });
    await this.addTimelineEntry(order.id, 'pathao', mappedStatus, body['note'] as string);
    this.logger.log(`Pathao webhook: ${consignmentId} → ${mappedStatus}`);
    return { ok: true };
  }

  async handleRedx(body: Record<string, unknown>) {
    const trackingId = body['tracking_id'] as string;
    const status = (body['current_status'] as string)?.toLowerCase();
    const invoiceId = body['merchant_invoice_id'] as string;

    let order: { id: string; courierTrackingCode?: string | null; courierConsignmentId?: string | null; timeline: unknown } | null = null;
    if (trackingId) {
      order = await this.prisma.order.findFirst({ where: { courierTrackingCode: trackingId } });
    }
    if (!order && invoiceId) {
      order = await this.prisma.order.findFirst({ where: { displayId: invoiceId } });
    }
    if (!order) return { error: 'Order not found' };

    const statusMap: Record<string, string> = {
      'pending': 'In Courier', 'picked': 'In Courier', 'in_transit': 'In Courier',
      'delivered': 'Delivered', 'cancelled': 'Cancelled', 'partial_delivered': 'Partial Return',
      'return_pending': 'Return Pending', 'returned': 'Returned',
      'hold': 'On Hold',
    };
    const mappedStatus = statusMap[status || ''] || status;

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        courierStatus: mappedStatus,
        courierTrackingCode: trackingId || order.courierTrackingCode,
        courierService: 'redx',
      },
    });
    await this.addTimelineEntry(order.id, 'redx', mappedStatus, body['note'] as string);
    this.logger.log(`RedX webhook: ${trackingId || invoiceId} → ${mappedStatus}`);
    return { ok: true };
  }

  async handleCarrybee(body: Record<string, unknown>) {
    const consignmentId = body['consignment_id'] as string;
    const event = body['event'] as string;
    const status = body['delivery_status'] as string;
    const orderNumber = body['merchant_order_id'] as string;

    let order: { id: string; courierTrackingCode?: string | null; courierConsignmentId?: string | null; timeline: unknown } | null = null;
    if (consignmentId) {
      order = await this.prisma.order.findFirst({ where: { courierConsignmentId: consignmentId } });
    }
    if (!order && orderNumber) {
      order = await this.prisma.order.findFirst({ where: { displayId: orderNumber } });
    }
    if (!order) return { error: 'Order not found' };

    const statusMap: Record<string, string> = {
      'pending': 'In Courier', 'picked': 'In Courier', 'pickup_done': 'In Courier',
      'in_transit': 'In Courier', 'ofd': 'In Courier', 'delivered': 'Delivered',
      'cancelled': 'Cancelled', 'partial': 'Partial Return', 'return': 'Return Pending',
      'returned': 'Returned', 'hold': 'On Hold', 'out_for_delivery': 'In Courier',
    };
    const mappedStatus = statusMap[status?.toLowerCase() || ''] || status || event;

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        courierStatus: mappedStatus,
        courierConsignmentId: consignmentId || order.courierConsignmentId,
        courierService: 'carrybee',
      },
    });
    await this.addTimelineEntry(order.id, 'carrybee', mappedStatus, body['note'] as string);
    this.logger.log(`Carrybee webhook: ${consignmentId || orderNumber} → ${mappedStatus}`);
    return { ok: true };
  }

  private async addTimelineEntry(orderId: string, courier: string, status: string, note?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return;
    const timeline = [...((order.timeline as unknown[]) || []), {
      type: 'courier',
      courier,
      status,
      timestamp: new Date().toISOString(),
      note: note || `Courier status: ${status}`,
    }];
    await this.prisma.order.update({ where: { id: orderId }, data: { timeline: timeline as Prisma.InputJsonValue } });
  }
}
