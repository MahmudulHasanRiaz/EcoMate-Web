import { TRACKING_EVENT_TYPES } from '../tracking.constants';
import { TrackingNormalizer } from '../tracking.normalizer';
import { resolveEventTimeSeconds } from '../tracking-time';
import { sanitizeProviderText } from '../sanitize';
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
    // Canonical fn/ln resolution: guest/offline orders store the FULL name in
    // firstName ("Md Rahim Uddin") — split so last-name hashing actually works.
    const { firstName, lastName } = normalizer.resolveNameFields(
      customer?.firstName,
      customer?.lastName,
    );
    const user_data = {
      em: customer?.email ? normalizer.hashEmail(customer.email) : undefined,
      ph: customer?.phone
        ? normalizer.hashPhone(customer.phone, customer.country)
        : undefined,
      fn: firstName ? normalizer.hashName(firstName) : undefined,
      ln: lastName ? normalizer.hashName(lastName) : undefined,
      ct: customer?.city ? normalizer.hashCity(customer.city) : undefined,
      cn: customer?.country ? normalizer.hashCountry(customer.country) : undefined,
      zp: customer?.zip ? normalizer.hashZip(customer.zip) : undefined,
      st: customer?.state ? normalizer.hashState(customer.state) : undefined,
      external_id: ctx.externalId
        ? normalizer.hashExternalId(ctx.externalId)
        : undefined,
      // Wave-3 (Meta EMQ recommendation): fb_login_id is matched VERBATIM —
      // NEVER hashed (the only customer-information parameter Meta declares
      // "Do not hash"). Server-resolved for order events, mirror-carried for
      // browser events; absent for guests.
      fb_login_id: customer?.fbLoginId || undefined,
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
    if (snapshot.content_type) custom_data.content_type = snapshot.content_type;
    if (snapshot.content_name) custom_data.content_name = snapshot.content_name;
    if (snapshot.content_category) custom_data.content_category = snapshot.content_category;
    // 2804008 guard: contents must be a valid JSON array of objects with
    // non-empty id, positive quantity, and numeric item_price. Filter out
    // malformed items to prevent Meta rejecting the entire event.
    if (snapshot.contents?.length) {
      const validContents = snapshot.contents.filter(
        (item) =>
          item &&
          typeof item.id === 'string' &&
          item.id.length > 0 &&
          typeof item.quantity === 'number' &&
          item.quantity > 0 &&
          (item.item_price === undefined || typeof item.item_price === 'number'),
      );
      if (validContents.length) custom_data.contents = validContents;
    }
    if (snapshot.num_items !== undefined) custom_data.num_items = snapshot.num_items;
    if (snapshot.search_string) custom_data.search_string = snapshot.search_string;
    if (snapshot.orderId) custom_data.order_id = snapshot.orderId;

    // Business event time (design §4.2) — snapshot.eventTime when captured;
    // fall back to dispatch time only when the snapshot carries none.
    const eventTime = resolveEventTimeSeconds(snapshot.eventTime);

    // EMQ DIAGNOSTICS ONLY (Wave-1, Decision C): Meta ACCEPTS an event with no
    // em/ph (lower match quality) as long as it carries other identity keys, and
    // an event with no identity at all is likewise still delivered. Wave-1 only
    // EMITS quality flags and surfaces them in the monitoring timeline — it NEVER
    // suppresses dispatch (no null, no SKIPPED). Skip/refuse policy belongs to the
    // Wave-2 identity wave, after a stable external_id architecture exists.
    const hasContact = Boolean(user_data.em || user_data.ph);
    // Wave-3: fb_login_id is itself a valid customer identity key (Meta accepts
    // an event carrying it regardless of em/ph — the 2804050 reject only applies
    // when user_data has NO identity parameter at all).
    // NOTE: client_ip_address and client_user_agent are NOT customer information
    // parameters for Meta's 2804050 check — they improve match quality but do
    // NOT satisfy the "sufficient customer information" requirement. Only the
    // keys below count as identity for the 2804050 guard.
    const hasOtherIdentity = Boolean(
      user_data.fb_login_id ||
        user_data.external_id ||
        user_data.fbp ||
        user_data.fbc,
    );

    // 2804050 guard (P1 fix, 2026-08-10; strengthened 2026-08-20): Meta REJECTS
    // an event whose user_data has NO customer information parameter —
    // `code 100 / subcode 2804050` ("no customer information parameters").
    // client_ip_address/client_user_agent alone do NOT satisfy this check.
    // Never ship a guaranteed-reject payload: surface a skipReason instead.
    const hasAnyIdentity =
      hasContact ||
      hasOtherIdentity ||
      Boolean(
        user_data.fn ||
          user_data.ln ||
          user_data.ct ||
          user_data.st ||
          user_data.zp ||
          user_data.cn,
      );
    if (!hasAnyIdentity) {
      return {
        eventName,
        eventId,
        eventTime,
        eventType,
        action_source: snapshot.actionSource || 'website',
        event_source_url: ctx.url,
        user_data,
        custom_data,
        qualityFlags: ['NO_EM_PH', 'NO_IDENTITY'],
        skipReason:
          'no identity for Meta user_data (no em/ph/external_id/fbp/fbc/ip/ua — rejected by Meta with 2804050)',
      };
    }

    const qualityFlags: string[] | undefined = hasContact
      ? undefined
      : hasOtherIdentity
        ? ['NO_EM_PH']
        : ['NO_EM_PH', 'NO_IDENTITY'];

    return {
      eventName,
      eventId,
      eventTime,
      eventType,
      action_source: snapshot.actionSource || 'website',
      event_source_url: ctx.url,
      user_data,
      custom_data,
      ...(qualityFlags ? { qualityFlags } : {}),
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
      const rawResponse = sanitizeProviderText(await response.text()).slice(
        0,
        MAX_RAW_RESPONSE_CHARS,
      );

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

  /**
   * Dedup id: use snapshot.eventId verbatim for ALL event types including
   * Purchase/Refund.  The capture layer stores `purchase_{uuid}` which
   * matches the browser Pixel's `purchase_{uuid}` — this is the only way
   * Meta can dedup Pixel + CAPI for the same logical event (Meta dedup key
   * = event_name + event_id).  The previous `purchase_{orderId}` (displayId)
   * produced a DIFFERENT event_id from the browser, causing every website
   * Purchase to appear as TWO separate events in Meta Events Manager.
   */
  private resolveEventId(
    _eventType: string,
    snapshot: TrackingSnapshotPayload,
  ): string | undefined {
    return snapshot.eventId;
  }
}
