import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

interface TrackEvent {
  eventName: string;
  eventId: string;
  eventTime: number;
  userId?: string;
  userData: {
    email?: string;
    phone?: string;
    ip?: string;
    userAgent?: string;
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
    const pixelId = await this.getSetting('tracking_meta_pixel_id', 'META_PIXEL_ID');
    const accessToken = await this.getSetting('tracking_meta_access_token', 'META_ACCESS_TOKEN');
    const testCode = await this.getSetting('tracking_meta_test_code', null);
    const enabled = await this.getSetting('tracking_meta_enabled', null);

    const isEnabled = enabled === 'true';

    if (!pixelId || !accessToken || !isEnabled) {
      this.logger.warn('Meta Pixel not configured, skipping event');
      return;
    }

    const apiUrl = `https://graph.facebook.com/v18.0/${pixelId}/events`;

    try {
      const body: any = {
        data: [{
          event_name: event.eventName,
          event_time: event.eventTime,
          event_id: event.eventId,
          action_source: 'website',
          user_data: {
            em: event.userData.email ? this.hash(event.userData.email) : undefined,
            ph: event.userData.phone ? this.hash(event.userData.phone) : undefined,
            fn: event.userData.name ? this.hash(this.splitName(event.userData.name).firstName) : undefined,
            ln: event.userData.name ? this.hash(this.splitName(event.userData.name).lastName) : undefined,
            external_id: event.userData.phone ? this.hash(event.userData.phone) : undefined,
            fbp: (event.userData as any).fbp || undefined,
            fbc: (event.userData as any).fbc || undefined,
            ct: (event.userData as any).city ? this.hash((event.userData as any).city) : undefined, // সিটি হ্যাশ করা হলো
            cn: (event.userData as any).country ? this.hash((event.userData as any).country) : undefined, // কান্ট্রি হ্যাশ করা হলো
            client_ip_address: event.userData.ip,
            client_user_agent: event.userData.userAgent,
          },
          custom_data: event.customData,
        }],
        access_token: accessToken,
      };

      if (testCode) {
        body.test_event_code = testCode;
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        this.logger.error(`Meta CAPI error: ${response.status} ${await response.text()}`);
      }
    } catch (err) {
      this.logger.error('Meta CAPI request failed', err);
    }
  }

  private async getSetting(systemKey: string, envKey: string | null): Promise<string | null> {
    try {
      const setting = await this.prisma.systemSetting.findUnique({ where: { key: systemKey } });
      if (setting?.value) return setting.value;
    } catch {}
    if (envKey) return this.config.get(envKey) || null;
    return null;
  }

  private hash(data: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(data.toLowerCase().trim()).digest('hex');
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
}
