import { getPixelIds } from '@/components/TrackingScripts'

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

export function trackEvent(event: EventName, data?: Record<string, any>) {
  if (typeof window === 'undefined') return;

  const eventId = generateEventId();
  const ids = getPixelIds();

  try {
    if (window.fbq && ids.metaId) {
      window.fbq('track', event, data, { eventID: eventId });
    }
  } catch {}

  try {
    if (window.ttq && ids.tiktokCode) {
      window.ttq.track(event, data);
    }
  } catch {}

  fetch('/api/tracking/events', {
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
