/**
 * Checkout skeleton: form blocks on the left (contact / address /
 * payment sections) and the order-summary panel on the right.
 */
export default function CheckoutLoading() {
  return (
    <div className="max-w-screen-xl mx-auto px-3 md:px-4 py-4 md:py-8 animate-pulse" aria-hidden="true">
      <div className="h-8 w-40 bg-gray-200 rounded mb-6" />
      <div className="flex flex-col lg:flex-row gap-6 lg:gap-10">
        <div className="flex-1 space-y-6">
          {[1, 2, 3].map((section) => (
            <div key={section} className="bg-white border border-gray-100 rounded-xl p-5 space-y-3">
              <div className="h-5 w-40 bg-gray-200 rounded" />
              <div className="h-11 w-full bg-gray-100 rounded" />
              <div className="flex gap-3">
                <div className="h-11 flex-1 bg-gray-100 rounded" />
                <div className="h-11 flex-1 bg-gray-100 rounded" />
              </div>
              {section === 3 && <div className="h-11 w-full bg-gray-100 rounded" />}
            </div>
          ))}
        </div>
        <div className="w-full lg:w-[380px] flex-shrink-0">
          <div className="bg-gray-50 rounded-xl p-5 space-y-3">
            <div className="h-5 w-36 bg-gray-200 rounded" />
            {[1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <div className="w-[60px] h-[60px] bg-gray-100 rounded-lg flex-shrink-0" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-3.5 w-full bg-gray-200 rounded" />
                  <div className="h-3.5 w-1/2 bg-gray-100 rounded" />
                </div>
              </div>
            ))}
            <div className="h-4 w-full bg-gray-100 rounded" />
            <div className="h-4 w-2/3 bg-gray-100 rounded" />
            <div className="h-12 w-full bg-gray-200 rounded-[6px] mt-2" />
          </div>
        </div>
      </div>
    </div>
  );
}
