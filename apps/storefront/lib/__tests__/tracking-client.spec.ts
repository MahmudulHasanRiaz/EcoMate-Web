import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrCreateCtxId, collectIdentifiers, syncContext } from '../tracking-client';

describe('tracking-client', () => {
  beforeEach(() => {
    localStorage.clear();
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
});
