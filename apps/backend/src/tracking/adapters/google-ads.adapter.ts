import { TrackingNormalizer } from '../tracking.normalizer';
import {
  TrackingContextView,
  TrackingSnapshotPayload,
} from '../tracking-snapshot.types';
import {
  DispatchResult,
  ProviderConfig,
  ProviderPayload,
  TrackingProviderAdapter,
} from './tracking-provider.adapter';

const GOOGLE_ADS_CONVERSION_URL =
  'https://www.googleadservices.com/pagead/conversion/';
const REQUEST_TIMEOUT_MS = 1500;
const MAX_RAW_RESPONSE_CHARS = 500;

/**
 * Google Ads offline conversion adapter (design §4.6). build() maps a canonical
 * TrackingSnapshotPayload onto an offline-conversion payload — click identifiers
 * (gclid/gbraid) pass through raw from the context view, PII is hashed ONLY
 * through the injected TrackingNormalizer (Google requires SHA-256 on user
 * identifiers), and `conversionDateTime` is an ISO-8601 timestamp derived from
 * eventTime. Only Purchase and Refund map to conversions; a Refund becomes a
 * negative-value conversion carrying a distinct `refund_{orderId}` event id so
 * its dispatch record never collides with the original sale.
 *
 * Google Ads deduplicates imported conversions on order_id (+ gclid + value),
 * so `orderId` always carries the raw order id (never prefixed) while the
 * bookkeeping `eventId` carries the purchase_/refund_ prefix.
 *
 * `conversionAction` records which canonical conversion this payload represents;
 * the concrete Google Ads conversion action is config-resolved at dispatch time
 * (conversionId + label) — build() has no config access, mirroring how TikTok's
 * send() fills pixel_code from cfg. send() POSTs to the gtag conversion REST
 * endpoint (ported from google-ads.service.ts) using cfg.conversionId from
 * GOOGLE_ADS_CONVERSION_ID and classifies the outcome for the dispatch retry
 * policy (4xx non-429 → not retryable; 429/5xx/network/timeout → retryable).
 */
export class GoogleAdsAdapter implements TrackingProviderAdapter {
  readonly provider = 'google_ads';
  readonly version = 1;
  readonly providerApiVersion = 'offline-conversion';

  supports(eventType: string): boolean {
    return eventType === 'Purchase' || eventType === 'Refund';
  }

  build(
    snapshot: TrackingSnapshotPayload,
    ctx: TrackingContextView,
    normalizer: TrackingNormalizer,
  ): ProviderPayload | null {
    // Canonical event type: the dispatcher sets snapshot.eventType; fall back to
    // Purchase when a value is present and the type is still ambiguous.
    const eventType =
      snapshot.eventType ?? (snapshot.value !== undefined ? 'Purchase' : undefined);
    if (!eventType || !this.supports(eventType)) return null;

    const eventId = this.resolveEventId(eventType, snapshot);
    if (!eventId) return null; // no dedup id → refuse to build

    const isRefund = eventType === 'Refund';
    const conversionValue =
      isRefund && snapshot.value !== undefined ? -snapshot.value : snapshot.value;

    const customer = snapshot.customer;
    const userIdentifiers: Array<Record<string, string>> = [];
    if (customer?.email) {
      const hashedEmail = normalizer.hashEmail(customer.email);
      if (hashedEmail) userIdentifiers.push({ hashedEmail });
    }
    if (customer?.phone) {
      const hashedPhoneNumber = normalizer.hashPhone(
        customer.phone,
        customer.country,
      );
      if (hashedPhoneNumber) userIdentifiers.push({ hashedPhoneNumber });
    }

    const eventTime = Math.floor(Date.now() / 1000);

    return {
      eventName: eventType,
      eventId,
      eventTime,
      eventType,
      conversionAction: eventType,
      // Click identifiers are raw session identifiers — NEVER hashed (design §4.5).
      gclid: ctx.gclid,
      gbraid: (ctx as TrackingContextView & { gbraid?: string }).gbraid,
      conversionDateTime: new Date(eventTime * 1000).toISOString(),
      conversionValue,
      currencyCode: snapshot.currency,
      orderId: snapshot.orderId,
      userIdentifiers,
    };
  }

  async send(payload: ProviderPayload, cfg: ProviderConfig): Promise<DispatchResult> {
    const { conversionId, conversionLabel } = cfg;
    if (!conversionId) {
      return {
        ok: false,
        retryable: false,
        httpStatus: 0,
        rawResponse: 'missing conversionId',
      };
    }
    const gclid = payload.gclid as string | undefined;
    const gbraid = payload.gbraid as string | undefined;
    if (!gclid && !gbraid) {
      return {
        ok: false,
        retryable: false,
        httpStatus: 0,
        rawResponse: 'missing gclid or gbraid',
      };
    }

    const value = payload.conversionValue ?? 0;
    const currency = payload.currencyCode || 'BDT';
    const url =
      `${GOOGLE_ADS_CONVERSION_URL}${encodeURIComponent(conversionId)}/` +
      `?label=${encodeURIComponent(conversionLabel || '')}&value=${value}` +
      `&currency_code=${encodeURIComponent(currency)}`;
    const body = {
      // gclid on web; gbraid for Google Ads clicks on iOS/consented surfaces.
      ...(gclid ? { gclid } : { gbraid }),
      conversion_id: payload.orderId,
      conversion_value: value,
      conversion_currency: currency,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const rawResponse = (await response.text()).slice(0, MAX_RAW_RESPONSE_CHARS);

      if (response.ok) {
        return {
          ok: true,
          retryable: false,
          providerEventId: payload.eventId,
          httpStatus: response.status,
          rawResponse,
        };
      }
      const retryable = response.status === 429 || response.status >= 500;
      return {
        ok: false,
        retryable,
        providerEventId: payload.eventId,
        httpStatus: response.status,
        rawResponse,
      };
    } catch (err) {
      // Network error or AbortSignal timeout → safe to retry.
      return {
        ok: false,
        retryable: true,
        providerEventId: payload.eventId,
        rawResponse: (err as Error).message.slice(0, MAX_RAW_RESPONSE_CHARS),
      };
    }
  }

  /** purchase_{orderId} / refund_{orderId}; non-order events use the caller's id. */
  private resolveEventId(
    eventType: string,
    snapshot: TrackingSnapshotPayload,
  ): string | undefined {
    if (eventType === 'Purchase' || eventType === 'Refund') {
      if (snapshot.orderId) return `${eventType.toLowerCase()}_${snapshot.orderId}`;
      return snapshot.eventId;
    }
    return snapshot.eventId;
  }
}
