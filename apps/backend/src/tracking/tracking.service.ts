import { Injectable } from '@nestjs/common';
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
  constructor(private readonly queue: TrackingQueueService) {}

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
}
