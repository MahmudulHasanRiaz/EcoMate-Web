import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingQueueService } from './tracking-queue.service';
import { v4 as uuid } from 'uuid';

export interface TrackingEvent {
  eventName: string;
  eventId?: string;
  eventTime?: number;
  actionSource?: string;
  userId?: string;
  userData?: {
    email?: string;
    phone?: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    ip?: string;
    userAgent?: string;
    city?: string;
    country?: string;
    state?: string;
    zip?: string;
    address?: string;
    fbp?: string;
    fbc?: string;
    url?: string;
    referrer?: string;
  };
  customData?: Record<string, any>;
}

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private readonly queue: TrackingQueueService,
    private readonly prisma: PrismaService,
  ) {}

  async track(event: TrackingEvent) {
    const eventId = event.eventId || uuid();
    const eventTime = event.eventTime ?? Math.floor(Date.now() / 1000);
    const userData = event.userData || {};

    await this.queue.enqueue({
      eventId,
      eventName: event.eventName,
      eventTime,
      actionSource: event.actionSource,
      userId: event.userId,
      userData: { ...userData },
      customData: event.customData,
    });
  }

  async saveContext(
    orderId: string,
    context: { fbp?: string; fbc?: string; url?: string; referrer?: string },
  ) {
    try {
      await this.prisma.trackingEvent.upsert({
        where: { eventId: `ctx_${orderId}` },
        create: {
          eventId: `ctx_${orderId}`,
          orderId,
          eventType: 'context',
          fbp: context.fbp,
          fbc: context.fbc,
          url: context.url,
          referrer: context.referrer,
        },
        update: {
          fbp: context.fbp,
          fbc: context.fbc,
          url: context.url,
          referrer: context.referrer,
        },
      });
    } catch (err) {
      this.logger.error('Failed to save tracking context:', err);
    }
  }

  async getContext(orderId: string): Promise<{
    fbp?: string;
    fbc?: string;
    url?: string;
    referrer?: string;
  } | null> {
    try {
      const record = await this.prisma.trackingEvent.findUnique({
        where: { eventId: `ctx_${orderId}` },
      });
      if (!record) return null;
      return {
        fbp: record.fbp || undefined,
        fbc: record.fbc || undefined,
        url: record.url || undefined,
        referrer: record.referrer || undefined,
      };
    } catch {
      return null;
    }
  }
}
