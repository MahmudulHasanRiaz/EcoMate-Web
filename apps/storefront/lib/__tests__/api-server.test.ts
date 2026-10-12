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
