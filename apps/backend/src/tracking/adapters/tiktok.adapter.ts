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
import { toTikTokTimestamp, resolveEventTimeSeconds } from '../tracking-time';

const TIKTOK_TRACK_API_URL = 'https://business-api.tiktok.com/open_api';
const REQUEST_TIMEOUT_MS = 1500;
const MAX_RAW_RESPONSE_CHARS = 500;

/**
 * TikTok Business API error codes that reflect transient conditions worth a
 * retry (e.g. rate limits). All other non-zero `code` values are permanent
 * config or data errors (e.g. 10005 invalid token) and must not be retried.
 */
const TRANSIENT_ERROR_CODES = new Set([40011, 40012]);

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
 * HTTP 200 bodies carrying a non-zero business `code` (bad token, invalid
 * event) are failures, never SENT — not retryable unless the code is a known
 * transient rate limit.
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
    // Canonical fn/ln resolution: guest/offline orders store the FULL name in
    // firstName ("Md Rahim Uddin") — split so last_name hashing actually works.
    const { firstName, lastName } = normalizer.resolveNameFields(
      customer?.firstName,
      customer?.lastName,
    );
    const user: Record<string, unknown> = {
      email: customer?.email ? normalizer.hashEmail(customer.email) : undefined,
      phone_number: customer?.phone
        ? normalizer.hashPhone(customer.phone, customer.country)
        : undefined,
      external_id: ctx.externalId
        ? normalizer.hashExternalId(ctx.externalId)
        : undefined,
      first_name: firstName ? normalizer.hashName(firstName) : undefined,
      last_name: lastName ? normalizer.hashName(lastName) : undefined,
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

    // Business event time (design §4.2) — snapshot.eventTime when captured;
    // fall back to dispatch time only when the snapshot carries none.
    const eventTime = resolveEventTimeSeconds(snapshot.eventTime);

    return {
      eventName,
      eventId,
      eventTime,
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
    const { pixelCode, accessToken, testEventCode } = cfg;
    if (!pixelCode || !accessToken) {
      return {
        ok: false,
        retryable: false,
        httpStatus: 0,
        rawResponse: 'missing pixelCode or accessToken',
      };
    }

    // P0 FIX (2026-08-10): TikTok v1.3 pixel/track requires `timestamp` as an
    // ISO 8601 STRING — a JSON number is rejected with `40002 Invalid value for
    // timestamp: not a valid string.` (previously the whole Dispatch went FAILED
    // → outbox DEAD → DLQ: 8559 events). Serialize through the canonical helper.
    const body: Record<string, unknown> = {
      pixel_code: pixelCode,
      event: payload.eventName,
      event_id: payload.eventId,
      timestamp: toTikTokTimestamp(payload.eventTime),
      context: payload.context,
      properties: payload.properties,
      ...(testEventCode ? { test_event_code: testEventCode } : {}),
    };

    // Version comes from this.providerApiVersion so the URL can never drift
    // from the adapter's declared API version.
    const url = `${TIKTOK_TRACK_API_URL}/${this.providerApiVersion}/pixel/track/`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Access-Token': accessToken,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      // TikTok Business API returns HTTP 200 with a non-zero body `code` for
      // business errors (bad token, invalid event). Those must be classified as
      // failures, never SENT — so the JSON body is parsed to detect them. When
      // the body can't be parsed we fall back to HTTP-status classification
      // (4xx non-429 → not retryable; 429/5xx → retryable). Either way the
      // composed rawResponse is capped at MAX_RAW_RESPONSE_CHARS, matching the
      // other adapters.
      const parsedBody = (await response.json().catch(() => null)) as
        | { code?: unknown; message?: unknown }
        | null;
      const rawResponse = (
        parsedBody
          ? `code:${parsedBody.code ?? '?'}${
              parsedBody.message ? ` message:${parsedBody.message}` : ''
            }`
          : (await response.text().catch(() => ''))
      ).slice(0, MAX_RAW_RESPONSE_CHARS);

      if (response.ok && (!parsedBody || parsedBody.code === 0)) {
        return {
          ok: true,
          retryable: false,
          providerEventId: payload.eventId,
          httpStatus: response.status,
          rawResponse,
        };
      }

      // A non-zero business `code` is a failure. Most are permanent config or
      // data errors (e.g. 10005 invalid token) → not retryable; only known
      // transient codes (rate limits) warrant a retry.
      if (
        parsedBody &&
        typeof parsedBody.code === 'number' &&
        parsedBody.code !== 0
      ) {
        return {
          ok: false,
          retryable: TRANSIENT_ERROR_CODES.has(parsedBody.code),
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

  /**
   * Dedup id: use snapshot.eventId verbatim for ALL event types including
   * Purchase/Refund.  See Meta adapter resolveEventId() for rationale —
   * the capture layer stores `purchase_{uuid}` which must reach the
   * provider unchanged for cross-source (Pixel + CAPI) dedup.
   */
  private resolveEventId(
    _eventType: string,
    snapshot: TrackingSnapshotPayload,
  ): string | undefined {
    return snapshot.eventId;
  }
}
