import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrCreateCtxId, collectIdentifiers, syncContext, captureMarketingSession } from '../tracking-client';

describe('tracking-client', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // One assignment per cookie: the document.cookie setter only stores the
    // first name=value pair from a single assignment (spec-compliant in jsdom
    // and real browsers alike).
    document.cookie = '_fbp=fb.1.1.1; path=/';
    document.cookie = '_fbc=fb.1.2.3; path=/';
    document.cookie = '_ga=GA1.2.5; path=/';
    document.cookie = '_ttp=tt.1; path=/';
    vi.restoreAllMocks();
  });

  it('creates a stable ctxId and reuses it', () => {
    const a = getOrCreateCtxId();
    const b = getOrCreateCtxId();
    expect(a).toBe(b);
  });

  it('collects provider identifiers from cookies and URL params', () => {
    // URL has fbclid=gclid=ttclid values
    const ids = collectIdentifiers();
    expect(ids.meta.fbp).toBe('fb.1.1.1');
    expect(ids.meta.fbc).toBe('fb.1.2.3');
    expect(ids.google.gaClientId).toBe('GA1.2.5');
  });

  it('posts ctxId + identifiers to /tracking/context', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);
    await syncContext();
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/tracking/context');
    const body = JSON.parse(init!.body as string);
    expect(body.ctxId).toBeDefined();
  });

  it('syncContext strips sensitive query params from url/referrer (privacy P0)', async () => {
    window.history.replaceState(
      {},
      '',
      '/checkout/thank-you?orderId=uuid-1&t=viewtoken',
    );
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);
    await syncContext();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/tracking/context');
    const body = JSON.parse(init!.body as string);
    expect(body.url).toBe(`${window.location.origin}/checkout/thank-you`);
    expect(JSON.stringify(body)).not.toContain('viewtoken');
    expect(JSON.stringify(body)).not.toContain('uuid-1');
  });

  it('syncContext keeps clean URLs unchanged', async () => {
    window.history.replaceState({}, '', '/products/abc');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);
    await syncContext();
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(body.url).toBe(`${window.location.origin}/products/abc`);
  });

  it('captureMarketingSession posts landing attribution + ctxId to /marketing/capture', async () => {
    // Simulate a fbclid landing so the session attribution exists.
    window.history.replaceState({}, '', '/?utm_source=facebook&utm_medium=cpc&utm_campaign=launch&fbclid=fb.1.9.8');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);
    await captureMarketingSession();
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/marketing/capture');
    const body = JSON.parse(init!.body as string);
    expect(body.sessionToken).toBeTruthy();
    expect(body.fbclid).toBe('fb.1.9.8');
    expect(body.utmSource).toBe('facebook');
    expect(body.utmCampaign).toBe('launch');
    expect(body.utmMedium).toBe('cpc');
  });

  it('captureMarketingSession is silent (does not throw) when fetch fails', async () => {
    window.history.replaceState({}, '', '/?utm_source=facebook&fbclid=fb.1.9.8');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('net::ERR_FAILED'));
    await expect(captureMarketingSession()).resolves.toBeUndefined();
  });

  it('captureMarketingSession is a no-op without attribution signals', async () => {
    window.history.replaceState({}, '', '/');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);
    await captureMarketingSession();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
