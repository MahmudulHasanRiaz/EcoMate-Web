'use client';

import { useEffect, useRef } from 'react';

/**
 * Chunk/module load failures (e.g. a deploy evicted the hashed chunks the
 * running page references, or a shared chunk failed mid-navigation) surface
 * here as render-time TypeErrors such as "(0, O.getGateways) is not a
 * function". Next's `reset()` cannot heal those — it re-renders with the same
 * broken modules — while a hard reload (fresh HTML + chunks) does, which is
 * why visitors report "hard reload fixes it".
 *
 * So: for errors that look like a module/chunk load failure, perform ONE
 * guarded hard reload instead of stranding the shopper on a dead error page.
 * The timestamp guard prevents reload loops (a second failure within the
 * window falls through to the manual UI below).
 */
const RELOAD_GUARD_KEY = 'checkout:module-reload-at';
const RELOAD_GUARD_WINDOW_MS = 60_000;

function isModuleLoadError(error: Error): boolean {
  const text = `${error?.name ?? ''}: ${error?.message ?? ''}`;
  return (
    /Loading chunk/i.test(text) ||
    /ChunkLoadError/i.test(text) ||
    /failed to fetch dynamically imported module/i.test(text) ||
    /is not a function/.test(text)
  );
}

function shouldAutoReload(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
    if (Date.now() - last < RELOAD_GUARD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

export default function CheckoutError({ error, reset }: { error: Error; reset: () => void }) {
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    if (!isModuleLoadError(error)) return;
    if (!shouldAutoReload()) return;
    attempted.current = true;
    window.location.reload();
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center px-4">
        <h1 className="text-4xl font-bold text-red-600 mb-4">Checkout error</h1>
        <p className="text-gray-600 mb-6">{error.message || 'Something went wrong during checkout.'}</p>
        <button
          onClick={reset}
          className="px-6 py-3 bg-brand-blue text-white rounded-xl hover:opacity-90 transition-opacity"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
