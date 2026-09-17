import { getOrCreateCtxId, getTrackingApiUrl } from './tracking-client';
import { resolveCatalogId } from './catalog-id';
import { sanitizeTrackingUrl } from './url-sanitize';

/**
 * Landing-page tracking bridge (AddToCart catalog fix). The landing AI SDK
 * (EcoMateSDK in CustomRenderer) exposes `window.EcoMate.track(event, data)`
 * for AI-generated landing code; it was previously a dead no-op. Route it to
 * the centralized tracking helpers so landing-page AddToCart reaches Browser
 * Pixel + CAPI mirror with the SAME event_id (spec: centralized reuse, no new
 * pipeline). The SDK payload is `{ productId, variantId?, quantity, price }`;
 * the products registry (`window.EcoMate.products`) provides the catalog id /
 * name / category. In template mode the call sites pass richer payloads too.
 */
function installLandingTrackingBridge() {
  if (typeof window === 'undefined') return;
  const eco = (window.EcoMate ||= {} as EcoMateTracking);
  eco.track = (event: string, data: Record<string, any> = {}) => {
    const registry: any[] = window.EcoMate?.products || [];
    if (event === 'AddToCart') {
      const product = data.productId
        ? registry.find((p) => p?.id === data.productId)
        : undefined;
      const variant = data.variantId
        ? product?.variants?.find((v: any) => v?.id === data.variantId)
        : undefined;
      const unitPrice = Number(data.price ?? variant?.price ?? product?.price ?? 0) || 0;
      const quantityAdded = Number(data.quantity ?? 1) || 1;
      trackAddToCart({
        contentId: resolveCatalogId(
          product || { id: String(data.productId) },
          variant || (data.variantId ? { id: String(data.variantId) } : undefined),
        ),
        contentName: data.name ?? product?.name,
        contentCategory: product?.category,
        unitPrice,
        quantityAdded,
        currency: data.currency ?? product?.currency ?? 'BDT',
        country: 'BD',
      });
    } else if (event === 'ViewContent' && data.productId) {
      const vProduct = registry.find((p) => p?.id === data.productId);
      const vVariant = data.variantId
        ? vProduct?.variants?.find((v: any) => v?.id === data.variantId)
        : undefined;
      trackViewContent({
        contentId: resolveCatalogId(
          vProduct || { id: String(data.productId) },
          vVariant || (data.variantId ? { id: String(data.variantId) } : undefined),
        ),
        contentName: data.name ?? vProduct?.name,
        contentCategory: vProduct?.category,
        value: Number(data.price ?? vVariant?.price ?? vProduct?.price) || undefined,
        currency: data.currency ?? vProduct?.currency ?? 'BDT',
        country: 'BD',
      });
    } else if (event === 'Lead') {
      trackEvent('Lead', {}, { phone: data.phone, country: 'BD' });
    }
  };
}

/**
 * Central AddToCart tracking helper (AddToCart implementation order).
 *
 * Responsibilities:
 *  - Computes quantity_added and value = price × quantity_added
 *  - Sends content_name, content_category, email, country when legitimately available
 *  - Generates a fresh event_id per genuine add action (repeated adds of the
 *    same product get distinct ids — spec §21/§22)
 *  - Caller is responsible for invoking AFTER successful cart mutation (spec §21)
 *
 * Event id design: `add_to_cart_{contentId}_{timestamp}_{counter}`. A timestamp
 * plus monotonic per-session counter makes every genuine add action unique —
 * even two adds of the same product within the same millisecond, and even
 * across a page refresh where the counter resets. Mirror retry reuses the id
 * because sendMirror stores it, so retries preserve the logical event identity.
 */
let _addToCartCounter = 0;

export function trackAddToCart(input: {
  contentId: string;
  contentName?: string;
  contentCategory?: string;
  unitPrice: number;
  quantityAdded: number;
  currency: string;
  email?: string;
  phone?: string;
  name?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}): { eventId: string } {
  const { contentId, contentName, contentCategory, unitPrice, quantityAdded, currency, email, phone, name, city, state, zip, country } = input;
  const value = Math.round(unitPrice * quantityAdded * 100) / 100;

  _addToCartCounter = (_addToCartCounter + 1) % 1_000_000;
  const eventId = `add_to_cart_${contentId}_${Date.now()}_${_addToCartCounter}`;

  trackEvent('AddToCart', {
    value,
    currency,
    content_type: 'product',
    content_ids: [contentId],
    content_name: contentName,
    content_category: contentCategory,
    contents: [{ id: contentId, quantity: quantityAdded, item_price: unitPrice }],
  }, {
    email: email,
    phone: phone,
    name: name,
    city: city,
    state: state,
    zip: zip,
    country: country,
  }, eventId);

  return { eventId };
}

