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
 * Google offline conversions require `yyyy-MM-dd HH:mm:ss+00:00` (space
 * separator, no `T`, explicit UTC offset) — NOT ISO-8601's `T...Z`.
 */
function formatConversionDateTime(eventTime: number): string {
  const d = new Date(eventTime * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return `${date} ${time}+00:00`;
}

/**
 * Google Ads offline conversion adapter (design §4.6). build() maps a canonical
 * TrackingSnapshotPayload onto an offline-conversion payload — click identifiers
 * (gclid/gbraid) pass through raw from the context view, PII is hashed ONLY
 * through the injected TrackingNormalizer (Google requires SHA-256 on user
 * identifiers), and `conversionDateTime` is Google's offline-conversion format
 * `yyyy-MM-dd HH:mm:ss+00:00` derived from eventTime. Only Purchase and Refund
 * map to conversions; a Refund becomes a negative-value conversion carrying a
 * distinct `refund_{orderId}` event id so its dispatch record never collides
 * with the original sale.
 *
 * Google Ads deduplicates imported conversions on order_id (+ gclid + value),
 * so `orderId` always carries the raw order id (never prefixed) while the
 * bookkeeping `eventId` carries the purchase_/refund_ prefix.
 *
 * `conversionAction` records which canonical conversion this payload represents;
 * the concrete Google Ads conversion action is config-resolved at dispatch time
 * (conversionId + label) — build() has no config access, mirroring how TikTok's
 * send() fills pixel_code from cfg. send() POSTs to the gtag conversion REST
 * endpoint (ported from google-ads.service.ts). The conversion id/label resolve
 * from BOTH the canonical `conversionId`/`conversionLabel` keys and the
 * SCREAMING_CASE env-style keys (`GOOGLE_ADS_CONVERSION_ID` and the legacy
 * `GA_ADS_CONVERSION_ID` used by google-ads.service.ts), so a deployed env
 * carrying only the legacy var still dispatches. The hashed user identifiers
 * built into `payload.userIdentifiers` are appended as `em`/`ph` URL query
 * params (SHA-256 as Google requires — encoded on the wire). Outcomes are
 * classified for the dispatch retry policy (4xx non-429 → not retryable;
 * 429/5xx/network/timeout → retryable).
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

    // Business event time (design §4.2) — snapshot.eventTime when captured;
    // fall back to dispatch time only when the snapshot carries none.
    const eventTime = snapshot.eventTime ?? Math.floor(Date.now() / 1000);

    return {
      eventName: eventType,
      eventId,
      eventTime,
      eventType,
      conversionAction: eventType,
      // Click identifiers are raw session identifiers — NEVER hashed (design §4.5).
      gclid: ctx.gclid,
      gbraid: (ctx as TrackingContextView & { gbraid?: string }).gbraid,
      conversionDateTime: formatConversionDateTime(eventTime),
      conversionValue,
      currencyCode: snapshot.currency,
      orderId: snapshot.orderId,
      userIdentifiers,
    };
  }

  async send(payload: ProviderPayload, cfg: ProviderConfig): Promise<DispatchResult> {
    // The conversion id/label resolve from BOTH the canonical camelCase keys and
    // the SCREAMING_CASE env-style keys — including the legacy GA_ADS_* vars the
    // retired google-ads.service.ts used — so a deployed env carrying only the
    // legacy var still dispatches instead of silently short-circuiting.
    const conversionId =
      cfg.conversionId || cfg.GOOGLE_ADS_CONVERSION_ID || cfg.GA_ADS_CONVERSION_ID;
    const conversionLabel =
      cfg.conversionLabel ||
      cfg.GOOGLE_ADS_CONVERSION_LABEL ||
      cfg.GA_ADS_CONVERSION_LABEL ||
      '';
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
    // Google's conversion endpoint takes hashed user data as em/ph query params
    // (SHA-256 values built into payload.userIdentifiers by build()).
    const userIdentifiers = Array.isArray(payload.userIdentifiers)
      ? (payload.userIdentifiers as Array<Record<string, unknown>>)
      : [];
    const hashedParams = userIdentifiers
      .flatMap((id) => {
        const params: string[] = [];
        if (typeof id.hashedEmail === 'string' && id.hashedEmail) {
          params.push(`em=${encodeURIComponent(id.hashedEmail)}`);
        }
        if (typeof id.hashedPhoneNumber === 'string' && id.hashedPhoneNumber) {
          params.push(`ph=${encodeURIComponent(id.hashedPhoneNumber)}`);
        }
        return params;
      })
      .join('&');
    const url =
      `${GOOGLE_ADS_CONVERSION_URL}${encodeURIComponent(conversionId)}/` +
      `?label=${encodeURIComponent(conversionLabel)}&value=${value}` +
      `&currency_code=${encodeURIComponent(currency)}` +
      (hashedParams ? `&${hashedParams}` : '');
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
