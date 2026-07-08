'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col items-center justify-center bg-[#f8f9fa] text-center p-6">
        <div className="max-w-md bg-white rounded-[32px] p-10 border border-gray-100/80 shadow-[0_8px_30px_rgb(0,0,0,0.03)]">
          <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-gray-900 uppercase tracking-tight mb-3">Something Went Wrong</h1>
          <p className="text-gray-600 text-sm mb-6 leading-relaxed">
            We encountered an unexpected error. Please refresh the page or try again later.
          </p>
          <button
            onClick={reset}
            className="bg-brand-blue text-white font-bold px-6 py-3 rounded-xl hover:bg-brand-blue-dark transition-colors text-sm"
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