/**
 * Central ViewContent helper (ViewContent enhancement order).
 *
 * Sends the full Meta-recommended ViewContent payload through the existing
 * trackEvent pipeline — Browser Pixel + CAPI mirror with the SAME event_id.
 *
 * event_id: NO explicit id is passed, so trackEvent derives the deterministic
 * journey-scoped id (`view_content_{contentKey}_{journeyHash}_{5sBucket}` in
 * deterministicEventId) where contentKey = content_ids[0] = the canonical
 * catalog id. Consequences:
 *  - same viewed catalog item within a 5s bucket → same event_id → React
 *    rerender / state updates cannot create duplicate events (server eventId
 *    UNIQUE + Meta dedup).
 *  - a genuinely different viewed product (A → B) changes contentKey → a new
 *    event_id → a new logical ViewContent. Variant changes inside one Product
 *    Detail Page must NOT call this helper again — one page view is one call.
 * Callers guard re-fire per product-page lifecycle (e.g. keyed on product.id).
 *
 * `value` is the viewed item's price (Meta ViewContent semantics: value of the
 * page view); NEVER a cart/order total. contents[].quantity is 1 (a view, not a
 * cart quantity).
 */
export function trackViewContent(input: {
  contentId?: string;
  /** Bundle (e.g. combo) contents — multiple catalog ids, one contents[] row each. */
  items?: { id: string; quantity?: number; item_price?: number }[];
  contentName?: string;
  contentCategory?: string;
  value?: number;
  currency: string;
  email?: string;
  phone?: string;
  name?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}): string | null {
  const { contentId, items, contentName, contentCategory, value, currency, email, phone, name, city, state, zip, country } = input;
  // content_ids is the deduped set of catalog ids being viewed. Single-content
  // views keep the flat {id, quantity:1, item_price:value} shape; bundles use
  // one contents[] row per real catalog item (no invented ids — all resolved
  // from the feed-consistent resolver).
  const contentIds = items ? [...new Set(items.map((i) => String(i.id)).filter(Boolean))] : contentId ? [contentId] : [];
  if (!contentIds.length) return null;
  const data: Record<string, unknown> = {
    value,
    currency,
  };
  if (items && items.length) {
    data.content_type = 'product_group';
    data.content_ids = contentIds;
    data.contents = items.map((i) => ({
      id: String(i.id),
      quantity: i.quantity ?? 1,
      item_price: i.item_price,
    }));
  } else {
    data.content_type = 'product';
    data.content_ids = contentIds;
    data.contents = [{ id: contentIds[0], quantity: 1, item_price: value }];
  }
  if (contentName) data.content_name = contentName;
  if (contentCategory) data.content_category = contentCategory;
  trackEvent('ViewContent', data, {
    email,
    phone,
    name,
    city,
    state,
    zip,
    country,
  });
  return `${eventNameToSnake('ViewContent')}_${contentIds.join('|')}_${hashShort(getOrCreateCtxId())}_${Math.floor(Date.now() / 5000)}`;
}

/**
 * Central Search tracking helper (Meta standard Search event).
 *
 * SEMANTIC: a Search event represents a COMMITTED search — the user finishing a
 * meaningful search action (Enter, search button, suggestion selection,
 * navigation to search results). It is NOT fired for typing/autocomplete input
 * changes or suggestion rendering.
 *
 * event_id: `search_{queryKey}_{journeyHash}_{5sBucket}` where queryKey is the
 * normalized lowercase query. Consequences:
 *  - duplicate accidental submission of the SAME query within a 5s bucket →
 *    identical event_id → server eventId UNIQUE + Meta dedup collapse it
 *    (Case B).
 *  - distinct queries → distinct keys → distinct logical events, even in the
 *    same bucket (Case C).
 *  - case-only differences of the same query share the key (payload keeps the
 *    original casing).
 *  - the same query re-committed after the 5s bucket rolls is a NEW logical
 *    search (genuine new intent).
 * Filter/sort/pagination changes are NOT searches and never call this helper.
 *
 * Payload: `search_string` is the normalized user query (trimmed, internal
 * whitespace collapsed, 200-char cap — no semantic reordering). `currency` is
 * sent when legitimately available. content_ids / contents / value are NOT
 * forced: Meta lists them as optional for Search (required only for
 * Advantage+ catalog ads), and EcoMate does not have result-level catalog
 * match data at commit time — forcing them would fabricate product semantics.
 * User data (email when logged in, country, fbp/fbc via the mirror) reuses the
 * existing pipeline; synthetic emails are filtered by trackEvent.
 *
 * Returns the event_id (or null when the query is empty/whitespace-only).
 */
export const SEARCH_QUERY_MAX_LENGTH = 200;

/** Trim + collapse internal whitespace. Preserves semantic content verbatim. */
export function normalizeSearchQuery(query: string): string {
  return (query || '').replace(/\s+/g, ' ').trim().slice(0, SEARCH_QUERY_MAX_LENGTH);
}

