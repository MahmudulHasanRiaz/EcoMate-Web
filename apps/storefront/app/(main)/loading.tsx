import { ProductCardSkeleton } from "@/components/skeletons/ProductCardSkeleton";

/**
 * Homepage skeleton: hero banner block, category circles row, then a
 * product section (title + card grid) — mirroring Hero / CategoryList /
 * ProductSection so the swap to content has minimal shift. Header and
 * footer come from the (main) layout and stay mounted.
 */
export default function HomeLoading() {
  return (
    <div className="bg-white min-h-screen pb-20 font-sans animate-pulse" aria-hidden="true">
      {/* Hero */}
      <div className="max-w-screen-xl mx-auto px-4 pt-4">
        <div className="aspect-[16/9] md:aspect-[21/8] w-full bg-gray-100 rounded-[4px]" />
      </div>

      {/* Category circles */}
      <div className="max-w-screen-xl mx-auto px-4 py-6 md:py-10">
        <div className="h-6 w-48 bg-gray-200 rounded mb-6" />
        <div className="flex gap-4 md:gap-6 overflow-hidden">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex flex-col items-center gap-3 min-w-[85px] md:min-w-[120px]">
              <div className="w-[85px] h-[85px] md:w-[100px] md:h-[100px] bg-gray-200 rounded-lg" />
              <div className="h-3 w-16 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Product section */}
      <div className="max-w-screen-xl mx-auto px-4 py-4">
        <div className="h-6 w-40 bg-gray-200 rounded mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          {[1, 2, 3, 4].map((i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
