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

const TIKTOK_TRACK_API_URL =
  'https://business-api.tiktok.com/open_api/v1.3/pixel/track/';
const REQUEST_TIMEOUT_MS = 1500;
const MAX_RAW_RESPONSE_CHARS = 500;

/** TikTok's standard web events are exactly the canonical TRACKING_EVENT_TYPES. */
const SUPPORTED_EVENT_TYPES = TRACKING_EVENT_TYPES as readonly string[];

/**
 * TikTok Events API adapter (design §4.6). build() maps a canonical
 * TrackingSnapshotPayload onto the TikTok `pixel/track/` wire shape — hashing
 * PII only through the injected TrackingNormalizer, never inline. Purchase and
 * Refund both map to TikTok's `CompletePayment` event; Refund carries a negated
 * value and a distinct `refund_{orderId}` event_id so dedup never absorbs it
 * (design §4.6 refund table). send() POSTs to business-api.tiktok.com with the
 * `Access-Token` header and classifies the outcome for the dispatch retry
 * policy (4xx non-429 → not retryable; 429/5xx/network/timeout → retryable).
 *
 * build() cannot know the pixel code or access token — they are config-resolved
 * at dispatch time (mirroring how Meta reads pixelId/accessToken from cfg) — so
 * build() produces the full event body except `pixel_code`, which send() fills
 * from cfg.pixelCode before POSTing.
 */
export class TikTokAdapter implements TrackingProviderAdapter {
  readonly provider = 'tiktok';
  readonly version = 1;
  readonly providerApiVersion = 'v1.3';

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

    // TikTok has no Refund event (design §4.6): send CompletePayment with a
    // negated value and a distinct event_id so refunds dedup separately.
    const isRefund = eventType === 'Refund';
    const eventName =
      eventType === 'Purchase' || isRefund ? 'CompletePayment' : eventType;
    const eventId = this.resolveEventId(eventType, snapshot);
    if (!eventId) return null; // no dedup id → refuse to build
    const value =
      isRefund && snapshot.value !== undefined ? -snapshot.value : snapshot.value;

    const customer = snapshot.customer;
    const user: Record<string, unknown> = {
      email: customer?.email ? normalizer.hashEmail(customer.email) : undefined,
      phone_number: customer?.phone
        ? normalizer.hashPhone(customer.phone, customer.country)
        : undefined,
      external_id: ctx.externalId
        ? normalizer.hashExternalId(ctx.externalId)
        : undefined,
      first_name: customer?.firstName
        ? normalizer.hashName(customer.firstName)
        : undefined,
      last_name: customer?.lastName
        ? normalizer.hashName(customer.lastName)
        : undefined,
      city: customer?.city ? normalizer.hashCity(customer.city) : undefined,
      state: customer?.state ? normalizer.hashState(customer.state) : undefined,
      zip: customer?.zip ? normalizer.hashZip(customer.zip) : undefined,
      country: customer?.country
        ? normalizer.hashCountry(customer.country)
        : undefined,
      // `address` is intentionally omitted: the canonical snapshot has no
      // address field and TrackingNormalizer has no address hasher — inventing
      // inline hashing here would violate the design §4.5 single-hashing rule.
    };

    const properties: Record<string, unknown> = {};
    if (value !== undefined) properties.value = value;
    if (snapshot.currency) properties.currency = snapshot.currency;
    if (snapshot.content_ids?.length) properties.content_ids = snapshot.content_ids;
    if (snapshot.contents?.length) properties.contents = snapshot.contents;
    if (snapshot.num_items !== undefined) properties.num_items = snapshot.num_items;
    if (snapshot.search_string) properties.search_string = snapshot.search_string;
    if (snapshot.orderId) properties.order_id = snapshot.orderId;

    return {
      eventName,
      eventId,
      eventTime: Math.floor(Date.now() / 1000),
      eventType,
      context: {
        ip: ctx.ip,
        user_agent: ctx.userAgent,
        page: {
          url: ctx.url || undefined,
          referrer: ctx.referrer || undefined,
        },
        user,
      },
      properties,
    };
  }

  async send(payload: ProviderPayload, cfg: ProviderConfig): Promise<DispatchResult> {
    const { pixelCode, accessToken } = cfg;
    if (!pixelCode || !accessToken) {
      return {
        ok: false,
        retryable: false,
        httpStatus: 0,
        rawResponse: 'missing pixelCode or accessToken',
      };
    }

    const body = {
      pixel_code: pixelCode,
      event: payload.eventName,
      event_id: payload.eventId,
      timestamp: payload.eventTime,
      context: payload.context,
      properties: payload.properties,
    };

    try {
      const response = await fetch(TIKTOK_TRACK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Access-Token': accessToken,
        },
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
