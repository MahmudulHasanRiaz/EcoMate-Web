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

export function setPixelIds(metaId: string, tiktokCode: string) {
  _metaId = metaId;
  _tiktokCode = tiktokCode;
  // আইডি সেট হওয়ার পর একবার কিউ ফ্লাশ করার চেষ্টা করি
  flushQueue();
}

export function flushQueue() {
  if (typeof window === 'undefined') return;
  
  const fbq = window.fbq;
  const ttq = window.ttq;

  // যদি আইডিই না থাকে অথবা স্ক্রিপ্ট এখনো লোড না হয়, তাহলে পরে হবে
  if (!_metaId && !_tiktokCode) return;
  if ((_metaId && !fbq) && (_tiktokCode && !ttq)) return;

  if (_eventQueue.length > 0) {
    _eventQueue.forEach(({ event, data, eventId }) => {
      if (fbq && _metaId) {
        fbq('track', event, data, { eventID: eventId });
      }
      if (ttq && _tiktokCode) {
        ttq.track(event, data);
      }
    });
    // কিউ ক্লিয়ার করে দাও
    _eventQueue = [];
  }
}

// গ্লোবাল উইন্ডো অবজেক্টে ফাংশনটি দিয়ে রাখছি যেন স্ক্রিপ্ট ট্যাগ থেকে কল করা যায়
if (typeof window !== 'undefined') {
  window.__flushTrackingQueue = flushQueue;
}

export function trackEvent(event: EventName, data?: Record<string, any>) {
  if (typeof window === 'undefined') return;

  const eventId = generateEventId();
  const fbq = window.fbq;
  const ttq = window.ttq;

  // স্ক্রিপ্ট রেডি না থাকলে কিউতে রাখো
  if (!_metaId && !_tiktokCode) {
    _eventQueue.push({ event, data, eventId });
  } else if ((_metaId && !fbq) || (_tiktokCode && !ttq)) {
    _eventQueue.push({ event, data, eventId });
  } else {
    // স্ক্রিপ্ট রেডি থাকলে সরাসরি ফায়ার করো
    if (fbq && _metaId) {
      fbq('track', event, data, { eventID: eventId });
    }
    if (ttq && _tiktokCode) {
      ttq.track(event, data);
    }
  }

  // Server-side CAPI কল সবসময় যাবে
  fetch(`${API_URL}/tracking/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId,
      eventName: eventNameToSnake(event),
      customData: data,
    }),
    keepalive: true,
  }).catch(() => {});
}
