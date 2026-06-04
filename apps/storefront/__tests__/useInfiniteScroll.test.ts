import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useInfiniteScroll } from '@/lib/hooks/useInfiniteScroll';

interface Item {
  id: string;
  name: string;
}

const makePage = (startId: number, count: number, hasMore: boolean) => {
  const items: Item[] = Array.from({ length: count }, (_, i) => ({
    id: `id-${startId + i}`,
    name: `Item ${startId + i}`,
  }));
  return {
    items,
    nextCursor: hasMore ? `cursor-after-${startId + count - 1}` : null,
    hasMore,
  };
};

const createFetch = () => vi.fn<(cursor: string | null, signal: AbortSignal) => Promise<ReturnType<typeof makePage>>>();

const setupHook = (overrides: Partial<Parameters<typeof useInfiniteScroll<Item>>[0]> = {}) => {
  const fetchPage = createFetch();
  const hook = renderHook(() =>
    useInfiniteScroll<Item>({
      initialItems: [{ id: 'id-1', name: 'Item 1' }],
      initialCursor: 'cursor-after-1',
      initialHasMore: true,
      fetchPage,
      getId: (item) => item.id,
      pageSize: 3,
      ...overrides,
    }),
  );
  act(() => {
    hook.result.current.sentinelRef(document.createElement('div'));
  });
  return { fetchPage, hook };
};

const triggerIntersection = (isIntersecting: boolean) => {
  const observers = (globalThis as unknown as { IntersectionObserver: { instances: Array<{ trigger: (b: boolean) => void }> } }).IntersectionObserver.instances;
  observers.forEach((o) => o.trigger(isIntersecting));
};

