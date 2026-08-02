import { TRACKING_EVENT_TYPES } from '../tracking.constants';
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

const META_GRAPH_BASE_URL = 'https://graph.facebook.com';
const REQUEST_TIMEOUT_MS = 1500;
const MAX_RAW_RESPONSE_CHARS = 500;

/** Meta's standard web events are exactly the canonical TRACKING_EVENT_TYPES. */
const SUPPORTED_EVENT_TYPES = TRACKING_EVENT_TYPES as readonly string[];

/**
 * Meta CAPI adapter (design §4.6). build() maps a canonical TrackingSnapshotPayload
 * onto the Meta `events` endpoint wire shape — hashing PII only through the injected
 * TrackingNormalizer, never inline. Refund is sent as a Meta `Purchase` with a
 * negated value and a distinct `refund_{orderId}` event_id. send() POSTs to
 * graph.facebook.com and classifies the outcome for the dispatch retry policy
 * (4xx non-429 → not retryable; 429/5xx/network/timeout → retryable).
 */
export class MetaAdapter implements TrackingProviderAdapter {
  readonly provider = 'meta';
  readonly version = 1;
  readonly providerApiVersion = 'v22.0';

  supports(eventType: string): boolean {
    return SUPPORTED_EVENT_TYPES.includes(eventType);
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

    // Meta has no Refund event (design §4.6): send a Purchase with a negated value
    // and a distinct event_id so refunds dedup separately from the original sale.
    const isRefund = eventType === 'Refund';
    const eventName = isRefund ? 'Purchase' : eventType;
    const eventId = this.resolveEventId(eventType, snapshot);
    if (!eventId) return null; // no dedup id → refuse to build
    const value =
      isRefund && snapshot.value !== undefined ? -snapshot.value : snapshot.value;

    const customer = snapshot.customer;
    const user_data = {
      em: customer?.email ? normalizer.hashEmail(customer.email) : undefined,
      ph: customer?.phone
        ? normalizer.hashPhone(customer.phone, customer.country)
        : undefined,
      fn: customer?.firstName ? normalizer.hashName(customer.firstName) : undefined,
      ln: customer?.lastName ? normalizer.hashName(customer.lastName) : undefined,
      ct: customer?.city ? normalizer.hashCity(customer.city) : undefined,
      cn: customer?.country ? normalizer.hashCountry(customer.country) : undefined,
      zp: customer?.zip ? normalizer.hashZip(customer.zip) : undefined,
      st: customer?.state ? normalizer.hashState(customer.state) : undefined,
      external_id: ctx.externalId
        ? normalizer.hashExternalId(ctx.externalId)
        : undefined,
      // Raw session identifiers are NEVER hashed (design §4.6).
      fbp: ctx.fbp,
      fbc: ctx.fbc,
      client_ip_address: ctx.ip,
      client_user_agent: ctx.userAgent,
    };

    const custom_data: Record<string, unknown> = {};
    if (value !== undefined) custom_data.value = value;
    if (snapshot.currency) custom_data.currency = snapshot.currency;
    if (snapshot.content_ids?.length) custom_data.content_ids = snapshot.content_ids;
    if (snapshot.contents?.length) custom_data.contents = snapshot.contents;
    if (snapshot.num_items !== undefined) custom_data.num_items = snapshot.num_items;
    if (snapshot.search_string) custom_data.search_string = snapshot.search_string;
    if (snapshot.orderId) custom_data.order_id = snapshot.orderId;

    // Business event time (design §4.2) — snapshot.eventTime when captured;
    // fall back to dispatch time only when the snapshot carries none.
    const eventTime = snapshot.eventTime ?? Math.floor(Date.now() / 1000);

    return {
      eventName,
      eventId,
      eventTime,
      eventType,
      action_source: 'website',
      event_source_url: ctx.url,
      user_data,
      custom_data,
    };
  }

  async send(payload: ProviderPayload, cfg: ProviderConfig): Promise<DispatchResult> {
    const { pixelId, accessToken, testEventCode } = cfg;
    if (!pixelId || !accessToken) {
      return {
        ok: false,
        retryable: false,
        httpStatus: 0,
        rawResponse: 'missing pixelId or accessToken',
      };
    }

    // Version comes from this.providerApiVersion so the URL can never drift
    // from the adapter's declared API version.
    const url =
      `${META_GRAPH_BASE_URL}/${this.providerApiVersion}/${pixelId}/events` +
      `?access_token=${encodeURIComponent(accessToken)}`;
    const body: Record<string, unknown> = {
      data: [
        {
          ...payload,
          event_name: payload.eventName,
          event_id: payload.eventId,
          event_time: payload.eventTime,
          action_source: payload.action_source,
          event_source_url: payload.event_source_url,
          user_data: payload.user_data,
          custom_data: payload.custom_data,
        },
      ],
      ...(testEventCode ? { test_event_code: testEventCode } : {}),
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
