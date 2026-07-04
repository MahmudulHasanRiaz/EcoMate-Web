import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class Ga4MeasurementService {
  private readonly logger = new Logger(Ga4MeasurementService.name);

  constructor(private config: ConfigService) {}

  async sendEvent(event: {
    eventName: string;
    eventId: string;
    eventTime: number;
    userData?: Record<string, any>;
    customData?: Record<string, any>;
  }) {
    const measurementId = this.config.get('GA_MEASUREMENT_ID') || '';
    const apiSecret = this.config.get('GA_API_SECRET') || '';

    if (!measurementId || !apiSecret) {
      this.logger.warn('GA4 not configured, skipping event');
      return;
    }

    const ga4Event = this.mapToGa4Event(event);
    if (!ga4Event) return;

    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: event.userData?.clientId || 'ecomate-server',
          events: [ga4Event],
        }),
      });

      if (response.ok || response.status === 204) {
        this.logger.log(`GA4 event sent: ${event.eventName} [${event.eventId}]`);
      } else {
        this.logger.error(`GA4 error: ${response.status} ${await response.text()}`);
      }
    } catch (err) {
      this.logger.error(`GA4 request failed: ${err}`);
    }
  }

  private mapToGa4Event(event: {
    eventName: string;
    eventId: string;
    eventTime: number;
    customData?: Record<string, any>;
  }): Record<string, any> | null {
    const ga4EventName = this.toGa4EventName(event.eventName);
    if (!ga4EventName) return null;

    const params: Record<string, any> = {
      ...(event.customData || {}),
    };

    if (params.value !== undefined) {
      params.value = Number(params.value);
    }

    return { name: ga4EventName, params };
  }

  private toGa4EventName(internalName: string): string | null {
    const map: Record<string, string> = {
      ViewContent: 'view_item',
      AddToCart: 'add_to_cart',
      AddToWishlist: 'add_to_wishlist',
      InitiateCheckout: 'begin_checkout',
      AddPaymentInfo: 'add_payment_info',
      Purchase: 'purchase',
      Search: 'search',
      CompleteRegistration: 'sign_up',
      PageView: 'page_view',
    };
    return map[internalName] || null;
  }
}
