export default function ProductsLoading() {
  return (
    <div className="bg-white min-h-screen pb-20 font-sans animate-pulse">
      {/* Breadcrumb Skeleton */}
      <div className="bg-[#f5f5f5] py-3 md:py-4 border-b border-gray-100">
        <div className="max-w-screen-xl mx-auto px-4 flex items-center justify-between">
          <div className="h-5 w-24 bg-gray-200 rounded" />
          <div className="h-4 w-32 bg-gray-200 rounded" />
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-4 py-4 md:py-6">
        {/* Controls skeleton */}
        <div className="bg-white rounded-[4px] border border-gray-200 p-1.5 md:p-2 mb-4 md:mb-6 flex items-center justify-between gap-2">
          <div className="h-8 w-24 bg-gray-200 rounded" />
          <div className="h-8 w-32 bg-gray-200 rounded" />
        </div>

        <div className="flex flex-col lg:flex-row gap-6 md:gap-8">
          {/* Sidebar Skeletons */}
          <aside className="hidden lg:block w-64 lg:w-[280px] space-y-6">
            <div className="bg-white border border-gray-100 rounded-[12px] p-5 space-y-6 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.02)]">
              {/* Search Skeleton */}
              <div className="space-y-2">
                <div className="h-4 w-16 bg-gray-200 rounded" />
                <div className="h-9 w-full bg-gray-200 rounded" />
              </div>
              {/* Category Skeleton */}
              <div className="space-y-3 pt-4 border-t border-gray-100">
                <div className="h-4 w-20 bg-gray-200 rounded" />
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-3.5 h-3.5 bg-gray-200 rounded-full" />
                    <div className="h-4 flex-1 bg-gray-200 rounded" />
                  </div>
                ))}
              </div>
              {/* Price Range Skeleton */}
              <div className="space-y-3 pt-4 border-t border-gray-100">
                <div className="h-4 w-24 bg-gray-200 rounded" />
                <div className="flex gap-2">
                  <div className="h-9 flex-1 bg-gray-200 rounded" />
                  <div className="h-9 flex-1 bg-gray-200 rounded" />
                </div>
                <div className="h-9 w-full bg-gray-200 rounded" />
              </div>
            </div>
          </aside>

          {/* Product Grid Skeleton */}
          <div className="flex-1">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <div
                  key={i}
                  className="bg-white rounded-[8px] overflow-hidden flex flex-col h-full border border-gray-200 p-2 md:p-3 space-y-3"
                >
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
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
