const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'

declare global {
  interface Window {
    fbq?: any;
    ttq?: any;
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
let _pixelReady = false;

// Pixel ready হওয়ার আগে আসা events গুলো queue তে রাখা হবে
type QueuedEvent = { event: EventName; data?: Record<string, any>; eventId: string };
const _eventQueue: QueuedEvent[] = [];

function fireClientEvents(event: EventName, data: Record<string, any> | undefined, eventId: string) {
  try {
    if (window.fbq && _metaId) {
      window.fbq('track', event, data, { eventID: eventId });
    }
  } catch {}

  try {
    if (window.ttq && _tiktokCode) {
      window.ttq.track(event, data);
    }
  } catch {}
}

export function setPixelIds(metaId: string, tiktokCode: string) {
  _metaId = metaId;
  _tiktokCode = tiktokCode;
  _pixelReady = true;

  // Queue তে জমা থাকা events গুলো এখন fire করো
  if (_eventQueue.length > 0) {
    // Pixel script load হওয়ার জন্য সামান্য অপেক্ষা
    setTimeout(() => {
      _eventQueue.forEach(({ event, data, eventId }) => {
        fireClientEvents(event, data, eventId);
      });
      _eventQueue.length = 0;
    }, 300);
  }
}

export function trackEvent(event: EventName, data?: Record<string, any>) {
  if (typeof window === 'undefined') return;

  const eventId = generateEventId();

  if (_pixelReady) {
    // Pixel already ready — সরাসরি fire করো
    fireClientEvents(event, data, eventId);
  } else {
    // Pixel এখনো load হয়নি — queue তে রাখো
    _eventQueue.push({ event, data, eventId });
  }

  // Server-side CAPI call সবসময় যাবে (pixel ready হওয়ার অপেক্ষা করে না)
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
