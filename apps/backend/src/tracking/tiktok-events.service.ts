import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

interface TrackEvent {
  eventName: string;
  eventId: string;
  eventTime: number;
  userData: {
    email?: string;
    phone?: string;
    name?: string;
    ip?: string;
    userAgent?: string;
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

      const body = {
        pixel_code: pixelCode,
        event: eventName,
        event_id: event.eventId,
        timestamp: event.eventTime,
        context: {
          ip: event.userData.ip,
          user_agent: event.userData.userAgent,
          page: {
            url: (event.userData as any).url || undefined,
            referrer: (event.userData as any).referrer || undefined,
          },
          user: {
            email: event.userData.email
              ? this.hash(event.userData.email)
              : undefined,
            phone_number: event.userData.phone
              ? this.hash(event.userData.phone)
              : undefined,
            external_id: event.userData.phone
              ? this.hash(event.userData.phone)
              : undefined,
          },
        },
        properties: event.customData || {},
      };

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Access-Token': accessToken,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        this.logger.error(
          `TikTok API error: ${response.status} ${await response.text()}`,
        );
      }
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
    } catch {}
    if (envKey) return this.config.get(envKey) || null;
    return null;
  }

  private hash(data: string): string {
    const crypto = require('crypto');
    return crypto
      .createHash('sha256')
      .update(data.toLowerCase().trim())
      .digest('hex');
  }
}
