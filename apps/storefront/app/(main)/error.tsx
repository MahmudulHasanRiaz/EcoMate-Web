"use client";

import { useEffect } from "react";

// Section-level boundary: a PDP/archive crash shows this instead of taking
// down the header/footer (those live in the parent layout, above this file).
export default function MainError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[section-error]", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <h1 className="text-2xl font-bold text-gray-900 mb-3">Something went wrong</h1>
      <p className="text-gray-600 text-sm mb-6 max-w-md">
        This section couldn&apos;t load. The rest of the store is unaffected — try again, or head back to shopping.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center px-6 py-3 bg-brand-blue text-white rounded-xl hover:bg-brand-blue-dark transition-colors text-sm font-semibold"
        >
          Try Again
        </button>
        <a
          href="/products"
          className="inline-flex items-center px-6 py-3 border border-gray-200 text-gray-700 rounded-xl hover:border-gray-300 transition-colors text-sm font-semibold"
        >
          Browse Products
        </a>
      </div>
    </div>
  );
}
