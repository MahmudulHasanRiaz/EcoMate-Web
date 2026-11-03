/**
 * Cart skeleton: breadcrumb + title, item rows on the left and the
 * order-summary panel on the right (the cart page's own layout).
 */
export default function CartLoading() {
  return (
    <div className="max-w-screen-xl mx-auto px-3 md:px-4 py-4 md:py-8 animate-pulse" aria-hidden="true">
      <div className="h-4 w-32 bg-gray-200 rounded mb-4" />
      <div className="h-8 w-48 bg-gray-200 rounded mb-6" />
      <div className="flex flex-col lg:flex-row gap-6 lg:gap-10">
        <div className="flex-1 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3 bg-white border border-gray-100 rounded-xl p-3">
              <div className="w-[70px] h-[70px] bg-gray-100 rounded-lg flex-shrink-0" />
              <div className="flex-1 space-y-2 py-1">
                <div className="h-4 w-2/3 bg-gray-200 rounded" />
                <div className="h-3 w-1/3 bg-gray-100 rounded" />
                <div className="h-7 w-24 bg-gray-100 rounded" />
              </div>
              <div className="h-5 w-16 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
        <div className="w-full lg:w-[360px] flex-shrink-0">
          <div className="bg-gray-50 rounded-xl p-5 space-y-3">
            <div className="h-5 w-32 bg-gray-200 rounded" />
            <div className="h-4 w-full bg-gray-100 rounded" />
            <div className="h-4 w-full bg-gray-100 rounded" />
            <div className="h-4 w-2/3 bg-gray-100 rounded" />
            <div className="h-12 w-full bg-gray-200 rounded-[6px] mt-2" />
          </div>
        </div>
      </div>
    </div>
  );
}
