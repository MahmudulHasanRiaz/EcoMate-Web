import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiClient from '@/lib/api-client';
import { getProducts } from '../api/products';

vi.mock('@/lib/api-client', () => ({
  default: {
    get: vi.fn().mockImplementation(
      (_url: string, config?: { signal?: AbortSignal }) =>
        new Promise((resolve, reject) => {
          const fail = () => reject(new Error('aborted'));
          if (config?.signal?.aborted) {
            fail();
            return;
          }
          config?.signal?.addEventListener('abort', fail, { once: true });
          queueMicrotask(() => resolve({ data: { data: [], meta: {} } }));
        }),
    ),
  },
}));

describe('getProducts — request cancellation wiring', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockClear();
  });

  it('passes the AbortSignal as TOP-LEVEL axios config so cancellation actually works', async () => {
    const controller = new AbortController();
    await getProducts({ search: 'shoes', perPage: 5, signal: controller.signal });

    const [url, config] = vi.mocked(apiClient.get).mock.calls[0];
    expect(url).toBe('/products');
    expect(config.signal).toBe(controller.signal);
    expect(config.params).not.toHaveProperty('signal');
    expect(config.params).toEqual({ search: 'shoes', perPage: 5 });
  });

  it('aborting the controller cancels an in-flight request', async () => {
    const controller = new AbortController();
    const pending = getProducts({ search: 'shoes', signal: controller.signal });
    controller.abort();
    const [, config] = vi.mocked(apiClient.get).mock.calls[0];
    expect(config.signal.aborted).toBe(true);
    await expect(pending).rejects.toThrow();
  });
});