export function trackSearch(input: {
  query: string;
  currency?: string;
  email?: string;
  country?: string;
}): string | null {
  const { query, currency, email, country } = input;
  const q = normalizeSearchQuery(query);
  if (!q) return null;

  const queryKey = q.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const eventId = `search_${queryKey}_${hashShort(getOrCreateCtxId())}_${Math.floor(Date.now() / 5000)}`;

  const data: Record<string, unknown> = { search_string: q };
  if (currency) data.currency = currency;

  trackEvent('Search', data, { email, country }, eventId);
  return eventId;
}

declare global {
  interface Window {
    fbq?: any;
    ttq?: any;
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
    __flushTrackingQueue?: () => void;
    /** Wave-2.1 — data-driven Meta pixel init; reads the resolved external_id. */
    __initMetaPixel?: () => void;
    /** Set by TrackingScripts once pixel ids AND (for users) identity are known. */
    __TRACKING_INIT_READY?: boolean;
  }
}

type EventName = 'ViewContent' | 'AddToCart' | 'AddToWishlist' | 'InitiateCheckout'
  | 'AddPaymentInfo' | 'Purchase' | 'Search' | 'CompleteRegistration' | 'Lead';

function eventNameToSnake(name: string): string {
  return name.replace(/[A-Z]/g, c => '_' + c.toLowerCase()).replace(/^_/, '');
}

/** Small deterministic (djb2) hash → 8 hex chars, for stable journey-scoped ids. */
function hashShort(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0').slice(0, 8);
}

/**
 * Deterministic non-Purchase event_id (Wave-2.5, R-B fix).
 *
 * Non-Purchase events (ViewContent/AddToCart/InitiateCheckout/Search/...) used a
 * per-call random id, so a double-click / refresh / bfcache / multi-tab re-fire
 * produced a NEW event_id → a duplicate mirror snapshot + duplicate Pixel event
 * that capture-time dedup could not collapse.
 *
 * Instead derive `{event}_{contentKey}_{journeyHash}_{5sBucket}`: recomputed
 * identically across an accidental re-fire within the same 5-second bucket
 * (server `TrackingSnapshot.eventId UNIQUE` + Meta event_name+event_id then
 * dedup the copy), while a genuine repeat >5s later gets a fresh bucket id.
 * Scoped by a short journal hash so two different journeys never collide.
 *
 * Purchase keeps the caller-provided `purchase_{orderId}` (unchanged).
 */
function deterministicEventId(
  event: EventName,
  data?: Record<string, any>,
): string {
  const ctxId = getOrCreateCtxId();
  const snake = eventNameToSnake(event);
  let contentKey = '';
  const contentIds = data?.content_ids;
  if (Array.isArray(contentIds) && contentIds.length) {
    // ViewContent bundles (combo contents) scope by the FULL deduped id set:
    // two bundles sharing a first item are still distinct logical views. Other
    // events keep the first-content-id key (cart/order semantics unchanged).
    contentKey = event === 'ViewContent'
      ? [...new Set(contentIds.map(String))].join('|')
      : String(contentIds[0]);
  } else if (typeof data?.content_id === 'string') {
    contentKey = data.content_id;
  } else if (event === 'ViewContent' || event === 'Search') {
    contentKey = window.location.pathname;
  }
  const bucket = Math.floor(Date.now() / 5000);
  return `${snake}_${contentKey || 'n'}_${hashShort(ctxId)}_${bucket}`;
}

/**
 * Enabled Meta browser pixel ids (Step 3 — multi-pixel).
 *
 * One fbq install serves every pixel: each id is registered with `fbq('init')`,
 * and a single `fbq('track', …)` call then fans out to ALL initialized pixels with
 * the SAME `eventID`. That is deliberate and is what keeps one business event one
 * event: Meta's dedup namespace is (event_name + event_id) WITHIN one dataset, so
 * reusing the canonical id per pixel dedups each pixel's own browser+server pair,
 * while a per-pixel id would only break that dedup.
 *
 * The storefront receives pixel ids only — never an access token.
 */
let _metaIds: string[] = [];
let _tiktokCode = '';
let _metaPurchaseMode = 'instant';
let _tiktokPurchaseMode = 'instant';
let _eventQueue: { event: EventName; data?: Record<string, any>; eventId: string }[] = [];
/** Wave-2.1 — stable customer external_id (resolved from /tracking/identity). */
let _metaExternalId: string | null = null;
/** Wave-2.3 — hashed email/phone for Meta Advanced Matching init fields (em/ph). */
let _metaEm: string | undefined;
let _metaPh: string | undefined;
/** EMQ upgrade — hashed first/last name for the same init object (fn/ln). */
let _metaFn: string | undefined;
let _metaLn: string | undefined;
/**
 * Wave-3 — the shopper's Facebook user id (fb_login_id) for the CAPI mirror.
 * Server-resolved via /tracking/identity (requires a real Better Auth facebook
 * account) — NEVER fabricated for guests. Meta matches it verbatim (CAPI-only:
 * fb_login_id is NOT an Advanced Matching init field, so it is never added to
 * fbq('init') — the mirror carries it instead).
 */
