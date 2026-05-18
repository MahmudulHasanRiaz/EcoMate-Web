declare global {
  interface Window {
    fbq?: any;
    ttq?: any;
  }
}

type EventName = 'ViewContent' | 'AddToCart' | 'AddToWishlist' | 'InitiateCheckout'
  | 'AddPaymentInfo' | 'Purchase' | 'Search' | 'CompleteRegistration';

export function trackEvent(event: EventName, data?: Record<string, any>) {
  if (typeof window === 'undefined') return;

  try {
    if (window.fbq) {
      window.fbq('track', event, data);
    }
  } catch {}

  try {
    if (window.ttq) {
      window.ttq.track(event, data);
    }
  } catch {}

  fetch('/api/tracking/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventName: event.toLowerCase().replace(/[A-Z]/g, c => '_' + c.toLowerCase()).replace(/^_/, ''), customData: data }),
    keepalive: true,
  }).catch(() => {});
}
