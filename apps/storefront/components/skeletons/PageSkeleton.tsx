import { ProductGridSkeleton } from "./ProductCardSkeleton";

/**
 * Generic neutral page skeleton: breadcrumb strip + title + a grid of
 * product-card skeletons. Used by the root loading boundary where the
 * destination page's own structure isn't known yet.
 */
export function PageSkeleton() {
  return (
    <div className="bg-white min-h-screen pb-20 font-sans animate-pulse" aria-hidden="true">
      <div className="bg-[#f5f5f5] py-3 md:py-4 border-b border-gray-100">
        <div className="max-w-screen-xl mx-auto px-4 flex items-center justify-between">
          <div className="h-5 w-24 bg-gray-200 rounded" />
          <div className="h-4 w-32 bg-gray-200 rounded" />
        </div>
      </div>
      <div className="max-w-screen-xl mx-auto px-4 py-4 md:py-6">
        <div className="h-7 w-48 bg-gray-200 rounded mb-6" />
        <ProductGridSkeleton count={8} />
      </div>
    </div>
  );
}

export default PageSkeleton;