let _metaFbLoginId: string | null = null;
/** True once fbq('init') has run — Meta events buffer until then (init-first ordering). */
let _metaInited = false;

// --- Wave-2.3 consent / opt-out gating ---

/** Whether the backend requires explicit tracking consent (config.consentRequired). */
let _consentRequired = false;
/** Whether the shopper has granted tracking consent (default granted when not required). */
let _consentGranted = true;
/** Hard opt-out from the ecomate_tracking_optout cookie; suppresses all tracking. */
let _optOut = typeof window !== 'undefined' && getCookie('ecomate_tracking_optout') !== '';

/** Set both the requirement flag and the current grant state (TrackingScripts, from /tracking/config). */
export function setConsent(required: boolean, granted: boolean) {
  _consentRequired = required;
  _consentGranted = granted;
  debug('Consent state set:', { required: _consentRequired, granted: _consentGranted });
}

/** Persist a consent decision to localStorage and flip the in-memory grant state (consent banner). */
export function setTrackingConsent(granted: boolean) {
  _consentGranted = granted;
  try {
    localStorage.setItem('ecomate_tracking_consent', granted ? 'granted' : 'revoked');
  } catch {
    // storage unavailable — state still flips in memory
  }
}

/** Master gate: opt-out always wins; consent grants only matter when consent is required. */
export function isTrackingAllowed(): boolean {
  return !_optOut && !(_consentRequired && !_consentGranted);
}

const debug = process.env.NODE_ENV !== 'production'
  ? (...args: unknown[]) => console.log('[TRACKING]', ...args)
  : () => {};

/**
 * Set the enabled browser destinations. `metaIds` is the (possibly empty) list of
 * enabled Meta pixel ids; a fresh call replaces the previous set — the queue is
 * only flushed once the new set is armed.
 */
export function setPixelIds(metaIds: string[] | string, tiktokCode: string) {
  _metaIds = (Array.isArray(metaIds) ? metaIds : [metaIds])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  _tiktokCode = tiktokCode;
  flushQueue();
}

export function setTrackingConfig(metaPurchaseMode: string, tiktokPurchaseMode: string) {
  _metaPurchaseMode = metaPurchaseMode;
  _tiktokPurchaseMode = tiktokPurchaseMode;
  debug('Tracking config set:', { metaPurchaseMode, tiktokPurchaseMode });
}

/**
 * Wave-2.1/2.3 — set the stable customer external_id plus hashed email/phone for
 * the Pixel. Meta supports external_id/em/ph only as fbq('init') Advanced-Matching
 * parameters (no reliable post-init setter), so the values are applied by
 * initMetaPixel() at init time. If the init already fired, values are kept for the
 * NEXT page load (Meta's init-time limitation) — no re-init / double init.
 * For an authenticated shopper, TrackingScripts waits for these before signaling
 * init readiness. Guests resolve to null (parameterless init).
 */
export function setPixelIdentity(externalId?: string | null, em?: string, ph?: string, fbLoginId?: string | null, fn?: string, ln?: string) {
  _metaExternalId = externalId || null;
  _metaEm = em || undefined;
  _metaPh = ph || undefined;
  _metaFbLoginId = fbLoginId || null;
  _metaFn = fn || undefined;
  _metaLn = ln || undefined;
}

/**
 * Data-driven Meta pixel init (idempotent). Must run BEFORE any Meta event is
 * sent (the fbq stub processes queued calls in order). Until it runs, Meta
 * events are held in `_eventQueue` — guaranteeing init-first ordering and that
 * the external_id is present at init for authenticated users.
 *
 * Step 3 — every enabled pixel is initialized first, then ONE PageView is fired.
 * The single PageView call is intentional: fbq fans a `track` call out to every
 * initialized pixel, so looping would multiply PageView per pixel instead of
 * producing the intended per-pixel fan-out of one logical page view.
 */
