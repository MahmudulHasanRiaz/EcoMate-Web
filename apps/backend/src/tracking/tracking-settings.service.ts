import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingNormalizer } from './tracking.normalizer';

@Injectable()
export class TrackingSettingsService {
  private readonly logger = new Logger(TrackingSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Read a system setting, falling back to an env var when the setting is absent or unreadable. */
  async get(systemKey: string, envKey: string | null): Promise<string | null> {
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

  async isEnabled(enabledKey: string): Promise<boolean> {
    return (await this.get(enabledKey, null)) === 'true';
  }

  /**
   * test_event_code is honored only when the provider's explicit test-mode flag is set,
   * so a leftover value can never leak into production traffic (design v2 §4.11, fixes D10).
   */
  async getTestEventCode(provider: string): Promise<string | null> {
    const testMode = await this.get(`tracking_${provider}_test_mode`, null);
    if (testMode !== 'true') return null;
    return this.get(`tracking_${provider}_test_code`, null);
  }

  /**
   * Capture-time snapshot of the tracking configuration. Stored on the outbox
   * row (`TrackingOutbox.configSnapshot`) so a later relay/dispatch (or replay)
   * can reproduce the providers + policy the business event was captured under.
   *
   * `enabledProviders` lists providers that were enabled at capture time: meta +
   * tiktok from their system-setting flags, ga4/google_ads from env config
   * presence (they have no DB flag). The dispatcher still re-checks provider
   * capability (`supports()`) at dispatch time — this is an audit/replay record,
   * not a lock.
   */
  async buildConfigSnapshot(): Promise<Record<string, unknown>> {
    const keys = [
      'tracking_meta_enabled',
      'tracking_tiktok_enabled',
      'tracking_meta_purchase_mode',
      'tracking_meta_validated_status',
      'tracking_tiktok_purchase_mode',
      'tracking_tiktok_validated_status',
    ];
    const values = await Promise.all(keys.map((key) => this.get(key, null)));
    const map = Object.fromEntries(keys.map((key, i) => [key, values[i]]));

    const enabledProviders: string[] = [];
    if (map['tracking_meta_enabled'] === 'true') enabledProviders.push('meta');
    if (map['tracking_tiktok_enabled'] === 'true')
      enabledProviders.push('tiktok');
    if (this.config.get('GA_MEASUREMENT_ID') && this.config.get('GA_API_SECRET'))
      enabledProviders.push('ga4');
    if (this.config.get('GA_ADS_CONVERSION_ID'))
      enabledProviders.push('google_ads');

    return {
      enabledProviders,
      normalizerVersion: new TrackingNormalizer().version,
      capturedAt: new Date().toISOString(),
      purchaseModes: {
        meta: map['tracking_meta_purchase_mode'] || 'instant',
        tiktok: map['tracking_tiktok_purchase_mode'] || 'instant',
      },
      validatedStatuses: {
        meta: map['tracking_meta_validated_status'] || '',
        tiktok: map['tracking_tiktok_validated_status'] || '',
      },
    };
  }
}
