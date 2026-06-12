"use client";

import React, { useMemo } from 'react';
import { ChevronRight, Filter, ChevronDown, LayoutGrid, List, Search, X, Loader2, AlertCircle } from 'lucide-react';
import ProductCard from '@/components/ProductCard';
import { useRouter, useSearchParams } from 'next/navigation';
import { getProducts } from '@/lib/api/products';
import { useInfiniteScroll } from '@/lib/hooks/useInfiniteScroll';
import type { Product, Category } from '@/lib/types';

export interface ArchivePageClientProps {
  initialItems: Product[];
  initialCursor: string | null;
  initialHasMore: boolean;
  categories: Category[];
  filters: { search?: string; category?: string; tag?: string; minPrice?: string; maxPrice?: string; sort?: string; page?: string };
  hasStock?: boolean;
}

const PAGE_SIZE = 24;

function SkeletonCard() {
  return (
    <div className="bg-gray-100 rounded-lg animate-pulse aspect-square" />
  );
}

export default function ArchivePageClient({
  initialItems,
  initialCursor,
  initialHasMore,
  categories,
  filters,
  hasStock,
}: ArchivePageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSearch = filters.search || '';
  const initialCategory = filters.category || '';
  const initialTag = filters.tag || '';
  const initialMinPrice = filters.minPrice || '';
  const initialMaxPrice = filters.maxPrice || '';
  const initialSort = filters.sort || 'default';

  const [searchQuery, setSearchQuery] = React.useState(initialSearch);
  const [selectedCategorySlug, setSelectedCategorySlug] = React.useState<string | null>(initialCategory || null);
  const [sortBy, setSortBy] = React.useState(initialSort);
  const [viewMode, setViewMode] = React.useState<'grid' | 'list'>('grid');
  const [isFilterOpen, setIsFilterOpen] = React.useState(false);
  const [selectedBrands, setSelectedBrands] = React.useState<string[]>([]);
  const [brandSearch, setBrandSearch] = React.useState('');
  const [priceMin, setPriceMin] = React.useState(initialMinPrice);
  const [priceMax, setPriceMax] = React.useState(initialMaxPrice);

  const { items, isLoading, hasMore, sentinelRef, error, retry, loadMore, requiresManualLoad } =
    useInfiniteScroll<Product>({
      initialItems,
      initialCursor,
      initialHasMore,
      pageSize: PAGE_SIZE,
      fetchPage: async (cursor, signal) => {
        const res = await getProducts({
          isActive: true,
          hasStock: hasStock || undefined,
          search: filters.search || undefined,
          category: filters.category || undefined,
          tagSlug: filters.tag || undefined,
          minPrice: filters.minPrice ? parseFloat(filters.minPrice) : undefined,
          maxPrice: filters.maxPrice ? parseFloat(filters.maxPrice) : undefined,
          sort:
            sortBy === 'price-low' || sortBy === 'price-high' ? 'basePrice' : undefined,
          order: sortBy === 'price-low' ? 'asc' : sortBy === 'price-high' ? 'desc' : undefined,
          perPage: PAGE_SIZE,
          cursor: cursor ?? undefined,
          signal,
        });
        return {
          items: res.data,
          nextCursor: res.meta.nextCursor ?? null,
          hasMore: res.meta.hasMore,
        };
      },
      getId: (p) => p.id,
    });

  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of items) {
      for (const tag of p.tags || []) set.add(tag);
    }
    return Array.from(set).sort();
  }, [items]);

  const visibleItems = useMemo(() => {
    if (selectedBrands.length === 0) return items;
    return items.filter((p) => {
      const productBrands = (p.tags || []).map((t) => t.toLowerCase());
      if (!selectedBrands.some((b) => productBrands.includes(b.toLowerCase()))) return false;
      return true;
    });
  }, [items, selectedBrands]);

  const applyFilters = (next: { search?: string; category?: string; tag?: string; minPrice?: string; maxPrice?: string; sort?: string }) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (next.search !== undefined) {
      if (next.search) params.set('search', next.search);
      else params.delete('search');
    }
    if (next.category !== undefined) {
      if (next.category) params.set('category', next.category);
      else params.delete('category');
    }
    if (next.tag !== undefined) {
      if (next.tag) params.set('tag', next.tag);
      else params.delete('tag');
    }
    if (next.minPrice !== undefined) {
      if (next.minPrice) params.set('minPrice', next.minPrice);
      else params.delete('minPrice');
    }
    if (next.maxPrice !== undefined) {
      if (next.maxPrice) params.set('maxPrice', next.maxPrice);
      else params.delete('maxPrice');
    }
    if (next.sort !== undefined) {
      if (next.sort && next.sort !== 'default') params.set('sort', next.sort);
      else params.delete('sort');
    }
    const qs = params.toString();
    router.push(`/products${qs ? `?${qs}` : ''}`);
  };

  const toggleBrand = (brand: string) => {
    setSelectedBrands((prev) =>
      prev.includes(brand) ? prev.filter((b) => b !== brand) : [...prev, brand]
    );
  };

  const clearAll = () => {
    setSelectedBrands([]);
    router.push('/products');
  };

  const currentCategorySlug = selectedCategorySlug || filters.category || '';
  const currentCategory =
    categories.find((c) => c.slug === currentCategorySlug)?.name ||
    categories.find((c) => c.id === currentCategorySlug)?.name ||
    'Products';

  return (
    <div className="bg-white min-h-screen pb-20 font-sans">
      <div className="bg-[#f5f5f5] py-3 md:py-4 border-b border-gray-100">
        <div className="max-w-screen-xl mx-auto px-4 flex items-center justify-between">
          <h1 className="text-[17px] md:text-[18px] font-medium text-gray-800">{currentCategory}</h1>
          <nav className="flex items-center gap-1 text-[13px] text-gray-500 font-normal">
            <button onClick={() => router.push('/')} className="hover:text-brand-blue cursor-pointer transition-colors">Home</button>
            <ChevronRight size={12} className="opacity-70 mx-1" strokeWidth={2} />
            <span className="text-gray-800">{currentCategory}</span>
          </nav>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-4 py-4 md:py-6">
        <div className="bg-white rounded-[4px] border border-gray-200 p-1.5 md:p-2 mb-4 md:mb-6 flex items-center justify-between gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden">
          <button onClick={() => setIsFilterOpen(true)} className="flex items-center gap-2 border border-brand-blue text-brand-blue px-4 py-1.5 md:py-2 rounded-[4px] font-medium text-[12px] md:text-[13px] uppercase hover:bg-brand-blue/5 transition-colors whitespace-nowrap">
            <Filter size={15} strokeWidth={2}/> FILTERS
          </button>
          <div className="flex-1 hidden md:block"></div>
          <div className="flex items-center gap-2">
            <div className="relative flex-shrink-0">
              <select
                value={sortBy}
                onChange={(e) => {
                  const next = e.target.value;
                  setSortBy(next);
                  applyFilters({ sort: next });
                }}
                className="appearance-none bg-white border border-gray-200 rounded-[4px] px-3 py-1.5 md:px-4 md:py-2 pr-8 text-[12px] md:text-[13px] text-gray-600 outline-none focus:border-brand-blue transition-all cursor-pointer"
              >
                <option value="default">Default Sorting</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
                <option value="newest">Newest Arrival</option>
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={14} />
            </div>
            <div className="hidden md:flex flex-shrink-0 items-center gap-1 bg-white border border-gray-200 p-0.5 rounded ml-1">
              <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded transition-all ${viewMode === 'grid' ? 'bg-[#f5f5f5] text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}><LayoutGrid size={16} /></button>
              <button onClick={() => setViewMode('list')} className={`p-1.5 rounded transition-all ${viewMode === 'list' ? 'bg-[#f5f5f5] text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}><List size={16} /></button>
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-6 md:gap-8">
          <aside className={`fixed inset-0 z-[100] md:relative md:inset-auto md:z-0 md:w-64 lg:w-[280px] space-y-6 transition-transform duration-300 ${isFilterOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
            <div className="h-full bg-[#f8f9fa] md:bg-transparent overflow-y-auto md:overflow-visible p-6 md:p-0 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[16px] font-bold text-gray-800 uppercase tracking-widest">Filters</h3>
                <div className="flex items-center gap-4">
                  <button onClick={clearAll} className="text-[12px] font-bold text-gray-400 hover:text-brand-blue uppercase tracking-wider transition-colors">Clear All</button>
                  <button onClick={() => setIsFilterOpen(false)} className="md:hidden text-gray-400 hover:text-gray-800"><X size={20} /></button>
                </div>
              </div>

              <div className="bg-white border border-gray-100 md:rounded-[12px] shadow-[0_2px_12px_-4px_rgba(0,0,0,0.02)]">
                <div className="p-5 border-b border-gray-100">
                  <h4 className="text-[13px] font-bold text-gray-800 mb-4 uppercase tracking-wider flex items-center justify-between">
                    Search <ChevronDown size={14} className="text-gray-400"/>
                  </h4>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') applyFilters({ search: searchQuery });
                      }}
                      placeholder="Search products..."
                      className="w-full bg-gray-50 border border-gray-100 rounded-md py-2 pl-8 pr-3 text-[12px] outline-none focus:border-brand-blue transition-colors"
                    />
                  </div>
                </div>

                <div className="p-5 border-b border-gray-100">
                  <h4 className="text-[13px] font-bold text-gray-800 mb-4 uppercase tracking-wider flex items-center justify-between">
                    Categories <ChevronDown size={14} className="text-gray-400"/>
                  </h4>
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-2 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full">
                    {categories.map((cat) => (
                      <label key={cat.id} className="flex items-center justify-between cursor-pointer group">
                        <div className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="category"
                            checked={selectedCategorySlug === cat.slug}
                            onChange={() => {
                              setSelectedCategorySlug(cat.slug);
                              applyFilters({ category: cat.slug });
                            }}
                            className="w-3.5 h-3.5 text-brand-blue border-gray-300 focus:ring-brand-blue"
                          />
                          <span className={`text-[13px] transition-colors ${selectedCategorySlug === cat.slug ? 'font-bold text-brand-blue' : 'font-medium text-gray-600 group-hover:text-gray-900'}`}>{cat.name}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="p-5 border-b border-gray-100">
                  <h4 className="text-[13px] font-bold text-gray-800 mb-4 uppercase tracking-wider flex items-center justify-between">
                    Price Range <ChevronDown size={14} className="text-gray-400"/>
                  </h4>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 border border-gray-200 rounded-md py-2 px-3 flex items-center gap-1 bg-gray-50 focus-within:border-brand-blue focus-within:bg-white transition-colors">
                        <span className="text-gray-400 text-[13px] font-medium font-mono">৳</span>
                        <input
                          type="number"
                          value={priceMin}
                          onChange={(e) => setPriceMin(e.target.value)}
                          placeholder="Min"
                          className="w-full text-[13px] font-bold text-gray-800 outline-none bg-transparent"
                          min="0"
                        />
                      </div>
                      <span className="text-gray-300 font-bold flex-shrink-0">-</span>
                      <div className="flex-1 border border-gray-200 rounded-md py-2 px-3 flex items-center gap-1 bg-gray-50 focus-within:border-brand-blue focus-within:bg-white transition-colors">
                        <span className="text-gray-400 text-[13px] font-medium font-mono">৳</span>
                        <input
                          type="number"
                          value={priceMax}
                          onChange={(e) => setPriceMax(e.target.value)}
                          placeholder="Max"
                          className="w-full text-[13px] font-bold text-gray-800 outline-none bg-transparent"
                          min="0"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => applyFilters({ minPrice: priceMin || undefined, maxPrice: priceMax || undefined })}
                        className="flex-1 bg-brand-blue text-white text-[12px] font-bold py-2 rounded-md hover:bg-brand-blue/90 transition-colors"
                      >
                        Apply
                      </button>
                      {(filters.minPrice || filters.maxPrice) && (
                        <button
                          onClick={() => { setPriceMin(''); setPriceMax(''); applyFilters({ minPrice: undefined, maxPrice: undefined }); }}
                          className="text-[11px] text-gray-500 hover:text-brand-blue underline"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-5">
                  <h4 className="text-[13px] font-bold text-gray-800 mb-4 uppercase tracking-wider flex items-center justify-between">
                    Brands <ChevronDown size={14} className="text-gray-400"/>
                  </h4>
                  <div className="relative mb-4">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" value={brandSearch} onChange={(e) => setBrandSearch(e.target.value)} placeholder="Search brands..." className="w-full bg-[#f8f9fa] border border-gray-100 rounded-md py-2 pl-8 pr-3 text-[12px] outline-none focus:border-brand-blue transition-colors" />
                  </div>
                  <div className="space-y-3 max-h-56 overflow-y-auto pr-2 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full">
                    {brandOptions.filter((b) => b.toLowerCase().includes(brandSearch.toLowerCase())).map((brand) => (
                      <label key={brand} className="flex items-center justify-between cursor-pointer group">
                        <div className="flex items-center gap-3">
                          <div className="relative flex items-center justify-center">
                            <input
                              type="checkbox"
                              checked={selectedBrands.includes(brand)}
                              onChange={() => toggleBrand(brand)}
                              className="peer sr-only"
                            />
                            <div className="w-[18px] h-[18px] border border-gray-300 rounded-[4px] bg-white peer-checked:bg-brand-blue peer-checked:border-brand-blue transition-all"></div>
                            <svg className="absolute w-[10px] h-[10px] text-white opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" viewBox="0 0 14 14" fill="none">
                              <path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </div>
                          <span className={`text-[13px] transition-colors ${selectedBrands.includes(brand) ? 'font-bold text-gray-900' : 'font-medium text-gray-600 group-hover:text-gray-900'}`}>
                            {brand}
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </aside>

          <main className="flex-1">
            {visibleItems.length === 0 && !isLoading ? (
              <div className="col-span-full py-20 text-center bg-white rounded-3xl border border-dashed border-gray-200">
                <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300"><Search size={40} /></div>
                <h3 className="text-xl font-bold text-gray-800 mb-2">No Products Found</h3>
                <p className="text-gray-500">Try adjusting your filters or search criteria.</p>
                <button onClick={clearAll} className="mt-6 text-brand-blue font-bold uppercase text-[13px] hover:underline">Clear All Filters</button>
              </div>
            ) : (
              <div className={`grid gap-3 md:gap-4 ${viewMode === 'grid' ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'}`}>
                {visibleItems.map((product, index) => (
                  <ProductCard key={product.id} product={product} index={index} />
                ))}
              </div>
            )}

            {isLoading && (
              <div className="grid gap-3 md:gap-4 grid-cols-2 lg:grid-cols-3 mt-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonCard key={`skel-${i}`} />
                ))}
              </div>
            )}

            {error && (
              <div className="mt-4 flex flex-col items-center gap-3 text-center">
                <AlertCircle className="w-8 h-8 text-red-500" />
                <p className="text-gray-700">Couldn&rsquo;t load more products.</p>
                <button onClick={retry} className="bg-brand-blue text-white px-5 py-2 rounded-lg font-bold text-sm hover:bg-brand-blue/90 transition-colors">
                  Retry
                </button>
              </div>
            )}

            {hasMore && !error && !isLoading && requiresManualLoad && (
              <div className="flex justify-center mt-6">
                <button onClick={loadMore} className="bg-white border border-brand-blue text-brand-blue px-6 py-2.5 rounded-lg font-bold text-sm hover:bg-brand-blue/5 transition-colors">
                  Load more
                </button>
              </div>
            )}

            {hasMore && !error && !isLoading && !requiresManualLoad && (
              <div ref={sentinelRef} aria-hidden="true" className="h-1 w-full" />
            )}

            {isLoading && !requiresManualLoad && (
              <div className="mt-4 flex items-center justify-center gap-2 text-gray-500 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading more products…
              </div>
            )}

            {!hasMore && visibleItems.length > 0 && (
              <div className="mt-6 flex flex-col items-center text-center text-gray-400 text-sm">
                <span>You&rsquo;ve reached the end.</span>
              </div>
            )}
          </main>
        </div>
      </div>

      {isFilterOpen && (
        <div className="fixed inset-0 bg-black/40 z-[90] md:hidden backdrop-blur-sm transition-opacity" onClick={() => setIsFilterOpen(false)} />
      )}
    </div>
  );
}
