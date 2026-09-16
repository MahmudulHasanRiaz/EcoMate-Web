import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingNormalizer } from './tracking.normalizer';
import {
  META_DESTINATIONS_SETTING_KEY,
  TrackingDestination,
  capturedDestinationRefs,
  resolveMetaDestinations,
} from './destinations';

/**
 * Delivery success policy for a captured event's outbox.
 *
 * The DEFAULT is unchanged from the implicit pre-Step-3 behaviour (`ALL_SENT`): an
 * event is not considered delivered unless every eligible destination took it.
 * What Step 3 fixes is that the policy is now actually RECORDED on the snapshot
 * instead of being re-defaulted at every dispatch (the field existed but was never
 * written). The dispatcher's evaluation also changed so a permanently-failed
 * destination can no longer abort a sibling destination's in-flight retries — see
 * TrackingDispatcherService.advanceOutbox.
 */
export const DEFAULT_SUCCESS_POLICY = 'ALL_SENT';
export const SUCCESS_POLICY_SETTING_KEY = 'tracking_success_policy';

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
   * Read a boolean setting that defaults to `defaultValue` when absent (unlike
   * isEnabled, which treats an absent key as false). Used for safety guards that
   * are ON by default but can be disabled per server with an explicit 'false'
   * (e.g. the 7-day event-age guard). An env fallback, when provided, is read
   * only when the setting is absent (matching get()).
   */
  async isEnabledOrDefault(
    key: string,
    defaultValue: boolean,
    envKey?: string,
  ): Promise<boolean> {
    const raw = await this.get(key, envKey ?? null);
    return raw === null ? defaultValue : raw === 'true';
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
   * Resolve the effective Meta destination list: the configured array when present,
   * otherwise the legacy single-pixel synthesis (Step 3 backward compatibility).
   *
   * This is the ONE place the fallback rule lives — the dispatcher (`buildCfg`) and
   * the public storefront config mapper both call it, so the browser can never
   * initialize a pixel the server does not deliver to.
   *
   * The returned objects contain the SECRET access token. Never serialize the
   * result into an API response, a config snapshot, or a log; project it through
   * `publicMetaDestinations()` for anything browser-facing.
   */
  async getMetaDestinations(): Promise<TrackingDestination[]> {
    const [raw, legacyPixelId, legacyAccessToken] = await Promise.all([
      this.get(META_DESTINATIONS_SETTING_KEY, null),
      this.get('tracking_meta_pixel_id', 'META_PIXEL_ID'),
      this.get('tracking_meta_access_token', 'META_ACCESS_TOKEN'),
    ]);
    return resolveMetaDestinations(raw, legacyPixelId, legacyAccessToken);
  }

  /**
   * Delivery success policy for new captures. Persisted (not re-defaulted at
   * dispatch time) so a policy change is auditable and a replay reproduces the
   * policy the event was captured under.
   */
  async getSuccessPolicy(): Promise<string> {
    return (
      (await this.get(SUCCESS_POLICY_SETTING_KEY, null)) ?? DEFAULT_SUCCESS_POLICY
    );
  }

  /**
   * Capture-time snapshot of the tracking configuration. Stored on the outbox
   * row (`TrackingOutbox.configSnapshot`) so a later relay/dispatch (or replay)
   * can reproduce the providers + destinations + policy the business event was
   * captured under.
   *
   * CAPTURE-TIME SEMANTICS (Step 3): `destinations` is the set of destinations
   * eligible at the moment of capture. A destination disabled afterwards still
   * receives this event (disabling is forward-looking); a destination added
   * afterwards never does (no historical backfill). This mirrors the pre-existing
   * `enabledProviders`-at-capture behaviour.
   *
   * SECURITY: the snapshot is copied verbatim into the durable replay archive, so
   * it must never carry an access token. `capturedDestinationRefs()` emits only
   * destinationId + pixelId + mode.
   *
   * The dispatcher still re-checks provider capability (`supports()`) at dispatch
   * time — this is an audit/replay record, not a lock.
   */
  async buildConfigSnapshot(): Promise<Record<string, unknown>> {
    const keys = [
      'tracking_meta_enabled',
      'tracking_tiktok_enabled',
      'tracking_meta_purchase_mode',
      'tracking_meta_validated_status',
      'tracking_tiktok_purchase_mode',
      'tracking_tiktok_validated_status',
      'currency',
    ];
    const [values, metaDestinations, successPolicy] = await Promise.all([
      Promise.all(keys.map((key) => this.get(key, null))),
      this.getMetaDestinations(),
      this.getSuccessPolicy(),
    ]);
    const map = Object.fromEntries(keys.map((key, i) => [key, values[i]]));

    const metaPurchaseMode = map['tracking_meta_purchase_mode'] || 'instant';
    const metaDestinationsAtCapture = capturedDestinationRefs(
      metaDestinations,
      metaPurchaseMode,
    );

    // A provider with no eligible destination is not an enabled provider — the
    // work set must not contain a provider that has nowhere to deliver. This
    // preserves the old behaviour for a legacy install (which always resolves to
    // exactly one destination when a pixel id is set).
    const enabledProviders: string[] = [];
    if (map['tracking_meta_enabled'] === 'true' && metaDestinationsAtCapture.length > 0)
      enabledProviders.push('meta');
    if (map['tracking_tiktok_enabled'] === 'true')
      enabledProviders.push('tiktok');
    if (this.config.get('GA_MEASUREMENT_ID') && this.config.get('GA_API_SECRET'))
      enabledProviders.push('ga4');
    if (this.config.get('GA_ADS_CONVERSION_ID'))
      enabledProviders.push('google_ads');

    return {
      enabledProviders,
      // Capture-time destination eligibility (token-free). The dispatcher
      // materializes exactly these dispatch rows — never a destination that was
      // added later.
      destinations: metaDestinationsAtCapture,
      successPolicy,
      normalizerVersion: new TrackingNormalizer().version,
      capturedAt: new Date().toISOString(),
      // Single source of truth for currency: the storefront public config and
      // every server-side Purchase capture read the same `currency` setting.
      currency: map['currency'] || 'BDT',
      purchaseModes: {
        meta: metaPurchaseMode,
        tiktok: map['tracking_tiktok_purchase_mode'] || 'instant',
      },
      validatedStatuses: {
        meta: map['tracking_meta_validated_status'] || '',
        tiktok: map['tracking_tiktok_validated_status'] || '',
      },
    };
  }
}
