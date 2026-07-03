import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { createHash } from 'crypto';

interface TrackEvent {
  eventName: string;
  eventId: string;
  eventTime: number;
  userId?: string;
  userData: {
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
    url?: string;
    referrer?: string;
  };
  customData?: Record<string, any>;
}

@Injectable()
export class TikTokEventsService {
  private readonly logger = new Logger(TikTokEventsService.name);
  private readonly apiUrl =
    'https://business-api.tiktok.com/open_api/v1.3/pixel/track/';

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  async sendEvent(event: TrackEvent) {
    const pixelCode = await this.getSetting(
      'tracking_tiktok_pixel_code',
      'TIKTOK_PIXEL_CODE',
    );
    const accessToken = await this.getSetting(
      'tracking_tiktok_access_token',
      'TIKTOK_ACCESS_TOKEN',
    );
    const enabled = await this.getSetting('tracking_tiktok_enabled', null);

    const isEnabled = enabled === 'true';

    if (!pixelCode || !accessToken || !isEnabled) {
      this.logger.warn('TikTok Pixel not configured, skipping event');
      return;
    }

    try {
      const eventName =
        event.eventName === 'Purchase' ? 'CompletePayment' : event.eventName;

      const {
        email,
        phone,
        name,
        firstName,
        lastName,
        ip,
        userAgent,
        city,
        country,
        state,
        zip,
        address,
        url,
        referrer,
      } = event.userData;
      const externalId = event.userId
        ? this.hash(event.userId)
        : phone
          ? this.hash(phone)
          : email
            ? this.hash(email)
            : undefined;

      const fn = firstName
        ? this.hash(firstName)
        : name
          ? this.hash(this.splitName(name).firstName)
          : undefined;

      const ln = lastName
        ? this.hash(lastName)
        : name
          ? this.hash(this.splitName(name).lastName)
          : undefined;

      const body = {
        pixel_code: pixelCode,
        event: eventName,
        event_id: event.eventId,
        timestamp: event.eventTime,
        context: {
          ip,
          user_agent: userAgent,
          page: {
            url: url || undefined,
            referrer: referrer || undefined,
          },
          user: {
            email: email ? this.hash(email) : undefined,
            phone_number: phone
              ? this.hash(this.normalizePhone(phone))
              : undefined,
            external_id: externalId,
            first_name: fn,
            last_name: ln,
            city: city ? this.hash(city) : undefined,
            state: state ? this.hash(state) : undefined,
            zip: zip ? this.hash(zip) : undefined,
            country: country ? this.hash(country) : undefined,
            address: address ? this.hash(address) : undefined,
          },
        },
        properties: event.customData || {},
      };

      const maxRetries = 3;
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Access-Token': accessToken,
            },
            body: JSON.stringify(body),
          });

          if (response.ok) {
            this.logger.log(
              `TikTok event sent: ${eventName} [${event.eventId}]`,
            );
            return;
          }

          if (response.status < 500 && response.status !== 429) {
            this.logger.error(
              `TikTok API error: ${response.status} ${await response.text()}`,
            );
            return;
          }

          lastError = new Error(
            `HTTP ${response.status}: ${await response.text()}`,
          );
          this.logger.warn(
            `TikTok retryable error (attempt ${attempt + 1}/${maxRetries}): ${response.status}`,
          );
        } catch (err) {
          lastError = err as Error;
          this.logger.warn(
            `TikTok network error (attempt ${attempt + 1}/${maxRetries}): ${err}`,
          );
        }

        if (attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
      }

      this.logger.error(
        `TikTok API failed after ${maxRetries} retries`,
        lastError,
      );
    } catch (err) {
      this.logger.error('TikTok API request failed', err);
    }
  }

  private async getSetting(
    systemKey: string,
    envKey: string | null,
  ): Promise<string | null> {
    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: systemKey },
      });
      if (setting?.value) return setting.value;
    } catch (err) {
      this.logger.warn(`Failed to read setting ${systemKey}: ${err}`);
    }
    if (envKey) return this.config.get(envKey) || null;
    return null;
  }

  private hash(data: string): string {
    return createHash('sha256').update(data.toLowerCase().trim()).digest('hex');
  }

  private splitName(fullName: string): { firstName: string; lastName: string } {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) {
      return { firstName: parts[0], lastName: '' };
    }
    const lastName = parts.pop() || '';
    const firstName = parts.join(' ');
    return { firstName, lastName };
  }

  private normalizePhone(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('01') && cleaned.length === 11) {
      cleaned = '88' + cleaned;
    } else {
      cleaned = cleaned.replace(/^0+/, '');
      if (!/^\d{11,15}$/.test(cleaned)) return phone.replace(/\D/g, '');
    }
    return cleaned;
  }
}
