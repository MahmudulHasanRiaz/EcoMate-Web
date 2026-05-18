import { Injectable } from '@nestjs/common';
import { MetaConversionsService } from './meta-conversions.service';
import { TikTokEventsService } from './tiktok-events.service';
import { v4 as uuid } from 'uuid';

export interface TrackingEvent {
  eventName: string;
  eventId?: string;
  userId?: string;
  userData?: {
    email?: string;
    phone?: string;
    ip?: string;
    userAgent?: string;
  };
  customData?: Record<string, any>;
}

@Injectable()
export class TrackingService {
  constructor(
    private readonly meta: MetaConversionsService,
    private readonly tiktok: TikTokEventsService,
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
      userData: {
        email: userData.email,
        phone: userData.phone,
        ip: userData.ip,
        userAgent: userData.userAgent,
      },
      customData: event.customData,
    };

    await Promise.allSettled([
      this.meta.sendEvent(payload),
      this.tiktok.sendEvent(payload),
    ]);
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
