export default function ProductDetailLoading() {
  return (
    <div className="bg-white min-h-screen pb-20 font-sans animate-pulse">
      {/* Breadcrumb Skeleton */}
      <div className="bg-[#f5f5f5] py-3 md:py-4 border-b border-gray-100">
        <div className="max-w-screen-xl mx-auto px-4">
          <div className="h-5 w-48 bg-gray-200 rounded" />
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-4 py-6 md:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
          {/* Left Column: Image Gallery Skeleton */}
          <div className="space-y-4">
            {/* Main Image Container */}
            <div className="aspect-square w-full bg-gray-150 rounded-2xl bg-gray-100 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.02)]" />
            
            {/* Thumbnail Images */}
            <div className="flex gap-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="w-20 h-20 bg-gray-100 rounded-lg" />
              ))}
            </div>
          </div>

          {/* Right Column: Product Details Skeleton */}
          <div className="space-y-6">
            {/* Category / Tag Badge */}
            <div className="h-6 w-24 bg-gray-200 rounded-full" />

            {/* Product Title */}
            <div className="space-y-2">
              <div className="h-8 w-3/4 bg-gray-200 rounded" />
              <div className="h-8 w-1/2 bg-gray-200 rounded" />
            </div>

            {/* Ratings & Reviews */}
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="w-4 h-4 bg-gray-200 rounded-full" />
                ))}
              </div>
              <div className="h-4 w-20 bg-gray-200 rounded" />
            </div>

            {/* Price block */}
            <div className="space-y-1.5 py-4 border-y border-gray-100 flex items-baseline gap-3">
              <div className="h-8 w-32 bg-gray-200 rounded" />
              <div className="h-5 w-20 bg-gray-150 rounded" />
            </div>

            {/* Attributes / Options Skeletons (e.g. Size, Color) */}
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="h-4 w-12 bg-gray-200 rounded" />
                <div className="flex gap-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-9 w-12 bg-gray-100 rounded" />
                  ))}
                </div>
              </div>
            </div>

            {/* Quantity Selector and Action Buttons */}
            <div className="space-y-3 pt-6">
              <div className="flex flex-col sm:flex-row gap-3">
                {/* Quantity box */}
                <div className="h-12 w-28 bg-gray-100 rounded-xl" />
                {/* Add to Cart button */}
                <div className="h-12 flex-1 bg-gray-200 rounded-xl" />
              </div>
              {/* Buy Now button */}
              <div className="h-12 w-full bg-gray-200 rounded-xl" />
            </div>
          </div>
        </div>

        {/* Description & Specs Tabs Skeleton */}
        <div className="mt-12 lg:mt-16 border-t border-gray-100 pt-8">
          <div className="flex gap-6 border-b border-gray-100 pb-3 mb-6">
            <div className="h-5 w-28 bg-gray-200 rounded" />
            <div className="h-5 w-32 bg-gray-150 rounded" />
          </div>
          <div className="space-y-3 max-w-3xl">
            <div className="h-4 w-full bg-gray-100 rounded" />
            <div className="h-4 w-full bg-gray-100 rounded" />
            <div className="h-4 w-5/6 bg-gray-100 rounded" />
            <div className="h-4 w-2/3 bg-gray-100 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}
