/**
 * Shared product-card skeleton — markup copied 1:1 from the PLP
 * route skeleton (app/(main)/products/loading.tsx) so every surface
 * that shows it (PLP, homepage, category, brand) swaps skeleton →
 * content with zero visual difference.
 */
export function ProductCardSkeleton() {
  return (
    <div className="bg-white rounded-[8px] overflow-hidden flex flex-col h-full border border-gray-200 p-2 md:p-3 space-y-3">
      {/* Image Aspect ratio box */}
      <div className="aspect-square bg-gray-150 rounded bg-gray-100" />
      {/* Title */}
      <div className="space-y-1.5">
        <div className="h-3.5 w-full bg-gray-200 rounded" />
        <div className="h-3.5 w-2/3 bg-gray-200 rounded" />
      </div>
      {/* Price */}
      <div className="h-5 w-20 bg-gray-200 rounded mt-auto" />
      {/* Button */}
      <div className="h-[34px] md:h-[40px] w-full bg-gray-200 rounded" />
    </div>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

export default ProductCardSkeleton;
