import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trackEvent, setPixelIds } from '../tracking';

describe('tracking', () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    // One assignment per cookie: the document.cookie setter only stores the
    // first name=value pair from a single assignment (spec-compliant in jsdom
    // and real browsers alike).
    document.cookie = '_fbp=fb.1.1.1; path=/';
    document.cookie = '_fbc=fb.1.2.3; path=/';
    vi.restoreAllMocks();

    // Fresh pixel mocks, then assign pixel ids. Any events left queued by a
    // previous test flush into these fresh mocks, so clear them afterwards.
    window.fbq = vi.fn();
    window.ttq = { track: vi.fn() };
    setPixelIds('TEST-META-ID', 'TEST-TIKTOK-CODE');
    vi.mocked(window.fbq).mockClear();
    vi.mocked(window.ttq.track).mockClear();

    fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);
  });

  it('uses the provided eventId for the Meta pixel eventID', () => {
    trackEvent('Purchase', { value: 100 }, {}, 'purchase_ord-1');
    expect(window.fbq).toHaveBeenCalledWith('track', 'Purchase', { value: 100 }, { eventID: 'purchase_ord-1' });
  });

  it('uses the provided eventId for the TikTok pixel event_id', () => {
    trackEvent('Purchase', { value: 100 }, {}, 'purchase_ord-1');
    expect(window.ttq.track).toHaveBeenCalledWith('CompletePayment', { value: 100 }, { event_id: 'purchase_ord-1' });
  });

  it('mirrors the provided eventId into the /tracking/events POST body', () => {
    trackEvent('Purchase', { value: 100 }, {}, 'purchase_ord-1');
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/tracking/events');
    const body = JSON.parse(init!.body as string);
    expect(body.eventId).toBe('purchase_ord-1');
    expect(body.eventName).toBe('purchase');
  });

  it('carries the eventId override through the pre-init queue', () => {
    setPixelIds('', ''); // clear pixel ids so trackEvent queues instead of firing
    window.fbq = vi.fn();
    trackEvent('Purchase', { value: 100 }, {}, 'purchase_queued-1');
    expect(window.fbq).not.toHaveBeenCalled();
    setPixelIds('TEST-META-ID', ''); // flush the queue
    expect(window.fbq).toHaveBeenCalledWith('track', 'Purchase', { value: 100 }, { eventID: 'purchase_queued-1' });
  });

  it('generates a random eventId when no override is provided (existing behavior)', () => {
    trackEvent('Purchase', { value: 100 });
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/tracking/events');
    const body = JSON.parse(init!.body as string);
    expect(body.eventId).toBeDefined();
    expect(body.eventId).toMatch(/^\d+-[a-z0-9]{8}$/);
    // The same random id must drive the pixel eventID so both stay consistent.
    expect(window.fbq).toHaveBeenCalledWith('track', 'Purchase', { value: 100 }, { eventID: body.eventId });
  });
});
