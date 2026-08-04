import { getOrCreateCtxId, getTrackingApiUrl } from './tracking-client';

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
  | 'AddPaymentInfo' | 'Purchase' | 'Search' | 'CompleteRegistration';

function eventNameToSnake(name: string): string {
  return name.replace(/[A-Z]/g, c => '_' + c.toLowerCase()).replace(/^_/, '');
}

function generateEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

let _metaId = '';
let _tiktokCode = '';
let _metaPurchaseMode = 'instant';
let _tiktokPurchaseMode = 'instant';
let _eventQueue: { event: EventName; data?: Record<string, any>; eventId: string }[] = [];
/** Wave-2.1 — stable customer external_id (resolved from /tracking/identity). */
let _metaExternalId: string | null = null;
/** True once fbq('init') has run — Meta events buffer until then (init-first ordering). */
let _metaInited = false;

const debug = process.env.NODE_ENV !== 'production'
  ? (...args: unknown[]) => console.log('[TRACKING]', ...args)
  : () => {};

export function setPixelIds(metaId: string, tiktokCode: string) {
  _metaId = metaId;
  _tiktokCode = tiktokCode;
  flushQueue();
}

export function setTrackingConfig(metaPurchaseMode: string, tiktokPurchaseMode: string) {
  _metaPurchaseMode = metaPurchaseMode;
  _tiktokPurchaseMode = tiktokPurchaseMode;
  debug('Tracking config set:', { metaPurchaseMode, tiktokPurchaseMode });
}

/**
 * Wave-2.1 — set the stable customer external_id for the Pixel. Meta supports
 * external_id only as an fbq('init') Advanced-Matching parameter (no reliable
 * post-init setter), so the value is applied by initMetaPixel() at init time.
 * For an authenticated shopper, TrackingScripts waits for this value before
 * signaling init readiness — the init never runs without it, so there is no
 * dependency on a future page load. Guests resolve to null (parameterless init).
 */
export function setPixelIdentity(externalId?: string | null) {
  _metaExternalId = externalId || null;
}

/**
 * Data-driven Meta pixel init (idempotent). Must run BEFORE any Meta event is
 * sent (the fbq stub processes queued calls in order). Until it runs, Meta
 * events are held in `_eventQueue` — guaranteeing init-first ordering and that
 * the external_id is present at init for authenticated users.
 */
export function initMetaPixel() {
  if (typeof window === 'undefined') return;
  if (_metaInited || !_metaId) return;
  const fbq = window.fbq;
  if (!fbq) return; // inline tag not defined yet — the inline script re-calls on readiness
  fbq('init', _metaId, _metaExternalId ? { external_id: _metaExternalId } : undefined);
  fbq('track', 'PageView');
  _metaInited = true;
  flushQueue();
}

export function flushQueue() {
  if (typeof window === 'undefined') return;

  const fbq = window.fbq;
  const ttq = window.ttq;

  debug('flushQueue called. Status:', { _metaId, _tiktokCode, hasFbq: !!fbq, hasTtq: !!ttq, metaInited: _metaInited, queueLength: _eventQueue.length });

  if (!_metaId && !_tiktokCode) return;
  if ((_metaId && (!fbq || !_metaInited)) && (_tiktokCode && !ttq)) return;

  if (_eventQueue.length > 0) {
    _eventQueue.forEach(({ event, data, eventId }) => {
      if (fbq && _metaId && _metaInited) {
        debug('Flushing queued Meta event:', event, data);
        fbq('track', event, data, { eventID: eventId });
      }
      if (ttq && _tiktokCode) {
        const tiktokEvent = event === 'Purchase' ? 'CompletePayment' : event;
        debug('Flushing queued TikTok event:', tiktokEvent, data);
        ttq.track(tiktokEvent, data, { event_id: eventId });
      }
    });
    _eventQueue = [];
  }
}

if (typeof window !== 'undefined') {
  window.__flushTrackingQueue = flushQueue;
  window.__initMetaPixel = initMetaPixel;
}

export function getCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || '';
  return '';
}

function isSyntheticEmail(email?: string): boolean {
  if (!email) return true;
  const localPart = email.split('@')[0]?.toLowerCase() || '';
  return localPart.startsWith('cust_') || /^\d+$/.test(localPart);
}

export function trackEvent(event: EventName, data?: Record<string, any>, userData?: { email?: string; phone?: string; name?: string; city?: string; country?: string; zip?: string; state?: string; address?: string }, eventId?: string) {
  debug('trackEvent called:', { event, data, userData, eventId });
  if (typeof window === 'undefined') return;

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

  // Caller-provided dedup key (e.g. purchase_{orderId}) matches the server-side
  // capture so Meta dedups Pixel + CAPI. Fall back to a random id otherwise.
  const resolvedEventId = eventId ?? generateEventId();
  const fbq = window.fbq;
  const ttq = window.ttq;

  debug('Pixel IDs and script status:', { _metaId, _tiktokCode, hasFbq: !!fbq, hasTtq: !!ttq });

  if (!_metaId && !_tiktokCode) {
    debug('Queuing event (no IDs yet):', event);
    _eventQueue.push({ event, data, eventId: resolvedEventId });
  } else if ((_metaId && (!fbq || !_metaInited)) || (_tiktokCode && !ttq)) {
    // Meta events buffer until fbq('init') runs (_metaInited) so the external_id
    // is present at init and init-first ordering is guaranteed (Wave-2.1).
    debug('Queuing event (scripts not fully loaded yet):', event);
    _eventQueue.push({ event, data, eventId: resolvedEventId });
  } else {
    if (fbq && _metaId && _metaInited) {
      debug('Firing Meta Pixel event:', event, data, { eventID: resolvedEventId });
      fbq('track', event, data, { eventID: resolvedEventId });
    }
    if (ttq && _tiktokCode) {
      const tiktokEvent = event === 'Purchase' ? 'CompletePayment' : event;
      debug('Firing TikTok Pixel event:', tiktokEvent, data, { event_id: resolvedEventId });
      ttq.track(tiktokEvent, data, { event_id: resolvedEventId });
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

  const fbp = getCookie('_fbp');
  const fbc = getCookie('_fbc');
  const url = typeof window !== 'undefined' ? window.location.href : '';
  const referrer = typeof document !== 'undefined' ? document.referrer : '';

  if (_metaId || _tiktokCode) {
    fetch(`${getTrackingApiUrl()}/tracking/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ctxId: getOrCreateCtxId(),
        eventId: resolvedEventId,
        eventName: eventNameToSnake(event),
        customData: data,
        userData: {
          ...userData,
          fbp,
          fbc,
          url,
          referrer,
        },
      }),
      keepalive: true,
    }).catch((err) => {
      console.error('[TRACKING] Server-side event send failed:', err);
    });
  } else {
    debug('Skipping server-side CAPI call - no tracking enabled');
  }
}
