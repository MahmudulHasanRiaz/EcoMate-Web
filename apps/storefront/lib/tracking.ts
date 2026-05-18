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

export function setPixelIds(metaId: string, tiktokCode: string) {
  _metaId = metaId;
  _tiktokCode = tiktokCode;
}

export function trackEvent(event: EventName, data?: Record<string, any>) {
  if (typeof window === 'undefined') return;

  const eventId = generateEventId();

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
