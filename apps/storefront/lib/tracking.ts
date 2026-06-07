const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'

declare global {
  interface Window {
    fbq?: any;
    ttq?: any;
    __flushTrackingQueue?: () => void;
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
let _eventQueue: { event: EventName; data?: Record<string, any>; eventId: string }[] = [];

const debug = process.env.NODE_ENV !== 'production'
  ? (...args: unknown[]) => console.log('[TRACKING]', ...args)
  : () => {};

export function setPixelIds(metaId: string, tiktokCode: string) {
  _metaId = metaId;
  _tiktokCode = tiktokCode;
  flushQueue();
}

export function flushQueue() {
  if (typeof window === 'undefined') return;

  const fbq = window.fbq;
  const ttq = window.ttq;

  debug('flushQueue called. Status:', { _metaId, _tiktokCode, hasFbq: !!fbq, hasTtq: !!ttq, queueLength: _eventQueue.length });

  if (!_metaId && !_tiktokCode) return;
  if ((_metaId && !fbq) && (_tiktokCode && !ttq)) return;

  if (_eventQueue.length > 0) {
    _eventQueue.forEach(({ event, data, eventId }) => {
      if (fbq && _metaId) {
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

// গ্লোবাল উইন্ডো অবজেক্টে ফাংশনটি দিয়ে রাখছি যেন স্ক্রিপ্ট ট্যাগ থেকে কল করা যায়
if (typeof window !== 'undefined') {
  window.__flushTrackingQueue = flushQueue;
}

function getCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || '';
  return '';
}

export function trackEvent(event: EventName, data?: Record<string, any>, userData?: { email?: string; phone?: string; name?: string; city?: string; country?: string }) {
  debug('trackEvent called:', { event, data, userData });
  if (typeof window === 'undefined') return;

  const eventId = generateEventId();
  const fbq = window.fbq;
  const ttq = window.ttq;

  debug('Pixel IDs and script status:', { _metaId, _tiktokCode, hasFbq: !!fbq, hasTtq: !!ttq });

  if (!_metaId && !_tiktokCode) {
    debug('Queuing event (no IDs yet):', event);
    _eventQueue.push({ event, data, eventId });
  } else if ((_metaId && !fbq) || (_tiktokCode && !ttq)) {
    debug('Queuing event (scripts not fully loaded yet):', event);
    _eventQueue.push({ event, data, eventId });
  } else {
    if (fbq && _metaId) {
      debug('Firing Meta Pixel event:', event, data, { eventID: eventId });
      fbq('track', event, data, { eventID: eventId });
    }
    if (ttq && _tiktokCode) {
      const tiktokEvent = event === 'Purchase' ? 'CompletePayment' : event;
      debug('Firing TikTok Pixel event:', tiktokEvent, data, { event_id: eventId });
      ttq.track(tiktokEvent, data, { event_id: eventId });
    }
  }

  // মেটার জন্য fbp এবং fbc কুকি রিড করো
  const fbp = getCookie('_fbp');
  const fbc = getCookie('_fbc');

  // টিকটকের জন্য URL এবং Referrer রিড করো
  const url = typeof window !== 'undefined' ? window.location.href : '';
  const referrer = typeof document !== 'undefined' ? document.referrer : '';

  // Server-side CAPI কল সবসময় যাবে
  fetch(`${API_URL}/tracking/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId,
      eventName: eventNameToSnake(event),
      customData: data,
      userData: {
        ...userData,
        fbp,
        fbc,
        url,
        referrer
      },
    }),
    keepalive: true,
  }).catch(() => {});
}
