"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface UseInfiniteScrollFetchResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface UseInfiniteScrollOpts<T> {
  initialItems: T[];
  initialCursor: string | null;
  initialHasMore: boolean;
  fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<UseInfiniteScrollFetchResult<T>>;
  getId: (item: T) => string;
  pageSize?: number;
  urlSyncKey?: string;
}

export interface UseInfiniteScrollResult<T> {
  items: T[];
  isLoading: boolean;
  hasMore: boolean;
  error: Error | null;
  sentinelRef: (node: HTMLElement | null) => void;
  retry: () => void;
  loadMore: () => void;
  requiresManualLoad: boolean;
}

interface NavigatorWithConnection extends Navigator {
  connection?: { saveData?: boolean };
}

const getSaveData = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as NavigatorWithConnection).connection;
  return Boolean(conn?.saveData);
};

const syncUrl = (key: string, cursor: string | null) => {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (cursor) {
    url.searchParams.set(key, cursor);
  } else {
    url.searchParams.delete(key);
  }
  window.history.replaceState(null, "", url.toString());
};

export function useInfiniteScroll<T>(opts: UseInfiniteScrollOpts<T>): UseInfiniteScrollResult<T> {
  const {
    initialItems,
    initialCursor,
    initialHasMore,
    fetchPage,
    getId,
    pageSize: _pageSize = 8,
    urlSyncKey = "after",
  } = opts;

  const [items, setItems] = useState<T[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [hasMore, setHasMore] = useState<boolean>(initialHasMore);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [requiresManualLoad] = useState<boolean>(getSaveData());
  const [sentinelNode, setSentinelNode] = useState<HTMLElement | null>(null);

  const seenIdsRef = useRef<Set<string>>(new Set(initialItems.map(getId)));
  const isVisibleRef = useRef<boolean>(typeof document === "undefined" || document.visibilityState === "visible");
  const manualTriggerRef = useRef<boolean>(false);
  const inflightRef = useRef<AbortController | null>(null);

  const ingest = useCallback((incoming: T[]) => {
    if (incoming.length === 0) return;
    setItems((prev) => {
      const seen = seenIdsRef.current;
      const next: T[] = [...prev];
      for (const it of incoming) {
        const id = getId(it);
        if (seen.has(id)) continue;
        seen.add(id);
        next.push(it);
      }
      return next;
    });
  }, [getId]);

  const runFetch = useCallback(async (nextCursor: string | null) => {
    if (inflightRef.current) inflightRef.current.abort();
    const controller = new AbortController();
    inflightRef.current = controller;
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchPage(nextCursor, controller.signal);
      if (controller.signal.aborted) return;
      ingest(result.items);
      setHasMore(result.hasMore);
      setCursor(result.nextCursor);
      syncUrl(urlSyncKey, result.hasMore ? result.nextCursor : null);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      if (inflightRef.current === controller) inflightRef.current = null;
      setIsLoading(false);
    }
  }, [fetchPage, ingest, urlSyncKey]);

  useEffect(() => {
    const onVisibility = () => {
      isVisibleRef.current = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const tryStartFetch = useCallback((manual: boolean) => {
    if (!hasMore || isLoading) return;
    if (error) return;
    if (!manual && requiresManualLoad) return;
    if (!isVisibleRef.current) return;
    void runFetch(cursor);
  }, [hasMore, isLoading, error, requiresManualLoad, runFetch, cursor]);

  const sentinelRef = useCallback((node: HTMLElement | null) => {
    setSentinelNode(node);
  }, []);

  useEffect(() => {
    if (!sentinelNode) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            tryStartFetch(manualTriggerRef.current);
            manualTriggerRef.current = false;
          }
        }
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(sentinelNode);
    return () => observer.disconnect();
  }, [sentinelNode, tryStartFetch]);

  const retry = useCallback(() => {
    setError(null);
    if (!hasMore) return;
    void runFetch(cursor);
  }, [hasMore, runFetch, cursor]);

  const loadMore = useCallback(() => {
    if (!hasMore || isLoading) return;
    if (requiresManualLoad || manualTriggerRef.current) {
      manualTriggerRef.current = true;
    }
    tryStartFetch(true);
    manualTriggerRef.current = false;
  }, [hasMore, isLoading, tryStartFetch, requiresManualLoad]);

  useEffect(() => {
    return () => {
      if (inflightRef.current) inflightRef.current.abort();
    };
  }, []);

  return useMemo(
    () => ({
      items,
      isLoading,
      hasMore,
      error,
      sentinelRef,
      retry,
      loadMore,
      requiresManualLoad,
    }),
    [items, isLoading, hasMore, error, sentinelRef, retry, loadMore, requiresManualLoad],
  );
}