export function initMetaPixel() {
  if (typeof window === 'undefined') return;
  if (!isTrackingAllowed()) return;
  if (_metaInited || _metaIds.length === 0) return;
  const fbq = window.fbq;
  if (!fbq) return; // inline tag not defined yet — the inline script re-calls on readiness
  const advancedMatching: Record<string, string> = {};
  if (_metaExternalId) advancedMatching.external_id = _metaExternalId;
  if (_metaEm) advancedMatching.em = _metaEm;
  if (_metaPh) advancedMatching.ph = _metaPh;
  if (_metaFn) advancedMatching.fn = _metaFn;
  if (_metaLn) advancedMatching.ln = _metaLn;
  const am = Object.keys(advancedMatching).length ? advancedMatching : undefined;
  // Initialize every pixel BEFORE any event fires. All pixels receive the same
  // Advanced Matching object: identity is per shopper, not per destination, so a
  // pixel can never be handed another destination's identity.
  for (const id of _metaIds) {
    fbq('init', id, am);
  }
  // Initial PageView shares one logical event between browser + CAPI: the same
  // event_id fans out to every pixel AND rides the server mirror, so Meta
  // dedups the pair per dataset (redundant setup, Meta-recommended).
  firePageView();
  _metaInited = true;
  flushQueue();
}

/**
 * One logical PageView across browser + server. A fresh id per fire keeps the
 * 1:1 browser:server pairing the CAPI dedup requires (never reuse an id across
 * two different page views). The TikTok pixel call carries no event id —
 * TikTok has no PageView server event, so there is nothing to dedup there.
 */
