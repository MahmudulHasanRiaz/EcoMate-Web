"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getProducts } from '@/lib/api/products';
import type { Product } from '@/lib/types';
import Link from 'next/link';
import { useStorefrontConfig } from '@/context/StorefrontConfigContext';

export function HeaderSearch({ onCloseMobile }: { onCloseMobile?: () => void }) {
  const { config } = useStorefrontConfig();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce query changes and fetch suggestions
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await getProducts({ search: trimmed, perPage: 5 });
        setSuggestions(res.data || []);
      } catch (err) {
        console.error('Search autocomplete fetch failed', err);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  // Handle outside clicks to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSearchSubmit = (searchVal: string) => {
    if (searchVal.trim()) {
      router.push(`/products?search=${encodeURIComponent(searchVal.trim())}`);
      setIsOpen(false);
      if (onCloseMobile) onCloseMobile();
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center w-full h-[40px] rounded-full border border-gray-200 bg-gray-50 focus-within:bg-white focus-within:border-brand-blue focus-within:ring-2 focus-within:ring-brand-blue/10 transition-all">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleSearchSubmit(query);
            }
          }}
          placeholder="Search products..."
          className="w-full h-full pl-5 pr-12 outline-none text-[14px] bg-transparent text-gray-700 font-medium rounded-full"
        />
        
        <div className="absolute right-3 flex items-center gap-1.5">
          {loading && <Loader2 size={15} className="animate-spin text-gray-400" />}
          {query && (
            <button
              onClick={() => {
                setQuery('');
                setSuggestions([]);
              }}
              className="p-1 hover:bg-gray-200 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={14} />
            </button>
          )}
          <button 
            onClick={() => handleSearchSubmit(query)}
            className="text-brand-blue hover:text-brand-blue/80 transition-colors p-1"
          >
            <Search size={18} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* Autocomplete Dropdown Suggestions Panel */}
      {isOpen && query.trim().length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white/95 backdrop-blur-md rounded-2xl border border-gray-150/80 shadow-[0_12px_30px_rgba(0,0,0,0.08)] overflow-hidden z-50 animate-in fade-in duration-100">
          <div className="py-2.5 max-h-[380px] overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-gray-200">
            {loading && suggestions.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-gray-400 text-sm gap-2">
                <Loader2 size={16} className="animate-spin" />
                <span>Searching products...</span>
              </div>
            ) : suggestions.length === 0 ? (
              <div className="py-8 px-4 text-center text-gray-500 text-sm font-medium">
                No products found for <span className="font-bold text-gray-800">&ldquo;{query}&rdquo;</span>
              </div>
            ) : (
              <>
                <div className="px-4 py-1 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-50 mb-1">
                  Product Matches
                </div>
                <div className="space-y-0.5">
                  {suggestions.map((product) => {
                    const priceSym = config.currency.symbol || '৳';
                    return (
                      <Link
                        key={product.id}
                        href={`/products/${product.slug}`}
                        onClick={() => {
                          setIsOpen(false);
                          if (onCloseMobile) onCloseMobile();
                        }}
                        className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 transition-colors cursor-pointer group"
                      >
                        {product.image ? (
                          <img
                            src={product.image}
                            alt={product.name}
                            className="w-10 h-10 object-cover rounded-lg border border-gray-100 flex-shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 bg-gray-100 rounded-lg flex-shrink-0 flex items-center justify-center text-gray-300">
                            <Search size={16} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <h4 className="text-[13px] font-semibold text-gray-800 truncate group-hover:text-brand-blue transition-colors">
                            {product.name}
                          </h4>
                          {product.brand?.name && (
                            <span className="text-[10px] text-gray-400 font-medium block">
                              {product.brand.name}
                            </span>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className="text-[13px] font-bold text-gray-900">
                            {priceSym}{product.price.toLocaleString()}
                          </span>
                          {product.originalPrice && product.originalPrice > product.price && (
                            <span className="text-[10px] text-gray-400 line-through block">
                              {priceSym}{product.originalPrice.toLocaleString()}
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
                <button
                  onClick={() => handleSearchSubmit(query)}
                  className="w-full text-center border-t border-gray-50 mt-2 pt-2 pb-1 text-[12px] font-bold text-brand-blue hover:text-brand-blue/80 transition-colors block cursor-pointer"
                >
                  View all results for &ldquo;{query}&rdquo; &rarr;
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