describe('useInfiniteScroll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the initial items on first render', () => {
    const { hook } = setupHook();
    expect(hook.result.current.items).toEqual([{ id: 'id-1', name: 'Item 1' }]);
    expect(hook.result.current.hasMore).toBe(true);
    expect(hook.result.current.isLoading).toBe(false);
    expect(hook.result.current.error).toBeNull();
  });

  it('fetches the next page when sentinel intersects and appends unique items', async () => {
    const { hook, fetchPage } = setupHook();
    fetchPage.mockResolvedValueOnce(makePage(2, 3, true));

    act(() => {
      triggerIntersection(true);
    });

    await waitFor(() => {
      expect(hook.result.current.items.length).toBe(4);
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage.mock.calls[0][0]).toBe('cursor-after-1');
  });

  it('does not refetch page 1 — initial cursor is used as the next pointer', async () => {
    const { hook, fetchPage } = setupHook();
    fetchPage.mockResolvedValueOnce(makePage(2, 3, true));
    act(() => {
      triggerIntersection(true);
    });
    await waitFor(() => expect(hook.result.current.items.length).toBe(4));
    expect(fetchPage.mock.calls[0][0]).not.toBeNull();
    expect(fetchPage.mock.calls[0][0]).toBe('cursor-after-1');
  });

  it('dedupes items that the server returns twice (same id)', async () => {
    const { hook, fetchPage } = setupHook({
      initialItems: [{ id: 'id-1', name: 'Item 1' }],
      initialCursor: 'cursor-after-1',
    });
    fetchPage.mockResolvedValueOnce({
      items: [
        { id: 'id-1', name: 'dup' },
        { id: 'id-2', name: 'Item 2' },
      ],
      nextCursor: 'cursor-after-2',
      hasMore: true,
    });

    act(() => triggerIntersection(true));
    await waitFor(() => expect(hook.result.current.items.length).toBe(2));
    expect(hook.result.current.items.map((i) => i.id)).toEqual(['id-1', 'id-2']);
  });

  it('aborts the previous fetch when a new one starts (AbortController)', async () => {
    const { hook, fetchPage } = setupHook();
    const firstAbort = vi.fn();
    const secondAbort = vi.fn();
    fetchPage.mockImplementationOnce((_cursor, signal) => {
      signal.addEventListener('abort', firstAbort);
      return new Promise(() => {});
    });
    fetchPage.mockImplementationOnce((_cursor, signal) => {
      signal.addEventListener('abort', secondAbort);
      return new Promise(() => {});
    });

    act(() => triggerIntersection(true));
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(hook.result.current.isLoading).toBe(true));

    await act(async () => {
      hook.result.current.retry();
    });
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    expect(firstAbort).toHaveBeenCalled();
    expect(secondAbort).not.toHaveBeenCalled();
  });

  it('pauses fetching when the document is hidden, even if sentinel intersects', async () => {
    const { hook, fetchPage } = setupHook();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => triggerIntersection(true));
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('resumes fetching when document becomes visible again', async () => {
    const { hook, fetchPage } = setupHook();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => triggerIntersection(true));
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchPage).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    fetchPage.mockResolvedValueOnce(makePage(2, 3, false));
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => triggerIntersection(true));
    await waitFor(() => expect(fetchPage).toHaveBeenCalled());
  });

  it('stops fetching and exposes hasMore=false when end of list reached', async () => {
    const { hook, fetchPage } = setupHook({ initialHasMore: true });
    fetchPage.mockResolvedValueOnce(makePage(2, 3, false));

    act(() => triggerIntersection(true));
    await waitFor(() => expect(hook.result.current.hasMore).toBe(false));
    expect(hook.result.current.isLoading).toBe(false);
    expect(hook.result.current.items.length).toBe(4);

    act(() => triggerIntersection(true));
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('keeps the last cursor on error and exposes a retry that refetches', async () => {
    const { hook, fetchPage } = setupHook();
    fetchPage.mockRejectedValueOnce(new Error('boom'));

    act(() => triggerIntersection(true));
    await waitFor(() => expect(hook.result.current.error).toBeTruthy());
    expect(hook.result.current.isLoading).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage.mock.calls[0][0]).toBe('cursor-after-1');

    fetchPage.mockResolvedValueOnce(makePage(2, 3, true));
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.items.length).toBe(4));
    expect(hook.result.current.error).toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('updates window URL with ?after= when a page loads (history.replaceState)', async () => {
    const { hook, fetchPage } = setupHook();
    fetchPage.mockResolvedValueOnce(makePage(2, 3, true));
    const replaceSpy = vi.spyOn(window.history, 'replaceState');

    act(() => triggerIntersection(true));
    await waitFor(() => expect(hook.result.current.items.length).toBe(4));
    const lastCall = replaceSpy.mock.calls[replaceSpy.mock.calls.length - 1];
    expect(lastCall?.[2]).toContain('after=cursor-after-4');
  });

  it('clears ?after= when reaching the end of the list', async () => {
    const { hook, fetchPage } = setupHook({ initialCursor: 'cursor-after-1' });
    fetchPage.mockResolvedValueOnce(makePage(2, 3, false));
    const replaceSpy = vi.spyOn(window.history, 'replaceState');

    act(() => triggerIntersection(true));
    await waitFor(() => expect(hook.result.current.hasMore).toBe(false));
    const lastCall = replaceSpy.mock.calls[replaceSpy.mock.calls.length - 1];
    const url = String(lastCall?.[2] ?? '');
    expect(url).not.toContain('after=');
  });

  it('requires manual "load more" click when navigator.connection.saveData is true', async () => {
    (navigator as unknown as { connection: { saveData: boolean } }).connection = { saveData: true };
    const { hook, fetchPage } = setupHook();

    act(() => triggerIntersection(true));
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchPage).not.toHaveBeenCalled();
    expect(hook.result.current.requiresManualLoad).toBe(true);

    fetchPage.mockResolvedValueOnce(makePage(2, 3, true));
    act(() => hook.result.current.loadMore());
    await waitFor(() => expect(hook.result.current.items.length).toBe(4));
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