function firePageView() {
  const eventId = `page_view_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  if (window.fbq && _metaIds.length) {
    window.fbq('track', 'PageView', {}, { eventID: eventId });
  }
  // Mirror only when a Meta pixel exists: TikTok/GA4 have no PageView server
  // event, so a mirror without Meta configured would only write rows that
  // every adapter SKIPs.
  if (_metaIds.length) {
    sendMirror(eventId, {
      ctxId: getOrCreateCtxId(),
      eventId,
      eventName: 'page_view',
      customData: {},
      // No destination/pixel identity: fan-out is decided server-side.
      userData: {},
    });
  }
  // Arm the route-change de-dupe so a later mount-time trackPageView() for the
  // same URL cannot double-count this landing view with a fresh (undedupable) id.
  if (typeof window !== 'undefined') _lastPageViewUrl = window.location.href;
  return eventId;
}

/** Last URL for which a client-side PageView already fired (SPA route-change de-dupe). */
let _lastPageViewUrl = '';

/**
 * Wave-2.3 — fire a browser-side PageView for subsequent in-SPA route changes
 * (the initial load's PageView is handled by initMetaPixel / the inline tag).
 * De-dupes repeated calls for the same URL; no-op until tracking is allowed.
 */
export function trackPageView() {
  if (typeof window === 'undefined') return;
  if (!isTrackingAllowed()) return;
  const url = window.location.href;
  if (url === _lastPageViewUrl) {
    debug('trackPageView — de-dupe, same URL:', url);
    return;
  }
  const meta = !!(window.fbq && _metaIds.length && _metaInited);
  const tiktok = !!(window.ttq && _tiktokCode);
  const ga4 = !!window.gtag;
  if (!meta && !tiktok && !ga4) return; // nothing armed yet — don't mark as visited
  if (meta) firePageView();
  if (tiktok && typeof window.ttq.page === 'function') window.ttq.page();
  if (ga4 && window.gtag) window.gtag('event', 'page_view', {
    // Privacy P0: same sanitization policy — sensitive query params never
    // reach provider boundaries (GA4 included).
    page_location: sanitizeTrackingUrl(url) ?? url,
    page_title: typeof document !== 'undefined' ? document.title : '',
  });
  _lastPageViewUrl = url;
}

/**
 * Translate the shared (Meta-shaped) event data into TikTok's expected shape.
 * TikTok web events address products via `content_id` (single) or `contents`
 * (multiple rows of {content_id, quantity, price, ...}) — the `content_ids`
 * array and Meta-shaped rows ({id, item_price}) are silently ignored by
 * TikTok, so events sent without translation report "Content ID missing".
 * `content_type`/`value`/`currency` share names and pass through untouched.
 */
export function toTikTokData(data?: Record<string, any>): Record<string, any> | undefined {
  if (!data) return data;
  const out: Record<string, any> = { ...data };
  const ids = Array.isArray(data.content_ids)
    ? data.content_ids.map((id) => String(id)).filter(Boolean)
    : [];
  delete out.content_ids;
  if (Array.isArray(data.contents) && data.contents.length) {
    const contents = data.contents
      .filter(
        (c: any) =>
          c &&
          typeof (c.content_id ?? c.id) !== 'undefined' &&
          String(c.content_id ?? c.id).length > 0 &&
          (typeof c.quantity !== 'number' || c.quantity > 0),
      )
      .map((c: any) => ({
        content_id: String(c.content_id ?? c.id),
        quantity: c.quantity ?? 1,
        ...(c.price ?? c.item_price !== undefined ? { price: c.price ?? c.item_price } : {}),
        ...(c.content_name ?? data.content_name ? { content_name: c.content_name ?? data.content_name } : {}),
        ...(c.content_category ?? data.content_category ? { content_category: c.content_category ?? data.content_category } : {}),
      }));
    if (contents.length) out.contents = contents;
    else delete out.contents;
  } else if (ids.length === 1) {
    out.content_id = ids[0];
  } else if (ids.length > 1) {
    out.contents = ids.map((content_id) => ({ content_id, quantity: 1 }));
  }
  return out;
}

export function flushQueue() {
  if (typeof window === 'undefined') return;

  const fbq = window.fbq;
  const ttq = window.ttq;

  debug('flushQueue called. Status:', { metaIds: _metaIds, _tiktokCode, hasFbq: !!fbq, hasTtq: !!ttq, metaInited: _metaInited, queueLength: _eventQueue.length });

  if (!_metaIds.length && !_tiktokCode) return;
  // Hold the whole queue until EVERY enabled provider is ready to fire. The old
  // guard used `&&` between the provider conditions, so a SINGLE-provider setup
  // (the common case) never returned here and drained/cleared the queue while
  // its script was still loading — dropping browser events (B4 fix).
  if ((_metaIds.length && (!fbq || !_metaInited)) || (_tiktokCode && !ttq)) return;

  if (_eventQueue.length > 0) {
    _eventQueue.forEach(({ event, data, eventId }) => {
      // Same per-provider Purchase isolation as the live path: a queued
      // Purchase flushes only to instant-mode providers' pixels. Provider-level
      // mode means every initialized Meta pixel shares this one gate — Step 3
      // keeps it that way deliberately; a per-destination mode would need this to
      // become a per-pixel check.
      const flushMeta = event !== 'Purchase' || _metaPurchaseMode === 'instant';
      const flushTiktok = event !== 'Purchase' || _tiktokPurchaseMode === 'instant';
      if (fbq && _metaIds.length && _metaInited && flushMeta) {
        debug('Flushing queued Meta event:', event, data);
        fbq('track', event, data, { eventID: eventId });
      }
      if (ttq && _tiktokCode && flushTiktok) {
        const tiktokEvent = event === 'Purchase' ? 'CompletePayment' : event;
        debug('Flushing queued TikTok event:', tiktokEvent, data);
        ttq.track(tiktokEvent, toTikTokData(data), { event_id: eventId });
      }
    });
    _eventQueue = [];
  }
}

if (typeof window !== 'undefined') {
  window.__flushTrackingQueue = flushQueue;
  window.__initMetaPixel = initMetaPixel;
  installLandingTrackingBridge();
}

// --- Wave-2.5 mirror reliability (B2 + W25-3) ---

const MIRROR_QUEUE_KEY = 'ecomate_tracking_pending';
const MIRROR_QUEUE_MAX = 20;
const MIRROR_QUEUE_TTL_MS = 30 * 60 * 1000;

/** Read the bounded pending-mirror queue (sessionStorage). */
function readMirrorQueue(): Array<{ eventId: string; body: unknown; at: number }> {
  try {
    const raw = sessionStorage.getItem(MIRROR_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{ eventId: string; body: unknown; at: number }>;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeMirrorQueue(entries: Array<{ eventId: string; body: unknown; at: number }>) {
  try {
    sessionStorage.setItem(
      MIRROR_QUEUE_KEY,
      JSON.stringify(entries.slice(-MIRROR_QUEUE_MAX)),
    );
  } catch {
    // storage full / unavailable — best-effort
  }
}

/**
 * Auth headers for tracking fetches. The shopper session (Better Auth cookie
 * and/or legacy JWT) lets the public mirror route resolve the authenticated
 * customer server-side for identity enrichment — the client NEVER selects a
 * profile (no customer id is sent or trusted). Same-origin requests already
 * carry cookies; `credentials: 'include'` additionally covers cross-origin
 * dev/staging, and the Bearer token covers cookie-less contexts. Absent when
 * logged out (anonymous tracking unchanged).
 */
export function trackingAuthHeaders(): Record<string, string> {
  try {
    const token =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem('token')
        : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/**
 * Reliable mirror send (B2): sendBeacon works during unload; fetch keepalive is
 * the fallback. On failure the event is enqueued (W25-3) and retried on a later
 * load with the SAME eventId — the server's `eventId UNIQUE` dedup makes the
 * retry idempotent, so it is never lost and never duplicated.
 */
function sendMirror(eventId: string, body: unknown) {
  const url = `${getTrackingApiUrl()}/tracking/events`;
  const text = JSON.stringify(body);
  // sendBeacon carries no headers, so an authenticated shopper's session
  // would be invisible to the server (enrichment + customer binding silently
  // lost on exactly the events that need them). Logged-in events therefore go
  // straight to the credentialed fetch below; anonymous events keep beacon.
  const authed = Object.keys(trackingAuthHeaders()).length > 0;
  if (!authed) {
    try {
      const blob = new Blob([text], { type: 'application/json' });
      if (navigator.sendBeacon && navigator.sendBeacon(url, blob)) {
        return;
      }
    } catch {
      // sendBeacon unavailable or threw — fall through to fetch
    }
  }
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...trackingAuthHeaders() },
    body: text,
    keepalive: true,
    credentials: 'include',
  }).catch(() => {
    const queue = readMirrorQueue();
    if (!queue.some((e) => e.eventId === eventId)) {
      writeMirrorQueue([...queue, { eventId, body, at: Date.now() }]);
    }
  });
}

/** Retry mirror events persisted by an earlier failed/unloaded page. */
function flushPendingMirrors() {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return;
  const queue = readMirrorQueue();
  if (!queue.length) return;
  const now = Date.now();
  const fresh = queue.filter((e) => now - e.at < MIRROR_QUEUE_TTL_MS);
  writeMirrorQueue([]);
  for (const entry of fresh) {
    sendMirror(entry.eventId, entry.body);
  }
}

/**
 * First-party `_fbp`/`_fbc` seeding (P1 fix): the Meta pixel creates these
 * cookies itself — but only AFTER fbevents.js loads (lazyOnload), so early
 * events (ViewContent from a product page, AddToCart) would otherwise reach the
 * mirror without them, and the context row without fbp/fbc. Create them here in
 * Meta's exact documented formats when absent, gated by isTrackingAllowed():
 *  - _fbp = fb.1.<unix ms>.<11-digit random>
 *  - _fbc = fb.1.<first-observed unix ms>.<fbclid> (from the URL param;
 *    passed as-is when the param is already in fb.… format)
 * An existing _fbc is NEVER reconstructed or re-timestamped — the cookie is
 * only written when absent, so its creationTime stays the first observation
 * (Meta rejects second-based or rewritten creationTime values). The cookie is
 * read at send time and included in the mirror userData + context identifiers.
 */
function ensureMetaCookies() {
  if (typeof document === 'undefined') return;
  if (!isTrackingAllowed()) return;
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  const fbpAttrs = `path=/; max-age=${400 * 86400}; SameSite=Lax${secure}`;
  const fbcAttrs = `path=/; max-age=${90 * 86400}; SameSite=Lax${secure}`;
  if (!getCookie('_fbp')) {
    const rand = String(Math.floor(Math.random() * 9e10) + 1e10);
    document.cookie = `_fbp=fb.1.${Date.now()}.${rand}; ${fbpAttrs}`;
  }
  if (!getCookie('_fbc') && typeof location !== 'undefined') {
    const fbclid = new URLSearchParams(location.search).get('fbclid');
    if (fbclid) {
      const value = fbclid.startsWith('fb.')
        ? fbclid
        : `fb.1.${Date.now()}.${fbclid}`;
      document.cookie = `_fbc=${encodeURIComponent(value)}; ${fbcAttrs}`;
    }
  }
}

if (typeof window !== 'undefined') {
  flushPendingMirrors();
  // Flush the pending-mirror queue when connectivity returns (offline retry).
  window.addEventListener('online', () => flushPendingMirrors());
}

export function getCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || '';
  return '';
}

export function isSyntheticEmail(email?: string): boolean {
  if (!email) return true;
  const localPart = email.split('@')[0]?.toLowerCase() || '';
  return localPart.startsWith('cust_') || /^\d+$/.test(localPart);
}

export function trackEvent(event: EventName, data?: Record<string, any>, userData?: { email?: string; phone?: string; name?: string; city?: string; country?: string; zip?: string; state?: string; address?: string }, eventId?: string) {
  debug('trackEvent called:', { event, data, userData, eventId });
  if (typeof window === 'undefined') return;
  // Wave-2.3 — hard gate: no pixel send and no mirror POST when consent/opt-out blocks tracking.
  if (!isTrackingAllowed()) {
    debug('trackEvent suppressed — tracking not allowed:', event);
    return;
  }

  if (isSyntheticEmail(userData?.email)) {
    debug('Filtering synthetic email from tracking:', userData?.email);
    userData = { ...userData, email: '' };
  }

  if (event === 'Purchase') {
    const shouldFireMeta = _metaPurchaseMode === 'instant';
    const shouldFireTiktok = _tiktokPurchaseMode === 'instant';
    if (!shouldFireMeta && !shouldFireTiktok) {
      debug('Skipping Purchase event — mode is validated:', { meta: _metaPurchaseMode, tiktok: _tiktokPurchaseMode });
      return;
    }
  }

  // Per-provider Purchase isolation: a validated-mode provider must never fire
  // its browser Pixel just because another provider is instant. The server
  // dispatcher already gates CAPI per-provider (triggerMode vs purchaseModes);
  // the browser Pixel needs the same gate or Meta would record an unvalidated
  // order at checkout time via facebook.com/tr (same event_id dedups with the
  // later CAPI send, but the event would exist before validation).
  //
  // Step 3 — DELIBERATELY PROVIDER-LEVEL, covering every initialized Meta pixel:
  // all of a provider's destinations fire together or none do, which mirrors the
  // provider-level `tracking_meta_purchase_mode` the server enforces. If a future
  // version introduces a per-destination mode (Pixel A = instant, Pixel B =
  // validated), this single boolean is the one place that must become a per-pixel
  // check — the queue path in flushQueue() above must change in lockstep.
  const fireMetaPixel = event !== 'Purchase' || _metaPurchaseMode === 'instant';
  const fireTiktokPixel = event !== 'Purchase' || _tiktokPurchaseMode === 'instant';

  // Caller-provided dedup key (e.g. purchase_{orderId}) matches the server-side
  // capture so Meta dedups Pixel + CAPI. Otherwise derive a deterministic,
  // journey-scoped id (Wave-2.5 R-B fix) so accidental re-fires dedup instead of
  // creating duplicates.
  const resolvedEventId = eventId ?? deterministicEventId(event, data);
  const fbq = window.fbq;
  const ttq = window.ttq;

  debug('Pixel IDs and script status:', { metaIds: _metaIds, _tiktokCode, hasFbq: !!fbq, hasTtq: !!ttq });

  if (!_metaIds.length && !_tiktokCode) {
    debug('Queuing event (no IDs yet):', event);
    _eventQueue.push({ event, data, eventId: resolvedEventId });
  } else if ((_metaIds.length && (!fbq || !_metaInited)) || (_tiktokCode && !ttq)) {
    // Meta events buffer until fbq('init') runs (_metaInited) so the external_id
    // is present at init and init-first ordering is guaranteed (Wave-2.1).
    debug('Queuing event (scripts not fully loaded yet):', event);
    _eventQueue.push({ event, data, eventId: resolvedEventId });
  } else {
    if (fbq && _metaIds.length && _metaInited && fireMetaPixel) {
      debug('Firing Meta Pixel event:', event, data, { eventID: resolvedEventId, pixels: _metaIds.length });
      // ONE call fans out to every initialized pixel with the SAME canonical
      // eventID (Step 3). Do not loop per pixel: the id must stay identical so
      // each pixel dedups its own browser event against its CAPI event.
      fbq('track', event, data, { eventID: resolvedEventId });
    }
    if (ttq && _tiktokCode && fireTiktokPixel) {
      const tiktokEvent = event === 'Purchase' ? 'CompletePayment' : event;
      debug('Firing TikTok Pixel event:', tiktokEvent, data, { event_id: resolvedEventId });
      ttq.track(tiktokEvent, toTikTokData(data), { event_id: resolvedEventId });
    }
    if (window.gtag) {
      const ga4Event = event === 'Purchase' ? 'purchase'
        : event === 'ViewContent' ? 'view_item'
        : event === 'AddToCart' ? 'add_to_cart'
        : event === 'InitiateCheckout' ? 'begin_checkout'
        : event === 'Search' ? 'search'
        : event === 'CompleteRegistration' ? 'sign_up'
        : event === 'AddToWishlist' ? 'add_to_wishlist'
        : undefined;
      if (ga4Event && data) {
        window.gtag('event', ga4Event, data);
      }
    }
  }

  // First-party _fbp/_fbc seeding (P1 fix) BEFORE the mirror reads cookies —
  // guarantees fbp/fbc exist for early events that race the Meta pixel load.
  ensureMetaCookies();

  const fbp = getCookie('_fbp');
  const fbc = getCookie('_fbc');
  // Privacy P0: strip sensitive query params (view tokens, keys) before the
  // URL leaves the browser — same policy as syncContext/backend sanitizer.
  const url = sanitizeTrackingUrl(
    typeof window !== 'undefined' ? window.location.href : undefined,
  );
  const referrer = sanitizeTrackingUrl(
    typeof document !== 'undefined' ? document.referrer : undefined,
  );

  if (_metaIds.length || _tiktokCode) {
    sendMirror(resolvedEventId, {
      ctxId: getOrCreateCtxId(),
      eventId: resolvedEventId,
      eventName: eventNameToSnake(event),
      customData: data,
      // NOTE: no destination/pixel identity is sent. Fan-out to individual
      // destinations is decided entirely server-side from the capture-time
      // destination refs, so the browser cannot pair Pixel A with CAPI B.
      userData: {
        ...userData,
        fbp,
        fbc,
        url,
        referrer,
        // Wave-3 — only when the session actually resolved a Facebook account;
        // guests and non-FB logins send nothing (never fabricated).
        ...(_metaFbLoginId ? { fbLoginId: _metaFbLoginId } : {}),
      },
    });
  } else {
    debug('Skipping server-side CAPI call - no tracking enabled');
  }
}
