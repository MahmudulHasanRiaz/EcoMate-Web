'use client';

export default function CheckoutError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center px-4">
        <h1 className="text-4xl font-bold text-red-600 mb-4">Checkout error</h1>
        <p className="text-gray-600 mb-6">{error.message || 'Something went wrong during checkout.'}</p>
        <button
          onClick={reset}
          className="px-6 py-3 bg-brand-blue text-white rounded-xl hover:opacity-90 transition-opacity"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
