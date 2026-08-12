"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getProducts } from '@/lib/api/products';
import { trackSearch, normalizeSearchQuery } from '@/lib/tracking';
import { useAuth } from '@/context/AuthContext';
import { useStorefrontConfig } from '@/context/StorefrontConfigContext';
import Link from 'next/link';
import type { Product } from '@/lib/types';

/**
 * HeaderSearch — premium search bar with autocomplete.
 *
 * SEMANTIC: typing/autocomplete fetches NEVER fire a Meta Search event. Only
 * COMMITTED actions do: Enter, the search button — or selecting a suggestion
 * (user searched, then picked a match). search_string is the string the user
 * actually typed (normalized); suggestions are navigations, not query rewrites.
 * trackSearch dedupes accidental double-submissions via its event_id.
 *
 * Autocomplete: 250ms debounce + AbortController (cancels in-flight requests so
 * a slow "sho" response can never overwrite "shoes") + a small module-level
 * cache for repeated identical queries.
 *
 * A11y: combobox/listbox pattern — role=combobox, aria-expanded, aria-controls,
 * aria-activedescendant, role=listbox/option, aria-live status, ArrowUp/Down,
 * Enter, Escape, visible focus ring, labelled controls, ≥44px touch targets.
 */

const AUTOCOMPLETE_DEBOUNCE_MS = 250;
const MIN_AUTOCOMPLETE_CHARS = 2;
const AUTOCOMPLETE_CACHE_MAX = 50;

const autocompleteCache = new Map<string, Product[]>();

/** Test-only helper: clears the shared autocomplete cache between tests. */
export function _resetAutocompleteCache() {
  autocompleteCache.clear();
}

