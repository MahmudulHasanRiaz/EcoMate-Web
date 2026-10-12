// Loading mirror of the redesigned PDP (ProductDetailClient): same grid,
// same 4:5 gallery, same Hind Siliguri scope — so the skeleton→content swap
// introduces ~zero CLS. bg-gray-* blocks only; no content, no layout shift.
export default function ProductDetailLoading() {
  return (
    <div className="bg-white min-h-screen pb-28 min-[901px]:pb-12 font-[var(--font-pdp)] animate-pulse">
      {/* Breadcrumb */}
      <div className="max-w-screen-xl mx-auto px-4 min-[901px]:px-6 py-3 flex items-center gap-2">
        <div className="h-5 w-12 bg-gray-200 rounded" />
        <div className="h-5 w-20 bg-gray-200 rounded" />
        <div className="h-5 w-36 bg-gray-200 rounded" />
      </div>

      <div className="mx-auto grid min-[901px]:grid-cols-[1.05fr_1fr] gap-5 min-[901px]:gap-12 min-[901px]:px-6 min-[901px]:max-w-screen-xl">
        {/* Gallery: 4:5 main + thumb row */}
        <div className="min-w-0">
          <div className="aspect-[4/5] w-full bg-gray-100" />
          <div className="flex gap-3 mt-3 px-4 min-[901px]:px-0">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="w-20 h-20 bg-gray-100 rounded-[3px] flex-shrink-0" />
            ))}
          </div>
        </div>

        {/* Buy box column */}
        <div className="min-w-0">
          <div className="flex flex-col px-4 min-[901px]:px-0 pt-4 min-[901px]:pt-2">
            <div className="h-3 w-20 bg-gray-200 rounded mb-1" />
            <div className="h-7 w-3/4 bg-gray-200 rounded" />
            <div className="h-7 w-1/2 bg-gray-200 rounded mt-1" />
            <div className="flex items-center gap-3 mt-3 mb-1">
              <div className="h-7 w-28 bg-gray-200 rounded" />
              <div className="h-5 w-20 bg-gray-100 rounded" />
            </div>
            <div className="flex gap-2 mt-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-9 w-14 bg-gray-100 rounded-[3px]" />
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <div className="h-11 w-28 bg-gray-100 rounded-[3px]" />
              <div className="h-11 flex-1 bg-gray-200 rounded-[3px]" />
            </div>
            <div className="h-11 w-full bg-gray-200 rounded-[3px] mt-2" />
            <div className="flex gap-2 mt-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-[76px] min-w-[100px] flex-1 bg-gray-100 rounded-[3px]" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
