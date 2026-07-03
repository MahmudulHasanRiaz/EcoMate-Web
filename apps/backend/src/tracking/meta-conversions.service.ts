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
    fbp?: string;
    fbc?: string;
    url?: string;
    referrer?: string;
  };
  customData?: Record<string, any>;
}

@Injectable()
export class MetaConversionsService {
  private readonly logger = new Logger(MetaConversionsService.name);

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  async sendEvent(event: TrackEvent) {
    const pixelId = await this.getSetting(
      'tracking_meta_pixel_id',
      'META_PIXEL_ID',
    );
    const accessToken = await this.getSetting(
      'tracking_meta_access_token',
      'META_ACCESS_TOKEN',
    );
    const testCode = await this.getSetting('tracking_meta_test_code', null);
    const enabled = await this.getSetting('tracking_meta_enabled', null);

    const isEnabled = enabled === 'true';

    if (!pixelId || !accessToken || !isEnabled) {
      this.logger.warn('Meta Pixel not configured, skipping event');
      return;
    }

    const apiUrl = `https://graph.facebook.com/v18.0/${pixelId}/events`;

    try {
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
        fbp,
        fbc,
        url,
      } = event.userData;

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

      const external_id = event.userId
        ? this.hash(event.userId)
        : phone
          ? this.hash(phone)
          : undefined;

      const body: any = {
        data: [
          {
            event_name: event.eventName,
            event_time: event.eventTime,
            event_id: event.eventId,
            action_source: 'website',
            event_source_url: url || undefined,
            user_data: {
              em: email ? this.hash(email) : undefined,
              ph: phone ? this.hash(this.normalizePhone(phone)) : undefined,
              fn,
              ln,
              ct: city ? this.hash(city) : undefined,
              cn: country ? this.hash(country) : undefined,
              zp: zip ? this.hash(zip) : undefined,
              st: state ? this.hash(state) : undefined,
              external_id,
              fbp: fbp || undefined,
              fbc: fbc || undefined,
              client_ip_address: ip,
              client_user_agent: userAgent,
            },
            custom_data: event.customData,
          },
        ],
        access_token: accessToken,
      };

      if (testCode) {
        body.test_event_code = testCode;
      }

      const maxRetries = 3;
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

          if (response.ok) {
            this.logger.log(
              `Meta CAPI event sent: ${event.eventName} [${event.eventId}]`,
            );
            return;
          }

          if (response.status < 500 && response.status !== 429) {
            this.logger.error(
              `Meta CAPI error: ${response.status} ${await response.text()}`,
            );
            return;
          }

          lastError = new Error(
            `HTTP ${response.status}: ${await response.text()}`,
          );
          this.logger.warn(
            `Meta CAPI retryable error (attempt ${attempt + 1}/${maxRetries}): ${response.status}`,
          );
        } catch (err) {
          lastError = err as Error;
          this.logger.warn(
            `Meta CAPI network error (attempt ${attempt + 1}/${maxRetries}): ${err}`,
          );
        }

        if (attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
      }

      this.logger.error(
        `Meta CAPI failed after ${maxRetries} retries`,
        lastError,
      );
    } catch (err) {
      this.logger.error('Meta CAPI request failed', err);
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
      // remove leading 00 or + already stripped by \D
      cleaned = cleaned.replace(/^0+/, '');
      if (!/^\d{11,15}$/.test(cleaned)) return phone.replace(/\D/g, '');
    }
    return cleaned;
  }
}
