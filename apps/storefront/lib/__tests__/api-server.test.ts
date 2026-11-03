import { describe, it, expect, vi, afterEach } from 'vitest';
import { serverFetch } from '@/lib/api-server';

describe('serverFetch retry policy (P0-1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT retry on timeout AbortError (fetch called exactly once)', async () => {
    const abortErr = new DOMException('The operation was aborted.', 'AbortError');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortErr);

    await expect(serverFetch('/products/slug/x', { timeout: 5000 })).rejects.toBe(abortErr);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 15000);

  it('honours maxRetries option on retryable errors', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    await expect(serverFetch('/products', { maxRetries: 1, timeout: 5000 })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15000);
});

describe('serverFetch cache tags (P4)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function okFetch() {
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => '{"ok":true}',
    } as any);
  }

  it('forwards top-level tags together with revalidate into fetch next options', async () => {
    const fetchMock = okFetch();
    await serverFetch('/products', { revalidate: 60, tags: ['products'] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      next: { revalidate: 60, tags: ['products'] },
    });
  });

  it('preserves a caller-supplied next: { revalidate, tags } (config fetch shape)', async () => {
    const fetchMock = okFetch();
    await serverFetch('/system-settings/storefront', {
      next: { revalidate: 60, tags: ['config'] },
      timeout: 30000,
    } as any);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      next: { revalidate: 60, tags: ['config'] },
    });
  });

  it('sends no next options when neither revalidate nor tags are given', async () => {
    const fetchMock = okFetch();
    await serverFetch('/system-settings/storefront', { maxRetries: 0, timeout: 3000 });
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('next');
  });
});
