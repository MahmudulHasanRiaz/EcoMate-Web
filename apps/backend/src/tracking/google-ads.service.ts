import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

@Injectable()
export class GoogleAdsService {
  private readonly logger = new Logger(GoogleAdsService.name);

  constructor(private config: ConfigService) {}

  async sendConversion(event: {
    eventName: string;
    eventId: string;
    conversionId: string;
    value?: number;
    currency?: string;
    email?: string;
    phone?: string;
    orderId?: string;
  }) {
    if (event.eventName !== 'Purchase') return;

    const conversionId = this.config.get('GA_ADS_CONVERSION_ID') || '';
    if (!conversionId) return;

    const label = this.config.get('GA_ADS_CONVERSION_LABEL') || '';

    // Google Ads Enhanced Conversions via gtag — client-side via gtag.js
    // Server-side: fire via fetch to Google's conversion tracking endpoint
    // Using the Google Ads API is preferred for production; gtag REST fallback here

    const gclid = event.email
      ? createHash('sha256').update(event.email.toLowerCase().trim()).digest('hex')
      : event.phone
        ? createHash('sha256').update(event.phone.replace(/\D/g, '')).digest('hex')
        : '';

    if (!gclid) return;

    const url = `https://www.googleadservices.com/pagead/conversion/${conversionId}/?label=${label}&value=${event.value || 0}&currency_code=${event.currency || 'BDT'}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gclid,
          conversion_id: event.orderId,
          conversion_value: event.value || 0,
          conversion_currency: event.currency || 'BDT',
        }),
      });

      if (response.ok || response.status === 204) {
        this.logger.log(`Google Ads conversion sent: ${event.eventId}`);
      } else {
        this.logger.warn(`Google Ads response: ${response.status}`);
      }
    } catch (err) {
      this.logger.error(`Google Ads request failed: ${err}`);
    }
  }
}
