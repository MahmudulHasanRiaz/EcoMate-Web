import { Injectable, Logger } from '@nestjs/common';
import { MetaConversionsService } from './meta-conversions.service';
import { TikTokEventsService } from './tiktok-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuid } from 'uuid';

export interface TrackingEvent {
  eventName: string;
  eventId?: string;
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
    private readonly meta: MetaConversionsService,
    private readonly tiktok: TikTokEventsService,
    private readonly prisma: PrismaService,
  ) {}

  async track(event: TrackingEvent) {
    const eventId = event.eventId || uuid();
    const eventTime = Math.floor(Date.now() / 1000);
    const userData = event.userData || {};

    const payload = {
      eventName: this.mapEventName(event.eventName),
      eventId,
      eventTime,
      userId: event.userId,
      userData: { ...userData },
      customData: event.customData,
    };

    await Promise.allSettled([
      this.meta.sendEvent(payload),
      this.tiktok.sendEvent(payload),
    ]);
  }

  async saveContext(
    orderId: string,
    context: { fbp?: string; fbc?: string; url?: string; referrer?: string },
  ) {
    try {
      await this.prisma.systemSetting.upsert({
        where: { key: `tracking_ctx_${orderId}` },
        create: {
          key: `tracking_ctx_${orderId}`,
          value: JSON.stringify(context),
        },
        update: { value: JSON.stringify(context) },
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
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: `tracking_ctx_${orderId}` },
      });
      return setting ? JSON.parse(setting.value) : null;
    } catch {
      return null;
    }
  }

  private mapEventName(name: string): string {
    const map: Record<string, string> = {
      view_content: 'ViewContent',
      add_to_cart: 'AddToCart',
      add_to_wishlist: 'AddToWishlist',
      initiate_checkout: 'InitiateCheckout',
      add_payment_info: 'AddPaymentInfo',
      purchase: 'Purchase',
      search: 'Search',
      complete_registration: 'CompleteRegistration',
    };
    return map[name] || name;
  }
}
