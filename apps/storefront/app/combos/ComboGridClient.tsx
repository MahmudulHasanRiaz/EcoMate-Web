"use client";

import React from "react";
import Image from "next/image";
import { Gift, Search, Loader2, AlertCircle, ChevronDown, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useInfiniteScroll } from "@/lib/hooks/useInfiniteScroll";
import { getCombos } from "@/lib/api/combos";
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";
import { COMBO_BLUR_DATA_URL, PLACEHOLDER_IMAGE } from "@/lib/constants";
import type { Combo } from "@/lib/types";

export interface ComboGridClientProps {
  initialItems: Combo[];
  initialCursor: string | null;
  initialHasMore: boolean;
  pageSize?: number;
  filters?: { search?: string };
}

function SkeletonRow() {
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <div className="flex flex-col md:flex-row">
        <div className="md:w-72 h-48 md:h-auto bg-gray-100 animate-pulse" />
        <div className="flex-1 p-6 space-y-3">
          <div className="h-5 bg-gray-100 rounded w-1/3 animate-pulse" />
          <div className="h-3 bg-gray-100 rounded w-2/3 animate-pulse" />
          <div className="flex gap-2">
            <div className="h-5 w-16 bg-gray-100 rounded animate-pulse" />
            <div className="h-5 w-16 bg-gray-100 rounded animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ComboGridClient({
  initialItems,
  initialCursor,
  initialHasMore,
  pageSize = 12,
  filters,
}: ComboGridClientProps) {
  const router = useRouter();
  const { config } = useStorefrontConfig();
  const [imgErrors, setImgErrors] = React.useState<Record<string, boolean>>({});

  const { items, isLoading, hasMore, sentinelRef, error, retry, loadMore, requiresManualLoad } =
    useInfiniteScroll<Combo>({
      initialItems,
      initialCursor,
      initialHasMore,
      pageSize,
      fetchPage: async (cursor, signal) => {
        const res = await getCombos({
          cursor: cursor ?? undefined,
          perPage: pageSize,
          isActive: true,
          search: filters?.search,
          signal,
        });
        return {
          items: res.data,
          nextCursor: res.meta.nextCursor ?? null,
          hasMore: res.meta.hasMore,
        };
      },
      getId: (c) => c.id,
    });

  return (
    <div className="bg-gray-50 min-h-screen pb-16">
      <div className="bg-gradient-to-r from-brand-blue to-blue-700 text-white py-12 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <Gift className="w-12 h-12 mx-auto mb-4 opacity-90" />
          <h1 className="text-3xl md:text-4xl font-bold mb-2">Combo Deals</h1>
          <p className="text-blue-100 text-lg">Save more with our exclusive bundle packages</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 -mt-8 space-y-6">
        <div className="relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            defaultValue={filters?.search ?? ""}
            placeholder="Search combos..."
            className="w-full h-11 pl-10 pr-4 text-sm rounded-xl border border-gray-200 bg-white shadow-sm focus:outline-none focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/20 transition-colors"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const params = new URLSearchParams();
                const value = (e.target as HTMLInputElement).value.trim();
                if (value) params.set("search", value);
                router.push(`/combos${params.toString() ? `?${params}` : ""}`);
              }
            }}
          />
        </div>

        {items.length === 0 && !isLoading ? (
          <div className="bg-white rounded-xl p-12 text-center shadow-sm">
            <Gift className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-xl font-bold text-gray-800 mb-2">No Combos Available</h3>
            <p className="text-gray-500">Check back later for new combo deals!</p>
          </div>
        ) : (
          items.map((combo, index) => {
            const savings =
              combo.originalPrice && combo.originalPrice > combo.price
                ? Math.round(((combo.originalPrice - combo.price) / combo.originalPrice) * 100)
                : 0;
            const isPriority = index < 6;
            const imageSrc = imgErrors[combo.id] ? PLACEHOLDER_IMAGE : combo.image || PLACEHOLDER_IMAGE;

            return (
              <div
                key={combo.id}
                className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow overflow-hidden cursor-pointer"
                onClick={() => router.push(`/combos/${combo.id}`)}
              >
                <div className="flex flex-col md:flex-row">
                  <div className="md:w-72 h-48 md:h-auto bg-gray-100 relative overflow-hidden flex-shrink-0">
                    <Image
                      src={imageSrc}
                      alt={combo.name}
                      fill
                      sizes="(max-width: 768px) 100vw, 288px"
                      priority={isPriority}
                      fetchPriority={isPriority ? "high" : "auto"}
                      loading={isPriority ? "eager" : "lazy"}
                      decoding="async"
                      placeholder="blur"
                      blurDataURL={COMBO_BLUR_DATA_URL}
                      className="object-cover"
                      onError={() => setImgErrors((prev) => ({ ...prev, [combo.id]: true }))}
                      unoptimized={Boolean(imgErrors[combo.id]) || imageSrc === PLACEHOLDER_IMAGE}
                    />
                    {savings > 0 && (
                      <div className="absolute top-3 right-3 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                        -{savings}%
                      </div>
                    )}
                  </div>
                  <div className="flex-1 p-6 flex flex-col justify-between">
                    <div>
                      <h3 className="text-xl font-bold text-gray-800 mb-2">{combo.name}</h3>
                      {combo.shortDesc && <p className="text-gray-500 text-sm mb-3">{combo.shortDesc}</p>}
                      <div className="flex flex-wrap gap-2 mb-3">
                        {combo.items.slice(0, 4).map((item, i) => (
                          <span key={i} className="bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded">
                            {item.productName} x{item.quantity}
                          </span>
                        ))}
                        {combo.items.length > 4 && (
                          <span className="bg-gray-100 text-gray-500 text-xs px-2 py-1 rounded">
                            +{combo.items.length - 4} more
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-brand-blue">
                          {config.currency.symbol}
                          {combo.price.toLocaleString()}
                        </span>
                        {combo.originalPrice && combo.originalPrice > combo.price && (
                          <span className="text-gray-400 line-through text-sm">
                            {config.currency.symbol}
                            {combo.originalPrice.toLocaleString()}
                          </span>
                        )}
                      </div>
                      <button
                        className="bg-brand-blue text-white px-6 py-2 rounded-lg font-medium text-sm hover:bg-brand-blue/90 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/combos/${combo.id}`);
                        }}
                      >
                        View Details
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {isLoading &&
          Array.from({ length: 2 }).map((_, i) => <SkeletonRow key={`skel-${i}`} />)}

        {error && (
          <div className="mt-4 flex flex-col items-center gap-3 text-center">
            <AlertCircle className="w-8 h-8 text-red-500" />
            <p className="text-gray-700">Couldn&rsquo;t load more combos.</p>
            <button
              onClick={retry}
              className="bg-brand-blue text-white px-5 py-2 rounded-lg font-bold text-sm hover:bg-brand-blue/90 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {hasMore && !error && !isLoading && requiresManualLoad && (
          <div className="flex justify-center">
            <button
              onClick={loadMore}
              className="bg-white border border-brand-blue text-brand-blue px-6 py-2.5 rounded-lg font-bold text-sm hover:bg-brand-blue/5 transition-colors flex items-center gap-2"
            >
              <Plus size={16} />
              Load more
            </button>
          </div>
        )}

        {hasMore && !error && !isLoading && !requiresManualLoad && (
          <div ref={sentinelRef} aria-hidden="true" className="h-1 w-full" />
        )}

        {isLoading && !requiresManualLoad && (
          <div className="flex items-center justify-center gap-2 text-gray-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading more combos…
          </div>
        )}

        {!hasMore && items.length > 0 && (
          <div className="mt-6 flex flex-col items-center text-center text-gray-400 text-sm gap-1">
            <ChevronDown className="w-4 h-4" />
            <span>You&rsquo;ve reached the end.</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default ComboGridClient;
