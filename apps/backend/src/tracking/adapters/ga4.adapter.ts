import { TrackingNormalizer } from '../tracking.normalizer';
import {
  TrackingContextView,
  TrackingSnapshotPayload,
} from '../tracking-snapshot.types';
import {
  AdapterSupportsOptions,
  DispatchResult,
  ProviderConfig,
  ProviderPayload,
  TrackingProviderAdapter,
} from './tracking-provider.adapter';

const GA4_MP_COLLECT_URL = 'https://www.google-analytics.com/mp/collect';
const REQUEST_TIMEOUT_MS = 1500;
const MAX_RAW_RESPONSE_CHARS = 500;

/**
 * Events the browser already fires via gtag in instant mode. GA4 Measurement
 * Protocol has no dedup key, so a server copy with the same client_id would
 * double-count — the GA4 adapter suppresses these in instant mode (design §4.6).
 */
const BROWSER_INSTANT_EVENTS: readonly string[] = [
  'Purchase',
  'ViewContent',
  'AddToCart',
  'InitiateCheckout',
  'AddPaymentInfo',
  'Search',
  'CompleteRegistration',
];

/** Canonical event type → GA4 Measurement Protocol event name. */
const EVENT_NAME_MAP: Record<string, string> = {
  Purchase: 'purchase',
  AddToCart: 'add_to_cart',
  InitiateCheckout: 'begin_checkout',
  ViewContent: 'view_item',
  Search: 'search',
  CompleteRegistration: 'sign_up',
  AddPaymentInfo: 'add_payment_info',
  Refund: 'refund',
};

/**
 * GA4 Measurement Protocol adapter (design §4.6). GA4 MP cannot dedup, so in
 * instant mode it must NOT double-fire events the browser already sends via
 * gtag: supports() returns false for BROWSER_INSTANT_EVENTS unless the
 * dispatcher passes `{ serverOnly: true }` (validated/offline events, driven by
 * the provider's `ga4Server` config flag). Events with no browser-fired
 * counterpart (Refund — server-authoritative only, and Lead) stay supported
 * even in instant mode, since a server copy cannot double-count them.
 *
 * build() is deliberately policy-agnostic: it maps any mappable snapshot type.
 * The dispatch policy lives in supports(); the dispatcher gates via supports()
 * first (with serverOnly for validated/offline events), so build() re-applying
 * the instant-mode suppression would drop validated Purchases. GA4 never
 * hashes PII — it takes `client_id` raw (design §4.5). send() POSTs to the
 * Measurement Protocol collect endpoint with measurement_id + api_secret as
 * query params.
 */
export class Ga4Adapter implements TrackingProviderAdapter {
  readonly provider = 'ga4';
  readonly version = 1;
  readonly providerApiVersion = 'mp/collect';

  supports(eventType: string, opts?: AdapterSupportsOptions): boolean {
    if (!EVENT_NAME_MAP[eventType]) return false;
    // Validated/offline events have no browser counterpart → full support.
    if (opts?.serverOnly) return true;
    // Instant mode: suppress events the browser already fires via gtag.
    return !BROWSER_INSTANT_EVENTS.includes(eventType);
  }

  build(
    snapshot: TrackingSnapshotPayload,
    ctx: TrackingContextView,
    _normalizer: TrackingNormalizer,
  ): ProviderPayload | null {
    const eventType =
      snapshot.eventType ?? (snapshot.value !== undefined ? 'Purchase' : undefined);
    const eventName = eventType ? EVENT_NAME_MAP[eventType] : undefined;
    if (!eventType || !eventName) return null;

    const eventId = this.resolveEventId(eventType, snapshot);
    if (!eventId) return null; // no dedup id → refuse to build

    const eventTime = Math.floor(Date.now() / 1000);
    const params = this.buildParams(snapshot, eventTime);

    return {
      eventName,
      eventId,
      eventTime,
      eventType,
      client_id: ctx.gaClientId || ctx.externalId,
      events: [{ name: eventName, params }],
    };
  }

  async send(payload: ProviderPayload, cfg: ProviderConfig): Promise<DispatchResult> {
    const { measurementId, apiSecret } = cfg;
    if (!measurementId || !apiSecret) {
      return {
        ok: false,
        retryable: false,
        httpStatus: 0,
        rawResponse: 'missing measurementId or apiSecret',
      };
    }

    const url =
      `${GA4_MP_COLLECT_URL}?measurement_id=${encodeURIComponent(measurementId)}` +
      `&api_secret=${encodeURIComponent(apiSecret)}`;
    const body = {
      client_id: payload.client_id,
      events: payload.events,
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

  private buildParams(
    snapshot: TrackingSnapshotPayload,
    eventTime: number,
  ): Record<string, unknown> {
    const params: Record<string, unknown> = {
      // GA4 Measurement Protocol expects event timestamps in microseconds.
      timestamp_micros: eventTime * 1000,
    };
    if (snapshot.value !== undefined) params.value = snapshot.value;
    if (snapshot.currency) params.currency = snapshot.currency;

    const items = this.buildItems(snapshot);
    if (items.length) {
      params.items = items;
      params.content_type = 'product';
    }
    if (snapshot.search_string) params.search_term = snapshot.search_string;
    if (snapshot.orderId) params.transaction_id = snapshot.orderId;
    return params;
  }

  /** GA4 item shape: item_id/quantity/price from contents, or item_id from content_ids. */
  private buildItems(snapshot: TrackingSnapshotPayload): Record<string, unknown>[] {
    if (snapshot.contents?.length) {
      return snapshot.contents.map((item) => ({
        item_id: item.id,
        quantity: item.quantity,
        ...(item.item_price !== undefined ? { price: item.item_price } : {}),
      }));
    }
    if (snapshot.content_ids?.length) {
      return snapshot.content_ids.map((id) => ({ item_id: id }));
    }
    return [];
  }

  /**
   * Informational dedup id for dispatch bookkeeping. GA4 MP itself has no dedup
   * key — the dispatcher's work-set rule prevents duplicate sends to GA4
   * (design §4.7), so this id is never sent to Google.
   */
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