export function HeaderSearch({
  onCloseMobile,
  autoFocus = false,
}: {
  onCloseMobile?: () => void;
  autoFocus?: boolean;
}) {
  const { config } = useStorefrontConfig();
  const { user } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const currency = config?.currency?.code;
  const email = user?.email;

  // Autocomplete: debounce + abort + cache. No tracking here — typing is NOT a
  // committed search.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_AUTOCOMPLETE_CHARS) {
      abortRef.current?.abort();
      setSuggestions([]);
      setLoading(false);
      setActiveIndex(-1);
      return;
    }

    const cacheKey = trimmed.toLowerCase();
    const cached = autocompleteCache.get(cacheKey);
    if (cached) {
      setSuggestions(cached);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await getProducts({ search: trimmed, perPage: 5, signal: controller.signal });
        if (controller.signal.aborted) return;
        autocompleteCache.set(cacheKey, res.data || []);
        if (autocompleteCache.size > AUTOCOMPLETE_CACHE_MAX) {
          const oldest = autocompleteCache.keys().next().value;
          if (oldest !== undefined) autocompleteCache.delete(oldest);
        }
        setSuggestions(res.data || []);
      } catch {
        // aborted or failed — keep the previous panel state, never a stale overwrite
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, AUTOCOMPLETE_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Cancel any in-flight request on unmount.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Close the panel when focus leaves the whole widget (incl. suggestion links).
  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  };

  /** COMMIT semantics — the only place trackSearch fires in this widget. */
  const commitSearch = useCallback(
    (raw: string) => {
      const q = normalizeSearchQuery(raw);
      if (!q) return;
      trackSearch({ query: q, currency, email, country: 'BD' });
      setIsOpen(false);
      setActiveIndex(-1);
      if (onCloseMobile) onCloseMobile();
      router.push(`/products?search=${encodeURIComponent(q)}`);
    },
    [currency, email, onCloseMobile, router],
  );

  /** Suggestion selection: committed search (typed query) + product navigation. */
  const openProduct = useCallback(
    (product: Product) => {
      trackSearch({ query, currency, email, country: 'BD' });
      setIsOpen(false);
      setActiveIndex(-1);
      if (onCloseMobile) onCloseMobile();
      router.push(`/products/${product.slug}`);
    },
    [query, currency, email, onCloseMobile, router],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) setIsOpen(true);
      if (suggestions.length > 0) {
        setActiveIndex((prev) => (prev + 1) % suggestions.length);
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (suggestions.length > 0) {
        setActiveIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        openProduct(suggestions[activeIndex]);
      } else {
        commitSearch(query);
      }
    } else if (event.key === 'Escape') {
      if (isOpen) {
        setIsOpen(false);
        setActiveIndex(-1);
      } else if (query) {
        setQuery('');
        setSuggestions([]);
      }
    }
  };

  const handleChange = (value: string) => {
    setQuery(value);
    setActiveIndex(-1);
    setIsOpen(true);
  };

  const handleClear = () => {
    abortRef.current?.abort();
    setQuery('');
    setSuggestions([]);
    setLoading(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const showPanel = isOpen && query.trim().length >= MIN_AUTOCOMPLETE_CHARS;
  const statusMessage =
    loading && suggestions.length === 0
      ? 'Searching products…'
      : suggestions.length > 0
        ? `${suggestions.length} product suggestion${suggestions.length === 1 ? '' : 's'}`
        : null;

  return (
    <div ref={containerRef} className="relative w-full" onBlur={handleBlur}>
      <div className="relative flex items-center w-full h-10 md:h-11 rounded-lg border border-gray-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-[border-color,box-shadow] duration-150 focus-within:border-brand-blue/60 focus-within:ring-2 focus-within:ring-brand-blue/10 hover:border-gray-300">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showPanel}
          aria-controls="header-search-suggestions"
          aria-activedescendant={activeIndex >= 0 ? `header-search-option-${activeIndex}` : undefined}
          aria-label="Search products"
          autoFocus={autoFocus}
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => {
            setIsOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search products…"
          className="w-full h-full pl-4 pr-20 outline-none text-sm bg-transparent text-gray-700 placeholder:text-gray-400 border-none focus:ring-0"
        />

        <div className="absolute right-2 flex items-center gap-0.5">
          {loading && suggestions.length === 0 && (
            <Loader2 size={15} className="animate-spin text-gray-400" aria-hidden="true" />
          )}
          {query && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear search"
              className="p-2 -mr-1 text-gray-400 hover:text-gray-600 transition-colors rounded-[4px] hover:bg-gray-50"
            >
              <X size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={() => commitSearch(query)}
            aria-label="Search"
            className="p-1.5 text-brand-blue hover:text-brand-blue/80 transition-colors rounded-[4px] hover:bg-brand-blue/5"
          >
            <Search size={18} strokeWidth={2} />
          </button>
        </div>
      </div>

      <p id="header-search-status" aria-live="polite" className="sr-only">
        {statusMessage ?? ''}
      </p>

      {showPanel && (
        <div
          id="header-search-suggestions"
          role="listbox"
          aria-label="Search suggestions"
          className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-lg border border-gray-200 shadow-lg overflow-hidden z-50"
        >
          <div className="py-1.5 max-h-[320px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-gray-200">
            {loading && suggestions.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-gray-400 text-sm gap-2">
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                <span>Searching products…</span>
              </div>
            ) : suggestions.length === 0 ? (
              <div className="py-8 px-4 text-center text-gray-500 text-sm font-medium">
                No products found for{' '}
                <span className="font-bold text-gray-800">&ldquo;{query.trim()}&rdquo;</span>
              </div>
            ) : (
              <>
                <div className="px-4 py-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                  Product Matches
                </div>
                {suggestions.map((product, index) => {
                  const priceSym = config.currency.symbol || '৳';
                  const isActive = index === activeIndex;
                  return (
                    <Link
                      key={product.id}
                      id={`header-search-option-${index}`}
                      role="option"
                      aria-selected={isActive}
                      href={`/products/${product.slug}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => openProduct(product)}
                      className={`flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors ${
                        isActive ? 'bg-gray-50' : 'hover:bg-gray-50/60'
                      }`}
                    >
                      {product.image ? (
                        <img
                          src={product.image}
                          alt=""
                          className="w-9 h-9 object-cover rounded-md border border-gray-100 flex-shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 bg-gray-100 rounded-md flex-shrink-0 flex items-center justify-center text-gray-300">
                          <Search size={15} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h4 className="text-[13px] font-semibold text-gray-800 truncate">
                          {product.name}
                        </h4>
                        {product.brand?.name && (
                          <span className="text-[11px] text-gray-400 font-medium block">
                            {product.brand.name}
                          </span>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className="text-[13px] font-bold text-gray-900">
                          {priceSym}
                          {product.price.toLocaleString()}
                        </span>
                        {product.originalPrice && product.originalPrice > product.price && (
                          <span className="text-[11px] text-gray-400 line-through block">
                            {priceSym}
                            {product.originalPrice.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </>
            )}
          </div>
          {!loading && suggestions.length > 0 && (
            <button
              type="button"
              onClick={() => commitSearch(query)}
              className="w-full text-center border-t border-gray-100 px-4 py-2.5 text-[12px] font-bold text-brand-blue hover:text-brand-blue/80 hover:bg-gray-50/60 transition-colors"
            >
              View all results for &ldquo;{query.trim()}&rdquo; &rarr;
            </button>
          )}
        </div>
      )}
    </div>
  );
}